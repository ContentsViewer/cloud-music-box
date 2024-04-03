'use client'

import React, { Dispatch, createContext, useContext, useEffect, useState } from "react";
import { AudioTrackFileItem, useFileStore } from "./file-store";
import { enqueueSnackbar } from "notistack";


/**
 * Represents an audio track that can be played.
 */
export interface AudioTrack {
  blob?: Blob;
  remoteUrl?: string;
  file: AudioTrackFileItem;
}

interface PlayerStateProps {
  isPlaying: boolean;
  activeTrack: AudioTrack | null;
  tracks: AudioTrack[];
  activeTrackIndex: number;
}

export const PlayerStateContext = createContext<PlayerStateProps>({
  isPlaying: false,
  activeTrack: null,
  tracks: [],
  activeTrackIndex: -1,
});


type Action =
  | { type: "play" }
  | { type: "pause" }
  | { type: "playTrack", payload: { index: number, files?: AudioTrackFileItem[], fileStore: ReturnType<typeof useFileStore> } }
  | { type: "playNextTrack", payload: { fileStore: ReturnType<typeof useFileStore> } }

export const PlayerDispatchContext = createContext<Dispatch<Action>>(() => { });

export const usePlayerStore = () => {
  return [useContext(PlayerStateContext), useContext(PlayerDispatchContext)] as const;
}

const cacheBlobs = (currentIndex: number, tracks: AudioTrack[], fileStore: ReturnType<typeof useFileStore>) => {
  const process = [currentIndex, currentIndex + 1, currentIndex + 2].map((index) => {
    if (index >= tracks.length) {
      return Promise.resolve();
    }

    const track = tracks[index];
    if (track.blob) {
      return Promise.resolve();
    }

    return fileStore.getTrackBlob(track.file.id).then((blob) => {
      track.blob = blob;
    }).catch((error) => {
      console.error(error);
      enqueueSnackbar(`${error}`, { variant: "error" });
    });
  })

  Promise.all(process).then(() => {
    console.log("Blobs cached");
  }).catch((error) => {
    console.error(error);
    enqueueSnackbar(`${error}`, { variant: "error" });
  });
}


const reducer = (state: PlayerStateProps, action: any) => {
  const playTrack = (state: PlayerStateProps, fileStore: ReturnType<typeof useFileStore>, index: number, files?: AudioTrackFileItem[]) => {
    let currentTracks = state.tracks;
    if (files) {
      currentTracks = files.map((file) => {
        return {
          file,
          remoteUrl: file.downloadUrl,
        };
      });
      state.tracks = currentTracks;
    }

    cacheBlobs(index, currentTracks, fileStore);

    state.activeTrackIndex = index;
    state.activeTrack = currentTracks[index];
    state.isPlaying = true;
    return { ...state };
  }
  switch (action.type) {
    case "play": {
      let currentTrack = state.activeTrack;
      return { ...state, isPlaying: currentTrack !== null };
    }
    case "playTrack": {
      const { index, files, fileStore } = action.payload as {
        index: number, files?: AudioTrackFileItem[], fileStore: ReturnType<typeof useFileStore>
      };
      return playTrack(state, fileStore, index, files);
    }
    case "pause": {
      return { ...state, isPlaying: false };
    }
    case "playNextTrack": {
      const { fileStore } = action.payload as { fileStore: ReturnType<typeof useFileStore> };

      console.log("Playing next track");
      console.trace();
      if (state.tracks.length === 0) {
        return state;
      }

      if (state.activeTrackIndex === -1) {
        return playTrack(state, fileStore, 0);
      }

      const isTheLastTrack = state.tracks.length === state.activeTrackIndex + 1;
      if (isTheLastTrack) {
        return { ...state, isPlaying: false };
      }

      const newIndex = isTheLastTrack ? 0 : state.activeTrackIndex + 1;
      return playTrack(state, fileStore, newIndex);
    }
    default: {
      throw new Error(`Unknown action: ${action.type}`);
    }
  }
}

export const PlayerStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = React.useReducer(reducer, {
    isPlaying: false,
    activeTrack: null,
    tracks: [],
    activeTrackIndex: -1,
  });

  return (
    <PlayerStateContext.Provider value={state}>
      <PlayerDispatchContext.Provider value={dispatch}>
        {children}
        </PlayerDispatchContext.Provider>
    </PlayerStateContext.Provider>
  );
}
