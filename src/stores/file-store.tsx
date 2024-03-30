'use client'

import { InteractionRequiredAuthError, PublicClientApplication } from "@azure/msal-browser";
import { Client } from "@microsoft/microsoft-graph-client";
import { enqueueSnackbar } from "notistack";
import { createContext, useContext, useEffect, useRef, useState } from "react";


export interface BaseFileItem {
  name: string;
  id: string;
  type: 'file' | 'folder' | 'track';
}

export interface FileItem extends BaseFileItem {
  type: 'file';
}

export interface FolderItem extends BaseFileItem {
  type: 'folder';
  childrenIds?: string[];
}

export interface TrackFileItem extends BaseFileItem {
  type: 'track';
  downloadUrl: string;
}


interface FileStoreProps {
  getFileByPath: (path: string) => Promise<BaseFileItem>;
  getFileById: (id: string) => Promise<BaseFileItem>;
  getChildren: (id: string) => Promise<BaseFileItem[]>;
  rootFiles: BaseFileItem[] | undefined;
  configured: boolean;
}

export const FileStore = createContext<FileStoreProps>({
  getFileByPath: async (path: string) => {
    throw new Error("Not implemented");
  },
  getFileById: async (id: string) => {
    throw new Error("Not implemented");
  },
  getChildren: async (id: string) => {
    throw new Error("Not implemented");
  },
  rootFiles: undefined,
  configured: false,
});

export const useFileStore = () => {
  return useContext(FileStore);
}

function getFileItemFromIdb(db: IDBDatabase, id: string): Promise<BaseFileItem> {
  return new Promise((resolve, reject) => {
    const request = db.transaction("files", "readwrite").objectStore("files").get(id);
    request.onsuccess = (event) => {
      const item = (event.target as IDBRequest).result as BaseFileItem;
      resolve(item);
    };
    request.onerror = (event) => {
      reject((event.target as IDBRequest).error);
    };
  });
}

