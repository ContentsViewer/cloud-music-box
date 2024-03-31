'use client'

import React, { createContext, useContext, useState } from "react";
import { AudioTrackFileItem } from "./file-store";



interface PlayerStoreProps {
  isPlaying: boolean;
  play: () => void;
  playTrack: (track: AudioTrackFileItem) => void;
  pause: () => void;
  activeTrack: AudioTrackFileItem | null;
}

export const PlayerStore = createContext<PlayerStoreProps>({
  isPlaying: false,
  play: () => { },
  playTrack: (track: AudioTrackFileItem) => { },
  pause: () => { },
  activeTrack: null,
});

export const usePlayerStore = () => {
  return useContext(PlayerStore);
}

export const PlayerStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTrack, setActiveTrack] = useState<AudioTrackFileItem | null>(null);
  const play = () => {
    setIsPlaying(true);
  };
  const playTrack = (track: AudioTrackFileItem) => {
    setActiveTrack(track);
    setIsPlaying(true);
    console.log("Playing track", track);
  };
  const pause = () => {
    setIsPlaying(false);
  };

  return (
    <PlayerStore.Provider value={{
      isPlaying,
      play,
      playTrack,
      pause,
      activeTrack,
    }}>
      {children}
    </PlayerStore.Provider>
  );
}
