'use client'

import { InteractionRequiredAuthError, PublicClientApplication } from "@azure/msal-browser";
import { Client, ResponseType } from "@microsoft/microsoft-graph-client";
import { enqueueSnackbar } from "notistack";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useNetworkMonitor } from "./network-monitor";
import * as mm from 'music-metadata-browser';


export interface BaseFileItem {
  name: string;
  id: string;
  type: 'file' | 'folder' | 'audio-track';
  parentId?: string;
}

export interface FileItem extends BaseFileItem {
  type: 'file';
}

export interface FolderItem extends BaseFileItem {
  type: 'folder';
  childrenIds?: string[];
}

export interface AudioTrackFileItem extends BaseFileItem {
  type: 'audio-track';
  mimeType: string;
  metadata?: mm.IAudioMetadata;
}


interface FileStoreProps {
  getFileByPath: (path: string) => Promise<BaseFileItem>;
  getFileById: (id: string) => Promise<BaseFileItem>;
  getChildren: (id: string) => Promise<BaseFileItem[]>;
  hasTrackBlobInLocal: (id: string) => Promise<boolean>;
  getTrackBlob: (id: string) => Promise<Blob | undefined>;
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
  hasTrackBlobInLocal: async (id: string) => {
    throw new Error("Not implemented");
  },
  getTrackBlob: async (id: string) => {
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

const audioFormatMapping: { [key: string]: { mimeType: string } } = {
  "aac": { mimeType: "audio/aac" },
  "mp3": { mimeType: "audio/mpeg" },
  "ogg": { mimeType: "audio/ogg" },
  "wav": { mimeType: "audio/wav" },
  "flac": { mimeType: "audio/flac" },
  "m4a": { mimeType: "audio/mp4" },
};

async function makeFileItemFromResponseAndSync(responseItem: any, db: IDBDatabase): Promise<BaseFileItem> {
  // console.log(responseItem);

  let dbItem = await getFileItemFromIdb(db, responseItem.id);
  if (responseItem.folder) {
    if (dbItem === undefined) {
      dbItem = {
        name: responseItem.name,
        id: responseItem.id,
        type: 'folder',
      } as FolderItem;
    } else {
      dbItem.name = responseItem.name;
      dbItem.type = 'folder';
    }
  }
  if (responseItem.file) {
    const ext: string = responseItem.name.split('.').pop();
    const audioMimeType = audioFormatMapping[ext]?.mimeType;

    if (audioMimeType !== undefined) {
      if (dbItem === undefined) {
        dbItem = {
          name: responseItem.name,
          id: responseItem.id,
          type: 'audio-track',
          mimeType: audioMimeType,
        } as AudioTrackFileItem;
      } else {
        dbItem.name = responseItem.name;
        dbItem.type = 'audio-track';
      }
    } else {
      if (dbItem === undefined) {
        dbItem = {
          name: responseItem.name,
          id: responseItem.id,
          type: 'file',
        } as FileItem;
      } else {
        dbItem.name = responseItem.name;
        dbItem.type = 'file';
      }
    }
  }

  db.transaction("files", "readwrite").objectStore("files").put(dbItem);
  return dbItem;
}

const acquireAccessToken = async (pca: PublicClientApplication) => {
  try {
    const redirectResponse = await pca.handleRedirectPromise();
    if (redirectResponse) {
      return redirectResponse.accessToken;
    }
  } catch (error) {
    console.error(error);
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
}

const getRootsAndSync = async (client: Client, db: IDBDatabase) => {
  const response = await client.api('/me/drive/root/children').get();

  db.transaction("roots", "readwrite").objectStore("roots").clear();

  const roots: BaseFileItem[] = await Promise.all(response.value.map((item: any) => {
    return makeFileItemFromResponseAndSync(item, db);
  }));

  roots.forEach((root) => {
    db.transaction("roots", "readwrite").objectStore("roots").put({ id: root.id });
  });

  return roots;
}

const updateTrackMetadata = async (db: IDBDatabase, id: string, blob: Blob) => {
  const metadata = await mm.parseBlob(blob);
  console.log(metadata);

  const track = await getFileItemFromIdb(db, id) as AudioTrackFileItem;
  track.metadata = metadata;
  db.transaction("files", "readwrite").objectStore("files").put(track);
}

export const FileStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [pca, setPca] = useState<PublicClientApplication | undefined>(undefined);
  const [driveClient, setDriveClient] = useState<Client | undefined>(undefined);
  const [fileDb, setFileDb] = useState<IDBDatabase | undefined>(undefined);
  const [rootFiles, setRootFiles] = useState<BaseFileItem[] | undefined>(undefined);
  const [configured, setConfigured] = useState(false);
  const networkMonitor = useNetworkMonitor();

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
        cache: {
          cacheLocation: "localStorage"
        }
      });