export const FileStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [pca, setPca] = useState<PublicClientApplication | undefined>(undefined);
  const [driveClient, setDriveClient] = useState<Client | undefined>(undefined);
  const [fileDb, setFileDb] = useState<IDBDatabase | undefined>(undefined);
  const [rootFiles, setRootFiles] = useState<BaseFileItem[] | undefined>(undefined);
  const [configured, setConfigured] = useState(false);

  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) {
      return;
    }

    const init = async () => {

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
            pca.acquireTokenRedirect(loginRequest);
            return "";
          }
          throw error;
        }
      };

      let driveClient: Client | undefined = undefined;

      try {
        const accessToken = await acquireAccessToken();
        const client = Client.init({
          authProvider: (done) => {
            done(null, accessToken);
          },
        });
        driveClient = client;
        setDriveClient(client);
        enqueueSnackbar("Drive Client Connected", { variant: 'success' });
      } catch (error) {
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: 'error' });
      }

      let fileDb: IDBDatabase | undefined = undefined;

      try {
        fileDb = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("file-db");

          req.onsuccess = () => {
            resolve(req.result);
          };

          req.onerror = () => {
            reject(req.error);
          };

          req.onupgradeneeded = (ev) => {
            const db = req.result;
            {
              const store = db.createObjectStore("files", { keyPath: "id" });
              store.createIndex("path", "path");

            }
            {
              const store = db.createObjectStore("roots", { keyPath: "id" });
            }
          };
        });

        setFileDb(fileDb);
        enqueueSnackbar("File Database Connected", { variant: 'success' });
      } catch (error) {
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: 'error' });

        throw error;
      }

      if (driveClient) {
        try {
          const response = await driveClient.api('/me/drive/root/children').get();
          console.log(response);

          fileDb?.transaction("roots", "readwrite").objectStore("roots").clear();

          const roots: BaseFileItem[] = response.value.map((item: any) => {
            if (item.folder) {
              const folderItem: FolderItem = {
                name: item.name,
                id: item.id,
                type: 'folder',
              };
              fileDb.transaction("files", "readwrite").objectStore("files").put(folderItem);
              return folderItem;
            }
            const fileItem: FileItem = {
              name: item.name,
              id: item.id,
              type: 'file',
            };
            fileDb.transaction("files", "readwrite").objectStore("files").put(fileItem);
            return fileItem;
          });

          roots.forEach((root) => {
            fileDb?.transaction("roots", "readwrite").objectStore("roots").put({ id: root.id });
          });

          setRootFiles(roots);
        } catch (error) {
          console.error(error);
          enqueueSnackbar(`${error}`, { variant: 'error' });
        }
      } else {
        const rootIds: any[] = await new Promise((resolve, reject) => {
          const transaction = fileDb.transaction("roots", "readonly");
          const objectStore = transaction.objectStore("roots");
          const request = objectStore.getAll();

          request.onsuccess = (event) => {
            resolve((event.target as IDBRequest).result);
          };

          request.onerror = (event) => {
            reject((event.target as IDBRequest).error);
          };
        });

        const rootsPromise: Promise<BaseFileItem>[] = rootIds.map((elem: any) => {
          return new Promise((resolve) => {
            const request = fileDb.transaction("files", "readwrite").objectStore("files").get(elem.id);
            request.onsuccess = (event) => {
              const item = (event.target as IDBRequest).result as BaseFileItem;
              resolve(item);
            };
          });
        });

        const roots = await Promise.all(rootsPromise);
        setRootFiles(roots);
      }
      console.log("@@@@");
    };

    init().then(() => {
      console.log("!!!!");
      setConfigured(true);
    }).catch((error) => {
      console.error(error);
      enqueueSnackbar(`${error}`, { variant: 'error' });
    });

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

  const getChildren = async (id: string) => {
    if (!configured) {
      throw new Error("File store not configured");
    }
    if (!fileDb) {
      throw new Error("File database not initialized");
    }

    const currentFolder = await getFileItemFromIdb(fileDb, id) as FolderItem;
    if (currentFolder.type !== 'folder') {
      throw new Error("Item is not a folder");
    }

    if (driveClient) {
      try {
        const response = await driveClient.api(`/me/drive/items/${id}/children`).get();
        console.log("QQQ", response);
        const children: BaseFileItem[] = response.value.map((item: any) => {
          if (item.folder) {
            const folderItem: FolderItem = {
              name: item.name,
              id: item.id,
              type: 'folder',
            };
            fileDb?.transaction("files", "readwrite").objectStore("files").put(folderItem);
            return folderItem;
          }
          const fileItem: FileItem = {
            name: item.name,
            id: item.id,
            type: 'file',
          };
          fileDb?.transaction("files", "readwrite").objectStore("files").put(fileItem);
          return fileItem;
        });

        const childrenIds = children.map((child) => child.id);
        currentFolder.childrenIds = childrenIds;
        fileDb?.transaction("files", "readwrite").objectStore("files").put(currentFolder);

        return children;
      } catch (error) {
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: 'error' });
        return [];
      }
    } else {
      console.log("BBB");
      const childrenIds: string[] = await new Promise((resolve, reject) => {
        const transaction = fileDb.transaction("files", "readonly");
        const objectStore = transaction.objectStore("files");
        const request = objectStore.get(id);

        request.onsuccess = (event) => {
          const item = (event.target as IDBRequest).result as FolderItem;
          if (item.childrenIds === undefined) {
            throw new Error("Failed to ")
          }
          resolve(item.childrenIds);
        };

        request.onerror = (event) => {
          reject((event.target as IDBRequest).error);
        };
      });

      const childrenPromise: Promise<BaseFileItem>[] = childrenIds.map((elem) => {
        return new Promise((resolve) => {
          const request = fileDb.transaction("files", "readwrite").objectStore("files").get(elem);
          request.onsuccess = (event) => {
            const item = (event.target as IDBRequest).result as BaseFileItem;
            resolve(item);
          };
        });
      });
      const children = await Promise.all(childrenPromise);
      return children;
    }
  }

  return (
    <FileStore.Provider value={{
      getFileByPath,
      getFileById,
      rootFiles,
      getChildren,
      configured,
    }}>
      {children}
    </FileStore.Provider>
  );
}
