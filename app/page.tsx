'use client'

import { useEffect, useState } from 'react';
import App from './app';
import { useAppContext } from '@/src/AppContext';
import * as msal from '@azure/msal-browser';
import { Client } from '@microsoft/microsoft-graph-client';
import { ListItemButton, ListItemIcon } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import { AudioFileOutlined, InsertDriveFile, InsertDriveFileOutlined } from '@mui/icons-material';

function FileEntry({ name, onClick }: { name: string, onClick: () => void }) {
  return (
    <ListItemButton onClick={onClick}>
      <ListItemIcon><InsertDriveFileOutlined /></ListItemIcon>
      {name}
    </ListItemButton>
  );
}

function MusicFileEntry({ name, onClick }: { name: string, onClick: () => void }) {
  return (
    <ListItemButton onClick={onClick}>
      <ListItemIcon><AudioFileOutlined /></ListItemIcon>
      {name}
    </ListItemButton>
  );
}

function FolderEntry({ name, onClick }: { name: string, onClick: () => void }) {
  return (
    <ListItemButton onClick={onClick}>
      <ListItemIcon><FolderIcon /></ListItemIcon>
      {name}
    </ListItemButton>
  );
}

function isSupportedAudioFile(name: string) {
  return name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.flac') || name.endsWith('.ogg');
}

export default function Page() {
  const { msalInstance, setCloudClient, cloudClient } = useAppContext();
  const [files, setFiles] = useState<any[]>([]);

  useEffect(() => {
    if (msalInstance === null) return;
    console.log('YYYYY');

    const pca = msalInstance;

    const getToken = async () => {
      await msalInstance.handleRedirectPromise();
      
      // Get the first account
      const accounts = pca.getAllAccounts();
      if (accounts.length === 0) {
        // No accounts detected, call loginPopup
        pca.loginRedirect({
          scopes: ['Files.Read', 'Sites.Read.All'],
        });
        return;
      }

      const request = {
        scopes: ['Files.Read', 'Sites.Read.All'], // Adjust scopes as needed
        account: accounts[0], // Add this line
      };

      let accessToken: string | null = null;

      try {
        // Try to get an access token silently
        const loginResponse = await msalInstance.acquireTokenSilent(request);
        accessToken = loginResponse.accessToken;
      }
      catch (error) {
        if (error instanceof msal.InteractionRequiredAuthError) {
          console.log('Silent token acquisition failed. Redirecting to login page...');
          // If silent token acquisition fails, redirect to the login page
          msalInstance.loginRedirect(request);
        } else {
          console.error('An error occurred:', error);
        }
      }

      if (!accessToken) {
        return;
      }
      console.log("AccessToken", accessToken);

      // Create a client
      const client = Client.init({
        authProvider: (done) => {
          done(null, accessToken);
        },
      });

      setCloudClient(client);

      // Get files from OneDrive
      const response = await client.api('/me/drive/root/children').get();
      console.log(response.value)

      setFiles(response.value);

    };

    getToken();

  }, [msalInstance])

  const updateFiles = async (fileId: string) => {
    console.log("CLICKED", fileId);
    try {
      const response = await cloudClient?.api(`/me/drive/items/${fileId}/children`).get();
      setFiles(response.value);

    } catch (error) {
      console.error("ERROR", error);
    }
  }

  const playAudio = async (file: any) => {
    console.log("PLAY", file);

    try {
      const response = await fetch(file["@microsoft.graph.downloadUrl"]);
      const arrayBuffer = await response.arrayBuffer();
      const audioContext = new AudioContext();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start();
    } catch (error) {
      console.error("ERROR", error);
    }
  }

  return (
    <div>
      {files.map((file) => {
        if (file.folder) {
          return <FolderEntry key={file.id} name={file.name} onClick={() => updateFiles(file.id)} />
        }
        if (isSupportedAudioFile(file.name)) {
          return <MusicFileEntry key={file.id} name={file.name} onClick={() => {
            playAudio(file)
          }} />
        }
        return <FileEntry key={file.id} name={file.name} onClick={() => { }} />
      })}
    </div>
  );
}

// import Image from "next/image";

