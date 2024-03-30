'use client'

import { InteractionRequiredAuthError, PublicClientApplication } from "@azure/msal-browser";
import { Client } from "@microsoft/microsoft-graph-client";
import { enqueueSnackbar } from "notistack";
import { createContext, useEffect, useRef, useState } from "react";


interface BaseFileItem {
  name: string;
  type: 'file' | 'folder';
}

export interface FileItem extends BaseFileItem {
  type: 'file';
}

export interface FolderItem extends BaseFileItem {
  type: 'folder';
  children: FileItem[];
}

interface FileStoreProps {
  getFileByPath: (path: string) => Promise<BaseFileItem>;
  getFileById: (id: string) => Promise<BaseFileItem>;
  rootFiles: BaseFileItem[] | undefined;
}

export const FileStore = createContext<FileStoreProps>({
  getFileByPath: async (path: string) => {
    throw new Error("Not implemented");
  },
  getFileById: async (id: string) => {
    throw new Error("Not implemented");
  },
  rootFiles: undefined,
});

export const useFileStore = () => {
  return createContext(FileStore);
}

export const FileStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [pca, setPca] = useState<PublicClientApplication | undefined>(undefined);
  const [driveClient, setDriveClient] = useState<Client | undefined>(undefined);
  const [fileDb, setFileDb] = useState<IDBDatabase | undefined>(undefined);
  const [rootFiles, setRootFiles] = useState<BaseFileItem[] | undefined>(undefined);

  const initialized = useRef(false);

  useEffect(() => {
    const init = async () => {
      if (initialized.current) {
        return;
      }
      const pca = new PublicClientApplication({
        auth: {
          clientId: "28af6fb9-c605-4ad3-8039-3e90df0933cb",
          redirectUri: window.location.origin,
        },
      });

      await pca.initialize();
      setPca(pca);

      const acquireAccessToken = async () => {
        try {
          const redirectResponse = await pca.handleRedirectPromise();
          if (redirectResponse) {
            return redirectResponse.accessToken;
          }
        } catch (error) {
          console.error("AAAA", error);
          enqueueSnackbar(`${error}`, { variant: 'error' });
        }

        const loginRequest = {
          scopes: ['Files.Read', 'Sites.Read.All'],
        };

        const accounts = pca.getAllAccounts();
        if (accounts.length === 0) {
          console.log("XXX");
          pca.loginRedirect(loginRequest);
          return "";
        }

        const silentRequest = {
          scopes: ['Files.Read', 'Sites.Read.All'],
          account: accounts[0],
        };

        try {
          const response = await pca.acquireTokenSilent(silentRequest);
          return response.accessToken;
        } catch (error) {
          if (error instanceof InteractionRequiredAuthError) {

          console.log("YYY");
            pca.acquireTokenRedirect(loginRequest);
            return "";
          }
          throw error;
        }
      };

      try {
        const accessToken = await acquireAccessToken();
        const client = Client.init({
          authProvider: (done) => {
            done(null, accessToken);
          },
        });
        setDriveClient(client);
        enqueueSnackbar("Drive Client Connected", { variant: 'success' });
      } catch (error) {
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: 'error' });
      }

      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("file-db");

          req.onsuccess = () => {
            resolve(req.result);
          };

          req.onerror = () => {
            reject(req.error);
          };

          req.onupgradeneeded = (ev) => {
            const db = req.result;
          };
        });

        setFileDb(db);
        enqueueSnackbar("File Database Connected", { variant: 'success' });
      } catch (error) {
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: 'error' });
      }
    };

    init();

    return () => {
      initialized.current = true;
    };
  }, []);


  const getFileByPath = async (path: string) => {
    throw new Error("Not implemented");
  };

  const getFileById = async (id: string) => {
    throw new Error("Not implemented");
  }

  return (
    <FileStore.Provider value={{
      getFileByPath,
      getFileById,
      rootFiles,
    }}>
      {children}
    </FileStore.Provider>
  );
}
