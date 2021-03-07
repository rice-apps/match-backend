// Load .env configuration file
require('dotenv').config();

// 3rd party dependencies
var path = require('path');
var express = require('express');
var session = require('express-session');
var jsforce = require('jsforce');

var cors = require('cors');

// Instantiate Salesforce client with .env configuration
const oauth2 = new jsforce.OAuth2({
	loginUrl: process.env.domain,
	clientId: process.env.consumerKey,
	clientSecret: process.env.consumerSecret,
	redirectUri: process.env.callbackUrl
});

// Salesforce's ID for the record type of NewBee and Mentor
// May need to change when migrating to live salesforce, or if the newBee/mentor record types
// are updated on the salesforce side.
const RECORD_TYPE_ID = {
	newBee: "0121U0000003rkiQAA",
	mentor: "0121U0000003rknQAA", // Emphasis on the "n" !!!
}

console.log("REDIRECT: ", process.env.callbackUrl);

// Setup HTTP server
const app = express();
const port = process.env.PORT || 8080;
app.set('port', port);

// TODO: Remove before deployment. Only necessary for testing
app.use(cors());
app.options('*', cors());
// Allow CORS
// app.use(function(req, res, next) {
//     if (req.headers.origin) {
//         res.header('Access-Control-Allow-Origin', '*')
//         res.header('Access-Control-Allow-Headers', '*')
//         res.header('Access-Control-Allow-Methods', '*')
//         if (req.method === 'OPTIONS') return res.sendStatus(200);
//     }
//     next()
// })
// app.use(cors({ credentials: true, origin: true }))


console.log("Secret key: ", process.env.sessionSecretKey);


// Enable server-side sessions
app.use(
	session({
		secret: process.env.sessionSecretKey,
		cookie: { secure: process.env.isHttps === 'true', httpOnly: 'false', maxAge: 8*60*60*1000 },
		resave: true,
		saveUninitialized: true,
	})
);



/**
 *  Attemps to retrieves the server session.
 *  If there is no session, redirects with HTTP 401 and an error message
 */
function getSession(request, response) {
	var session = request.session;
	console.log("SESSION: ", session);
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
	console.log("GOT LOGIN REQUEST");
	// Redirect to Salesforce login/authorization page
	response.redirect(oauth2.getAuthorizationUrl({ scope: 'api' }));
});

/**
 * Login callback endpoint (only called by Salesforce)
 */
app.get('/auth/callback', function(request, response) {
	console.log("RECEIVED CALLBACK!")
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

		console.log("AUTHORIZED");
		console.log("URL: ", conn.instanceUrl);
		console.log("TOKEN: ", conn.accessToken);
		// Store oauth session data in server (never expose it directly to client)
		request.session.sfdcAuth = {
			'instanceUrl': conn.instanceUrl,
			'accessToken': conn.accessToken
		};
		console.log("SAVED")

		console.log("REQUEST SESSION:", request.session);
		// Redirect to app main page
		response.redirect('http://localhost:3000/');
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
		return response.redirect('http://localhost:3000/index.html');
	});
});

/**
 * Endpoint for retrieving currently connected user
 */
app.get('/auth/whoami', function(request, response) {
	console.log("Getting session");
	const session = getSession(request, response);
	if (session == null) {
		console.log("No session found")
		// console.log(response);
		return;
	}
	console.log("====== Found session =======")
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

/**
 * Endpoint for performing a SOQL query on Salesforce
 * 
 * Target Format:
 *	{
 *		"newBees" :  [
 *			[“Email Address”, “Name”, "Zip Code"...],
 *			[“email@website1”, “name1”, zip1”, ...],
 *			[“email@website2”, “name2”, zip2”, ...],
 *		],
 *		"mentors" :  [
 *			[“Email Address”, “Name”, "Zip Code"...],
 *			[“email@website1”, “name1”, zip1”, ...],
 *			[“email@website2”, “name2”, zip2”, ...],
 *		],
 *	}
*/
 app.get('/contacts', function(request, response) {
	console.log("Received contacts request")
	const session = getSession(request, response);
	if (session == null) {
		return;
	}

	const query = "SELECT AccountId, Email, Name, RecordTypeId, MailingAddress FROM Contact";
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
			// Response worked
			var allAccountsTable = [["Email", "Account Id", "Name", "Zip Code"]]
			// Fill out the result table
			result.records.forEach(account => {
				allAccountsTable.push([account.Email, account.AccountId, account.Name, 
					account.MailingAddress.postalCode, account.RecordTypeId]);
			})
			// Filter contacts by Newbee/Mentors
			var newBeeTable = allAccountsTable.filter((account, i) =>
				i === 0 || account[4] === RECORD_TYPE_ID.newBee );
			var mentorTable = allAccountsTable.filter((account, i) =>
				i === 0 || account[4] === RECORD_TYPE_ID.mentor);

			var finalResult = {
				"newBees": newBeeTable,
				"mentors": mentorTable
			}
			// Send result to client (front end) 
			response.send(finalResult);
			return;
		}
	});
});


/**
 * Endpoint for performing a SOQL query on Salesforce
 */
 app.get('/relationships', function(request, response) {
	console.log("Received relationships request")
	const session = getSession(request, response);
	if (session == null) {
		return;
	}

	const query = "SELECT Name, Type FROM AccountRelationship";
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
			// Send result to client (frontend) 
			response.send(result.records);
			return;
		}
	});
});

app.listen(app.get('port'), function() {
	console.log('Server started: http://localhost:' + app.get('port') + '/');
});
