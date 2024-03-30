'use client'

import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '@/src/AppContext';
import * as msal from '@azure/msal-browser';
import { Client } from '@microsoft/microsoft-graph-client';
import { ListItemButton, ListItemIcon } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import { AudioFileOutlined, InsertDriveFile, InsertDriveFileOutlined } from '@mui/icons-material';
import { useAudioPlayer } from '@/src/audio/audio-player';
import { MusicTrack, usePlayerStore } from '@/src/stores/player-store';

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

let wakeLock: WakeLockSentinel | null = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log(wakeLock);
    }
  } catch (err) {
    console.error(`${err.name}, ${err.message}`);
  }
}

export default function Page() {
  const { msalInstance, setCloudClient, cloudClient } = useAppContext();
  const [files, setFiles] = useState<any[]>([]);
  const [audioFile, setAudioFile] = useState<Blob | null>(null);
  const playerState = usePlayerStore();

  useAudioPlayer();

  useEffect(() => {
    return;
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

  const AudioPlayer = ({ file }: { file: Blob | null }) => {
    const audioContextRef = useRef(new window.AudioContext);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    const audioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
      if (!file) return;
      if (!audioRef.current) return;

      const audio = audioRef.current;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Title",
        artist: "Artist",
        album: "Album",
      });

      console.log(navigator.mediaSession)

      navigator.mediaSession.setActionHandler('play', () => {
        console.log("PLAY");
        // audio.play();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        console.log("PAUSE");
        // audio.pause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        // Handle previous track logic here
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        // Handle next track logic here
      });

      // const audioContext = audioContextRef.current;
      // const reader = new FileReader();

      // reader.onloadend = async () => {
      //   const arrayBuffer = reader.result as ArrayBuffer;
      //   const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      //   const audioSource = audioContext.createBufferSource();
      //   audioSource.buffer = audioBuffer;
      //   audioSource.connect(audioContext.destination);
      //   audioSource.start();
      //   audioSourceRef.current = audioSource;
      // };
      // reader.readAsArrayBuffer(file);
      
      requestWakeLock();

      const objectUrl = URL.createObjectURL(file);
      audioRef.current.src = objectUrl;
      audio.play();
    }, [file]);


    return <audio ref={audioRef} controls />;
  }

  const playAudio = async (file: any) => {
    console.log("PLAY", file);

    try {
      const response = await fetch(file["@microsoft.graph.downloadUrl"]);
      const blob = await response.blob();
      console.log("AAA");
      // setAudioFile(blob);
      const track: MusicTrack = {
        blob: blob,
      };

      playerState.playTrack(track);

      // const arrayBuffer = await response.arrayBuffer();
      //   const audioContext = new AudioContext();
      //   const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      //   const source = audioContext.createBufferSource();
      //   source.buffer = audioBuffer;
      //   source.connect(audioContext.destination);
      //   source.start();
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
      {/* <AudioPlayer file={audioFile} /> */}
    </div>
  );
}
