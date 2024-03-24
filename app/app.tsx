'use client'

import React, { useEffect, useState } from 'react';
import * as msal from '@azure/msal-browser';
import { Client } from '@microsoft/microsoft-graph-client';

// MSAL configuration
const msalConfig = {
  auth: {
    clientId: '28af6fb9-c605-4ad3-8039-3e90df0933cb', // Replace with your client id
    redirectUri: '',
  },
};

// Initialize MSAL
let msalInstance;

function App() {
  const [files, setFiles] = useState<any[]>([]);

  useEffect(() => {
    console.log('Initializing MSAL');

    msalConfig.auth.redirectUri = window.location.origin;
    msalInstance = new msal.UserAgentApplication(msalConfig);

    const getToken = async () => {
      const request = {
        scopes: ['Files.Read', 'Sites.Read.All'], // Adjust scopes as needed
      };

      try {
        console.log('Logging in');
        // Login and get an access token from Azure AD
        const loginResponse = await msalInstance.acquireTokenSilent(request);
        console.log('id_token acquired at: ' + new Date().toString(), loginResponse);
        const accessToken = loginResponse.accessToken;
        console.log(accessToken);

        // Create a client
        const client = Client.init({
          authProvider: (done) => {
            done(null, accessToken);
          },
        });

        // Get files from OneDrive
        const response = await client.api('/me/drive/root/children').get();
        setFiles(response.value);
      } catch (error) {
        console.error('An error occurred:', error);
      }
    };

    getToken();
  }, []);

  return (
    <div>
      {files ? (
        files.map((file) => <div key={file.id}>{file.name}</div>)
      ) : (
        <p>Loading...</p>
      )}
    </div>
  );
}

export default App;