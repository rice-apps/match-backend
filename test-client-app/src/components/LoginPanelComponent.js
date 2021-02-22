import React, { Component } from 'react';

class LoginPanelComponent extends Component {
  login() { 
    // fetch('/auth/login');   
    window.location = '/auth/login';
    // window.location = 'http://localhost:3030/auth/login';
    // window.location = 'https://match-riceapps.herokuapp.com/auth/login';
    // window.location = 'http://localhost:8080/auth/login'
  }

  render() {
    return (
      <div className="slds-modal slds-fade-in-open">
        <div className="slds-modal__container">
          <div className="slds-box slds-theme--shade">
            <p className="slds-text-heading--medium slds-m-bottom--medium">Welcome, please log in with your Salesforce account:</p>
            <div className="slds-align--absolute-center">
              <button onClick={this.login} className="slds-button slds-button--brand">
                <svg aria-hidden="true" className="slds-button__icon--stateful slds-button__icon--left">
                  <use xlinkHref="/assets/icons/utility-sprite/svg/symbols.svg#salesforce1"></use>
                </svg>
                Log in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default LoginPanelComponent;