// export default function Home() {
//   return (
//     <main className="flex min-h-screen flex-col items-center justify-between p-24">
//       <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm lg:flex">
//         <p className="fixed left-0 top-0 flex w-full justify-center border-b border-gray-300 bg-gradient-to-b from-zinc-200 pb-6 pt-8 backdrop-blur-2xl dark:border-neutral-800 dark:bg-zinc-800/30 dark:from-inherit lg:static lg:w-auto  lg:rounded-xl lg:border lg:bg-gray-200 lg:p-4 lg:dark:bg-zinc-800/30">
//           Get started by editing&nbsp;
//           <code className="font-mono font-bold">app/page.tsx</code>
//         </p>
//         <div className="fixed bottom-0 left-0 flex h-48 w-full items-end justify-center bg-gradient-to-t from-white via-white dark:from-black dark:via-black lg:static lg:h-auto lg:w-auto lg:bg-none">
//           <a
//             className="pointer-events-none flex place-items-center gap-2 p-8 lg:pointer-events-auto lg:p-0"
//             href="https://vercel.com?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
//             target="_blank"
//             rel="noopener noreferrer"
//           >
//             By{" "}
//             <Image
//               src="/vercel.svg"
//               alt="Vercel Logo"
//               className="dark:invert"
//               width={100}
//               height={24}
//               priority
//             />
//           </a>
//         </div>
//       </div>

//       <div className="relative flex place-items-center before:absolute before:h-[300px] before:w-full sm:before:w-[480px] before:-translate-x-1/2 before:rounded-full before:bg-gradient-radial before:from-white before:to-transparent before:blur-2xl before:content-[''] after:absolute after:-z-20 after:h-[180px] after:w-full sm:after:w-[240px] after:translate-x-1/3 after:bg-gradient-conic after:from-sky-200 after:via-blue-200 after:blur-2xl after:content-[''] before:dark:bg-gradient-to-br before:dark:from-transparent before:dark:to-blue-700 before:dark:opacity-10 after:dark:from-sky-900 after:dark:via-[#0141ff] after:dark:opacity-40 before:lg:h-[360px] z-[-1]">
//         <Image
//           className="relative dark:drop-shadow-[0_0_0.3rem_#ffffff70] dark:invert"
//           src="/next.svg"
//           alt="Next.js Logo"
//           width={180}
//           height={37}
//           priority
//         />
//       </div>

//       <div className="mb-32 grid text-center lg:max-w-5xl lg:w-full lg:mb-0 lg:grid-cols-4 lg:text-left">
//         <a
//           href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
//           className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800/30"
//           target="_blank"
//           rel="noopener noreferrer"
//         >
//           <h2 className={`mb-3 text-2xl font-semibold`}>
//             Docs{" "}
//             <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
//               -&gt;
//             </span>
//           </h2>
//           <p className={`m-0 max-w-[30ch] text-sm opacity-50`}>
//             Find in-depth information about Next.js features and API.
//           </p>
//         </a>

//         <a
//           href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
//           className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800/30"
//           target="_blank"
//           rel="noopener noreferrer"
//         >
//           <h2 className={`mb-3 text-2xl font-semibold`}>
//             Learn{" "}
//             <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
//               -&gt;
//             </span>
//           </h2>
//           <p className={`m-0 max-w-[30ch] text-sm opacity-50`}>
//             Learn about Next.js in an interactive course with&nbsp;quizzes!
//           </p>
//         </a>

//         <a
//           href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
//           className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800/30"
//           target="_blank"
//           rel="noopener noreferrer"
//         >
//           <h2 className={`mb-3 text-2xl font-semibold`}>
//             Templates{" "}
//             <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
//               -&gt;
//             </span>
//           </h2>
//           <p className={`m-0 max-w-[30ch] text-sm opacity-50`}>
//             Explore starter templates for Next.js.
//           </p>
//         </a>

//         <a
//           href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
//           className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800/30"
//           target="_blank"
//           rel="noopener noreferrer"
//         >
//           <h2 className={`mb-3 text-2xl font-semibold`}>
//             Deploy{" "}
//             <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transform-none">
//               -&gt;
//             </span>
//           </h2>
//           <p className={`m-0 max-w-[30ch] text-sm opacity-50 text-balance`}>
//             Instantly deploy your Next.js site to a shareable URL with Vercel.
//           </p>
//         </a>
//       </div>
//     </main>
//   );
// }
