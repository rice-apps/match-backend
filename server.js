// Load .env configuration file
require('dotenv').config();

// 3rd party dependencies
const path = require('path'),
	express = require('express'),
	session = require('express-session'),
	jsforce = require('jsforce');

// Instantiate Salesforce client with .env configuration
const oauth2 = new jsforce.OAuth2({
	loginUrl: process.env.domain,
	clientId: process.env.consumerKey,
	clientSecret: process.env.consumerSecret,
	redirectUri: process.env.callbackUrl
});

// Setup HTTP server
const app = express();
const port = process.env.PORT || 8080;
app.set('port', port);

// Enable server-side sessions
app.use(
	session({
		secret: process.env.sessionSecretKey,
		cookie: { secure: process.env.isHttps === 'true' },
		resave: false,
		saveUninitialized: false
	})
);

/**
 *  Attemps to retrieves the server session.
 *  If there is no session, redirects with HTTP 401 and an error message
 */
function getSession(request, response) {
	const session = request.session;
	if (!session.sfdcAuth) {
		response.status(401).send('No active session');
		return null;
	}
	return session;
}

function resumeSalesforceConnection(session) {
	return new jsforce.Connection({
		instanceUrl: session.sfdcAuth.instanceUrl,
		accessToken: session.sfdcAuth.accessToken,
		version: process.env.apiVersion
	});
}

// Serve simple message at root directory
app.get('/', function(request, response) {
	response.status(200).send('You have reached the Match backend!');
	return;
});

/**
 * Login endpoint
 */
app.get('/auth/login', function(request, response) {
	// Redirect to Salesforce login/authorization page
	response.redirect(oauth2.getAuthorizationUrl({ scope: 'api' }));
});

/**
 * Login callback endpoint (only called by Salesforce)
 */
app.get('/auth/callback', function(request, response) {
	if (!request.query.code) {
		response.status(500).send('Failed to get authorization code from server callback.');
		return;
	}

	// Authenticate with OAuth
	const conn = new jsforce.Connection({
		oauth2: oauth2,
		version: process.env.apiVersion
	});
	conn.authorize(request.query.code, function(error, userInfo) {
		if (error) {
			console.log('Salesforce authorization error: ' + JSON.stringify(error));
			response.status(500).json(error);
			return;
		}

		// Store oauth session data in server (never expose it directly to client)
		request.session.sfdcAuth = {
			instanceUrl: conn.instanceUrl,
			accessToken: conn.accessToken
		};
		// Redirect to app main page
		return response.redirect('http://localhost:8080/index.html');
	});
});

/**
 * Logout endpoint
 */
app.get('/auth/logout', function(request, response) {
	const session = getSession(request, response);
	if (session == null) return;

	// Revoke OAuth token
	const conn = resumeSalesforceConnection(session);
	conn.logout(function(error) {
		if (error) {
			console.error('Salesforce OAuth revoke error: ' + JSON.stringify(error));
			response.status(500).json(error);
			return;
		}

		// Destroy server-side session
		session.destroy(function(error) {
			if (error) {
				console.error('Salesforce session destruction error: ' + JSON.stringify(error));
			}
		});

		// Redirect to app main page
		return response.redirect('http://localhost:8080/index.html');
	});
});

/**
 * Endpoint for retrieving currently connected user
 */
app.get('/auth/whoami', function(request, response) {
	const session = getSession(request, response);
	if (session == null) {
		return;
	}

	// Request session info from Salesforce
	const conn = resumeSalesforceConnection(session);
	conn.identity(function(error, res) {
		response.send(res);
	});
});

/**
 * Endpoint for performing a SOQL query on Salesforce
 */
app.get('/query', function(request, response) {
	const session = getSession(request, response);
	if (session == null) {
		return;
	}

	const query = request.query.q;
	if (!query) {
		response.status(400).send('Missing query parameter.');
		return;
	}

	const conn = resumeSalesforceConnection(session);
	conn.query(query, function(error, result) {
		if (error) {
			console.error('Salesforce data API error: ' + JSON.stringify(error));
			response.status(500).json(error);
			return;
		} else {
			response.send(result);
			return;
		}
	});
});

app.listen(app.get('port'), function() {
	console.log('Server started: http://localhost:' + app.get('port') + '/');
});
