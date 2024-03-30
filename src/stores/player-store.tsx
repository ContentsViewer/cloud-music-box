'use client'

import React, { createContext, useContext, useState } from "react";

export interface MusicTrack {
  blob: Blob;
};

interface PlayerStoreProps {
  isPlaying: boolean;
  play: () => void;
  playTrack: (track: MusicTrack) => void;
  pause: () => void;
  activeTrack: MusicTrack | null;
}

export const PlayerStore = createContext<PlayerStoreProps>({
  isPlaying: false,
  play: () => { },
  playTrack: (track: MusicTrack) => { },
  pause: () => { },
  activeTrack: null,
});

export const usePlayerStore = () => {
  return useContext(PlayerStore);
}

export const PlayerStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeTrack, setActiveTrack] = useState<MusicTrack | null>(null);
  const play = () => {
    setIsPlaying(true);
  };
  const playTrack = (track: MusicTrack) => {
    setActiveTrack(track);
    setIsPlaying(true);
  };
  const pause = () => {
    setIsPlaying(false);
  };

  return (
    <PlayerStore.Provider value={{
      isPlaying: isPlaying,
      play,
      playTrack,
      pause,
      activeTrack,
    }}>
      {children}
    </PlayerStore.Provider>
  );
}