      await pca.initialize();
      setPca(pca);

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
              db.createObjectStore("roots", { keyPath: "id" });
            }
            {
              db.createObjectStore("blobs")
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

      {
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
        roots.sort((a, b) => a.name.localeCompare(b.name));
        setRootFiles(roots);
      }
    };

    init().then(() => {
      setConfigured(true);
    }).catch((error) => {
      console.error(error);
      enqueueSnackbar(`${error}`, { variant: 'error' });
    });

    return () => {
      initialized.current = true;
    };
  }, []);

  useEffect(() => {
    if (!configured) return;
    if (!networkMonitor.isOnline) {
      // If offline, client should be disconnected.
      setDriveClient(undefined);
      return;
    }

    if (!pca) return;

    acquireAccessToken(pca).then((accessToken) => {
      const client = Client.init({
        authProvider: (done) => {
          done(null, accessToken);
        },
      });
      setDriveClient(client);
      enqueueSnackbar("Drive Client Connected", { variant: 'success' });
    }).catch((error) => {
      console.error(error);
      enqueueSnackbar(`${error}`, { variant: 'error' });
    });
  }, [networkMonitor, configured])

  useEffect(() => {
    if (driveClient === undefined) return;

    getRootsAndSync(driveClient, fileDb as IDBDatabase).then((roots) => {
      setRootFiles(roots);
    }).catch((error) => {
      console.error(error);
      enqueueSnackbar(`${error}`, { variant: 'error' });
    });
  }, [driveClient])


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
        const children: BaseFileItem[] = await Promise.all(response.value.map((item: any) => {
          return makeFileItemFromResponseAndSync(item, fileDb);
        }));

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

  const getTrackBlob = async (id: string) => {
    if (!configured) {
      throw new Error("File store not configured");
    }
    if (!fileDb) {
      throw new Error("File database not initialized");
    }

    const track = await getFileItemFromIdb(fileDb, id) as AudioTrackFileItem;
    if (track.type !== 'audio-track') {
      throw new Error("Item is not a track");
    }

    // {
    //   const blob = await new Promise<Blob>((resolve, reject) => {
    //     const request = fileDb?.transaction("blobs", "readwrite").objectStore("blobs").get(id);
    //     request.onsuccess = (event) => {
    //       const item = (event.target as IDBRequest).result;
    //       resolve(item);
    //     };
    //     request.onerror = (event) => {
    //       reject((event.target as IDBRequest).error);
    //     };
    //   });

    //   if (blob) return blob;
    // }

    if (!driveClient) return undefined;


    let downloadUrl: string;
    {
      const response = await driveClient.api(`/me/drive/items/${id}?select=id,@microsoft.graph.downloadUrl`).get();
      downloadUrl = response['@microsoft.graph.downloadUrl'];
    }

    let blob: Blob;

    {
      const response = await fetch(downloadUrl);
      blob = await response.blob();
      await updateTrackMetadata(fileDb, id, blob);
    }

    fileDb.transaction("blobs", "readwrite").objectStore("blobs").put(blob, id);

    return blob;
  }

  const hasTrackBlobInLocal = async (id: string) => {
    if (!configured) {
      throw new Error("File store not configured");
    }
    if (!fileDb) {
      throw new Error("File database not initialized");
    }

    const count = await new Promise<number>((resolve, reject) => {
      const request = fileDb.transaction("blobs").objectStore("blobs").count(id);
      request.onsuccess = (event) => {
        const count = (event.target as IDBRequest).result;
        resolve(count);
      };
      request.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });

    return count > 0;
  }

  return (
    <FileStore.Provider value={{
      getFileByPath,
      getFileById,
      rootFiles,
      getChildren,
      configured,
      hasTrackBlobInLocal,
      getTrackBlob,
    }}>
      {children}
    </FileStore.Provider>
  );
}
