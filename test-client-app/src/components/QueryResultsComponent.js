import React, { Component } from 'react';

class QueryResultsComponent extends Component {
  render() {
    return (
      <div>
        <p className="slds-form-element__label  slds-text-heading--medium">Results</p>
        <div className="slds-box slds-theme--shade">
          <pre>{this.props.result}</pre>
        </div>
      </div>
    );
  }
}

export default QueryResultsComponent;
