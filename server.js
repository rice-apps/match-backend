// Load .env configuration file
require('dotenv').config();

// 3rd party dependencies
const path = require('path');
const express = require('express');
const session = require('express-session');
const jsforce = require('jsforce');
const bodyParser = require('body-parser');

var cors = require('cors');

// Salesforce's ID for the record type of NewBee and Mentor
// May need to change when migrating to live salesforce, or if the newBee/mentor record types
// are updated on the salesforce side.
const RECORD_TYPE_ID = {
	newBee: "0121U0000003rkiQAA",
	mentor: "0121U0000003rknQAA", // Emphasis on the "n" !!!
}

const CONTACT_QUERY = "SELECT Id, CreatedDate, Email, Name, RecordTypeId, MailingAddress FROM Contact";
const RELATIONSHIP_QUERY = "SELECT npe4__Contact__c, npe4__RelatedContact__c, npe4__Type__c FROM npe4__Relationship__c";

// Instantiate Salesforce client with .env configuration
const oauth2 = new jsforce.OAuth2({
	loginUrl: process.env.domain,
	clientId: process.env.consumerKey,
	clientSecret: process.env.consumerSecret,
	redirectUri: process.env.callbackUrl
});

console.log("REDIRECT: ", process.env.callbackUrl);

// Setup HTTP server
const app = express();
// setup middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));

const port = process.env.PORT || 8080;
app.set('port', port);

// TODO: Remove before deployment. Only necessary for testing
// app.use(cors());
// app.options('*', cors());
// Allow CORS
app.use(function(req, res, next) {
    if (req.headers.origin) {
		res.header('Access-Control-Allow-Credentials', true)
        res.header('Access-Control-Allow-Headers', '*')
        res.header('Access-Control-Allow-Methods', '*')
		res.header('Access-Control-Allow-Origin', 'http://localhost:3000')
        if (req.method === 'OPTIONS') return res.sendStatus(200);
    }
    next()
})
// app.use(cors({ credentials: true, origin: true }))


console.log("Secret key: ", process.env.sessionSecretKey);


