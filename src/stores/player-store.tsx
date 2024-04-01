'use client'

import React, { createContext, useContext, useEffect, useState } from "react";
import { AudioTrackFileItem, useFileStore } from "./file-store";


/**
 * Represents an audio track that can be played.
 */
export interface AudioTrack {
  blob?: Blob;
  remoteUrl?: string;
  file: AudioTrackFileItem;
}


interface PlayerStoreProps {
  isPlaying: boolean;
  play: () => void;
  playTrack: (index: number, trackFiles: AudioTrackFileItem[]) => void;
  playNextTrack: () => void;
  playPreviousTrack: () => void;
  pause: () => void;
  activeTrack: AudioTrack | null;
}

export const PlayerStore = createContext<PlayerStoreProps>({
  isPlaying: false,
  play: () => { },
  playTrack: (index: number, trackFiles: AudioTrackFileItem[]) => {
    throw new Error("Not implemented");
  },
  pause: () => { },
  playNextTrack: () => {
    throw new Error("Not implemented");
  },
  playPreviousTrack: () => {
    throw new Error("Not implemented");
  },
  activeTrack: null,
});


export const usePlayerStore = () => {
  return useContext(PlayerStore);
}



export const PlayerStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTrack, setActiveTrack] = useState<AudioTrack | null>(null);
  const [tracks, setTracks] = useState<AudioTrack[]>([]);

  // The index of the active track in the tracks array.
  // If no track is active, this is -1.
  const [activeTrackIndex, setActiveTrackIndex] = useState<number>(-1);

  const fileStore = useFileStore();

  const play = () => {
    setIsPlaying(activeTrack !== null);
    console.log(activeTrack !== null, activeTrack);
  };

  const playTrack = (index: number, files?: AudioTrackFileItem[]) => {
    let currentTracks = tracks;
    if (files) {
      currentTracks = files.map((file) => {
        return {
          file,
          remoteUrl: file.downloadUrl,
        };
      });
      setTracks(currentTracks);
    }

    setActiveTrackIndex(index);
    setActiveTrack(currentTracks[index]);

    console.log("Playing track", currentTracks[index]);

    setIsPlaying(true);
  };

  const pause = () => {
    setIsPlaying(false);
  };

  const playNextTrack = () => {
    console.log("Playing next track");
    if (tracks.length === 0) {
      return;
    }

    // If the queue has tracks but not an activeTrack.
    // play the first track instead.
    if (activeTrackIndex === -1) {
      playTrack(0)
      return;
    }

    const isTheLastTrack = tracks.length === activeTrackIndex + 1;
    if (isTheLastTrack) {
      setIsPlaying(false);
      return;
    }

    const newIndex = isTheLastTrack ? 0 : activeTrackIndex + 1;
    playTrack(newIndex);
  }

  const playPreviousTrack = () => {

  }

  return (
    <PlayerStore.Provider value={{
      isPlaying,
      play,
      playTrack,
      pause,
      activeTrack,
      playNextTrack,
      playPreviousTrack,
    }}>
      {children}
    </PlayerStore.Provider>
  );
}
