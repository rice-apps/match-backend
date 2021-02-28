import React, { Component } from 'react';
import NavBar from './NavBarComponent.js';
import LoginPanel from './LoginPanelComponent.js';
import QueryForm from './QueryFormComponent.js';
import QueryResults from './QueryResultsComponent.js';

class AppComponent extends Component {
  constructor(props) {
    super(props);
    this.state = {
      user: null,
    };
  }

  componentDidMount(){
    const that = this;
    // Get logged in user
    fetch('/auth/whoami', {
    // fetch('http://localhost:3030/auth/whoami', {
          method: 'get',
          headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
          }
      }).then((response) => {
      console.log("RECEIVED RESPONSE");
      if (response.ok) {
        response.json().then(function(json) {
          that.setState({user: json});
        });
      } else if (response.status !== 401) { // Ignore 'unauthorized' responses before logging in
        console.error('Failed to retrieve logged user.', JSON.stringify(response));
      } else {
        console.error('Unauthorized', JSON.stringify(response));
      }
      });
  }

  handleQueryExecution = (data) => {
    const that = this;
    // Send SOQL query to server
    const queryUrl = '/query?q='+ encodeURI(data.query);
    fetch(queryUrl, {
          headers: {
              Accept: 'application/json'
      },
      cache: 'no-store'
      }).then(function(response) {
      response.json().then(function(json) {
        if (response.ok) {
          that.setState({result: JSON.stringify(json, null, 2)});
        } else {
          that.setState({result: 'Failed to retrieve query result.'});
        }
      });
    });
  }

  render() {
    return (
      <div>
        <NavBar user={this.state.user} />
        { this.state.user == null ?
          <LoginPanel />
          :
          <div className="slds-m-around--xx-large">
            <QueryForm onExecuteQuery={this.handleQueryExecution} />
            { this.state.result ?
              <QueryResults result={this.state.result} />
              :
              null
            }
          </div>
        }
      </div>
    );
  }
}

export default AppComponent;