// Enable server-side sessions
app.use(
	session({
		secret: process.env.sessionSecretKey,
		cookie: { secure: process.env.isHttps === 'true', httpOnly: 'false', maxAge: 8*60*60*1000 },
		resave: true,
		saveUninitialized: true,
		rolling: true,
		domain: '.' + process.env.appDomain,
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

		console.log("REQUEST:", request);
		console.log("SESSION:", request.session);
		
		// Redirect to app main page
		response.redirect(process.env.frontendUrl);
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
 * Endpoint for querying all salesforce contact records
 * 
*/
app.get('/contacts', function(request, response) {
	console.log("Received contacts request")
	const session = getSession(request, response);
	if (session == null) {
		return;
	}

	const conn = resumeSalesforceConnection(session);
	conn.query(CONTACT_QUERY, function(error, result) {
		if (error) {
			console.error('Salesforce data API error: ' + JSON.stringify(error));
			response.status(500).json(error);
			return;
		} else {
			response.send({
				"contacts": result.records
			});
			return;
		}
	});
});

/*
 * Endpoint for querying all salesforce relationship records.
 */
app.get('/relationships', function(request, response) {
	console.log("Received relationships request")
	const session = getSession(request, response);
	if (session == null) {
		return;
	}

	const conn = resumeSalesforceConnection(session);
	conn.query(RELATIONSHIP_QUERY, function(error, result) {
		if (error) {
			console.error('Salesforce data API error: ' + JSON.stringify(error));
			response.status(500).json(error);
			return;
		} else {
			response.send({
				"relationships" :result.records
			});
			return;
		}
	});
});

/**
 * Endpoint for retrieving all left and right data from salesforce
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
 app.get('/leftRightData', function(request, response) {
	console.log("Received contacts & relationship request")
	const session = getSession(request, response);
	if (session == null) {
		return;
	}

	// TODO: use (npo02__MembershipJoinDate__c ?) to access created date

	const conn = resumeSalesforceConnection(session);
	conn.query(CONTACT_QUERY, function(error, result) {
		if (error) {
			console.error('Salesforce data API error: ' + JSON.stringify(error));
			response.status(500).json(error);
			return;
		} else {
			console.log(result.records);
			// Response worked, sort the contacts based on their created date
			let allContacts = result.records.sort((contactA, contactB) => contactA.CreatedDate > contactB.CreatedDate ? 1 : -1);
		
			// Query Relationships
			conn.query(RELATIONSHIP_QUERY, function(error, result) {
				if (error) {
					console.error('Salesforce data API error: ' + JSON.stringify(error));
					response.status(500).json(error);
					return;
				} else {
					// Add relationship data (mentor/newbee information) to contacts
					let allRelationships = result.records;
					allRelationships
						.filter((relationship) => relationship.npe4__Type__c === "Mentor")
						.forEach((relationship) => {
							let newBeeId = relationship.npe4__Contact__c
							let mentorId = relationship.npe4__RelatedContact__c

							let newBee = allContacts.find((contact) => contact.Id === newBeeId);
							
							newBee.mentorId = mentorId
					})

					// Construct result table (start with the column names)
					var newBeeTable = [["Timestamp", "Email", "Name", "City, State", "Coordinate", "Salesforce Id", "NewBee/Mentor", "Mentor ID"]]
					var mentorTable = [["Timestamp", "Email", "Name", "City, State", "Coordinate", "Salesforce Id", "NewBee/Mentor"]]

					// Fill out the result table
					allContacts.forEach(contact => {
						let state = contact.MailingAddress.state || "N/A";
						let city  = contact.MailingAddress.city  || "N/A";
						let city_state = city + ", " + state;
						if (contact.RecordTypeId === RECORD_TYPE_ID.newBee) {
							// Process NewBee
							newBeeTable.push([contact.CreatedDate.substring(0, 10), contact.Email, contact.Name, city_state,
								[contact.MailingAddress.latitude + ", " + contact.MailingAddress.longitude], contact.Id, 
								"NewBee", contact.mentorId]);
						} else if (contact.RecordTypeId === RECORD_TYPE_ID.mentor) {
							// Process Mentor
							mentorTable.push([contact.CreatedDate.substring(0, 10), contact.Email, contact.Name, city_state,
								[contact.MailingAddress.latitude + ", " + contact.MailingAddress.longitude], contact.Id, 
								"Mentor"]);
						}
					})
					var finalResult = {
						"newBees": newBeeTable,
						"mentors": mentorTable
					}

					// Send result to client (frontend) 
					response.send(finalResult);
					return;
				}
			});
		}
	});
});


/*
 * Endpoint for creating a relationship between two contacts
 */
// TODO: change to POST request
app.post('/match', function(request, response) {
	console.log("Received MATCH request")
	const session = getSession(request, response);
	if (session == null) {
		return;
	}
	// Get IDs from query parameters
	const newbeeID = request.query.newbee;
	const mentorID = request.query.mentor;

	const conn = resumeSalesforceConnection(session);

	// - Verify: Newbee ID belongs to a newbee contact
	conn.sobject("Contact")
	.find({Id: newbeeID, RecordTypeId: RECORD_TYPE_ID.newBee})
	.execute(function(err, records) {
			if (err) { return console.error(err); }
			if (records.length === 0) { 
				response.status(406).send("Newbee ID doesn't belong to an existing Newbee"); 
				return 1;
			}
	// - Verify: Mentor ID belongs to a mentor contact
	}).then((err) => {
		if (err) return err;
		conn.sobject("Contact")
		.find({Id: mentorID, RecordTypeId: RECORD_TYPE_ID.mentor})
		.execute(function(err, records) {
				if (err) { return console.error(err); }
				if (records.length === 0){
					response.status(406).send("Mentor ID doesn't belong to an existing Mentor");
					return 1;
				} 
	// - Verify: Newbee can only be matched to one Mentor (so it can't already be matched to any)
	}).then((err) => {
		if (err) return err;
		
		conn.sobject("npe4__Relationship__c")
		.find({npe4__Contact__c: newbeeID })
		.execute(function(err, records) {
			if (err) { return console.error(err); }
			// Newbee can only be matched to one Mentor (so it can't already be matched to any)
			if (records.length > 0) { 
				response.status(406).send('Newbee already matched'); 
				return 1;
			}
	// Checks Passed! Make the match!
	}).then((err) => {
		if (err) return val;

		let new_relationship = {
			"npe4__Contact__c": newbeeID, // ID of the first contact
			"npe4__RelatedContact__c": mentorID, // ID of the second contact
			"npe4__Type__c": "Mentor" // second contact is the mentor of the first contact
		
		}
		
		conn.sobject("npe4__Relationship__c").create(new_relationship, function(err, ret) {
			if (err || !ret.success) { return console.error(err, ret); }
			console.log("Created record id : " + ret.id);
			response.status(201).send('Succesfully matched! New record ID: ' + ret.id);
			return 0;
		});
	});});});
});

/*
 * Endpoint for deleting a relationship between two contacts
 */
// TODO: change to POST
app.post('/unmatch', function(request, response) {
	console.log("Received UN-MATCH request")
	const session = getSession(request, response);
	if (session == null) {
		return;
	}
	const newbeeID = request.query.newbee;
	const mentorID = request.query.mentor;

	const conn = resumeSalesforceConnection(session);

	// Check that the IDs belong to the correct contact types
	// - Verify: Newbee ID belongs to a newbee contact
	conn.sobject("Contact")
		.find({Id: newbeeID, RecordTypeId: RECORD_TYPE_ID.newBee})
		.execute(function(err, records) {
			if (err) { return console.error(err); }
			if (records.length === 0) { 
				response.status(406).send("Newbee ID doesn't belong to an existing Newbee"); 
				return 1;
			}
	}).then((err) => {
		if (err) return err;
		// - Verify: Mentor ID belongs to a mentor contact
		conn.sobject("Contact")
		.find({Id: mentorID, RecordTypeId: RECORD_TYPE_ID.mentor})
		.execute(function(err, records) {
			if (err) { return console.error(err); }
			if (records.length === 0){
				response.status(406).send("Mentor ID doesn't belong to an existing Mentor");
				return 1;
			} 
	}).then((err) => {
		if (err) return err;
		conn.sobject("npe4__Relationship__c")
	  		.find({npe4__Contact__c: mentorID, npe4__RelatedContact__c: newbeeID})
	  		.execute(function(err, records) {
				if (err) { return console.error(err); }
				if (records.length === 0){
					response.status(406).send('No match found between given NewBee and Mentor!')
					return 1;
				}
				let relationshipIDs = records.map(records => records.Id);
				
				// Multiple records deletion
				conn.sobject("npe4__Relationship__c").del(relationshipIDs, function(err, rets) {
					if (err) { return console.error(err); }
					rets.forEach((ret) => {
						if (ret.success) console.log("Deleted Successfully : " + ret.id);
					})
					response.status(200).send('Succesfully unmatched! IDs: ' + relationshipIDs);
					return 0;
				});
			});
	});	});
});


app.listen(app.get('port'), function() {
	console.log('Server started: http://localhost:' + app.get('port') + '/');
});
