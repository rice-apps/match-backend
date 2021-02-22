# Match Backend

This is the backend for Rice-Apps' Match project.

Also included is a simple test client for testing/development purposes.

## Requirements
Requires Node.js

Must define a .env file with the following variables:
``` bash
domain='https://test.salesforce.com'
callbackUrl='http://localhost:3030/auth/callback'
consumerKey='<your key>'
consumerSecret='<your secret>'
apiVersion='48.0'

isHttps='<true or false>'
sessionSecretKey='<secret string>'

PORT = 3030
```

## Installing Dependencies
To install dependencies for the server and test client:
``` bash
npm install

cd test-client
npm install
```

## Runnning
To run the server (runs on port 3030):
``` bash
npm run start
```

To run the test client (runs on port 3000):
``` bash
cd test-client
npm run start
```

