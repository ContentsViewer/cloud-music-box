'use client'

import React, { Dispatch } from "react";
import * as msal from "@azure/msal-browser";
import { Client } from '@microsoft/microsoft-graph-client';

interface AppContextProps {
  msalInstance: msal.PublicClientApplication | null;
  setMsalInstance: Dispatch<React.SetStateAction<msal.PublicClientApplication | null>>;
  cloudClient: Client | undefined;
  setCloudClient: Dispatch<React.SetStateAction<Client | undefined>>;
}

export const AppContext = React.createContext<AppContextProps | undefined>(undefined);

export const useAppContext = () => {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within a AppContextProvider");
  }
  return context;
}

export const AppContextProvider = ({ children }: { children: React.ReactNode }) => {
  const [msalInstance, setMsalInstance] = React.useState<msal.PublicClientApplication | null>(null);
  const [cloudClient, setCloudClient] = React.useState<Client | undefined>(undefined);

  React.useEffect(() => {
    return;
    console.log("Initializing MSAL");
    const msalConfig = {
      auth: {
        clientId: "28af6fb9-c605-4ad3-8039-3e90df0933cb",
        redirectUri: window.location.origin,
      },
    };
    const instance = new msal.PublicClientApplication(msalConfig);

    console.log("Redirect URI: ", msalConfig.auth.redirectUri)
    instance.initialize().then(() => {
      console.log("XXXX");
      setMsalInstance(instance);
    })
  }, []);

  // if (!msalInstance) {
  //   return null;
  // }

  return (
    <AppContext.Provider value={{
      msalInstance, setMsalInstance, cloudClient, setCloudClient
    }}>
      {children}
    </AppContext.Provider>
  )
}