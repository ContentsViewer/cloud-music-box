'use client'

import React, { Dispatch, createContext, useContext, useEffect, useRef, useState } from "react";
import { AudioTrackFileItem, useFileStore } from "./file-store";
import { enqueueSnackbar } from "notistack";


/**
 * Represents an audio track that can be played.
 */
export interface AudioTrack {
  blob?: Blob;
  file: AudioTrackFileItem;
}

interface PlayerStateProps {
  isPlaying: boolean;
  activeTrack: AudioTrack | null;
  tracks: AudioTrack[];
  activeTrackIndex: number;
  isActiveTrackLoading: boolean;
}

export const PlayerStateContext = createContext<PlayerStateProps>({
  isPlaying: false,
  activeTrack: null,
  tracks: [],
  activeTrackIndex: -1,
  isActiveTrackLoading: false,
});


type Action =
  | { type: "play" }
  | { type: "pause" }
  | { type: "playTrack", payload: { index: number, tracks: AudioTrack[], isActiveTrackLoading: boolean } }
  | { type: "activeTrackLoaded" }

export const PlayerDispatchContext = createContext<Dispatch<Action>>(() => { });

export const usePlayerStore = () => {
  const state = useContext(PlayerStateContext);
  const dispatch = useContext(PlayerDispatchContext);
  const [, fileStoreActions] = useFileStore();
  const fileStoreActionsRef = useRef(fileStoreActions);
  fileStoreActionsRef.current = fileStoreActions;

  const playTrack = (index: number, files?: AudioTrackFileItem[]) => {
    let currentTracks = state.tracks;
    if (files) {
      currentTracks = files.map((file) => {
        return {
          file,
        };
      });
    }

    cacheBlobs(index, currentTracks, fileStoreActionsRef.current, dispatch);

    const track = currentTracks[index];
    const isActiveTrackLoading = !track.blob;

    dispatch({ type: "playTrack", payload: { index, tracks: currentTracks, isActiveTrackLoading } });
  }

  const actions = {
    play: () => dispatch({ type: "play" }),
    pause: () => dispatch({ type: "pause" }),
    playTrack: (index: number, files?: AudioTrackFileItem[]) => {
      return playTrack(index, files);
    },
    playNextTrack: () => {
      console.log("Playing next track", state);
      if (state.tracks.length === 0) {
        return;
      }

      if (state.activeTrackIndex === -1) {
        return playTrack(0);
      }

      const isTheLastTrack = state.tracks.length === state.activeTrackIndex + 1;

      const newIndex = isTheLastTrack ? 0 : state.activeTrackIndex + 1;
      return playTrack(newIndex);
    }
  }

  return [state, actions] as const;
}

const cacheBlobs = (
  currentIndex: number, tracks: AudioTrack[], fileStoreActions: ReturnType<typeof useFileStore>[1],
  dispatch: React.Dispatch<Action>) => {
  
  [currentIndex, currentIndex + 1, currentIndex + 2].forEach((index) => {
    if (index >= tracks.length) {
      return;
    }

    const track = tracks[index];
    if (track.blob) {
      return;
    }

    fileStoreActions.getTrackContent(track.file.id).then(
      (result) => {
        if (!result) {
          return Promise.reject("No content");
        }
        return result;
      }
    ).then(({ blob, file }) => {
      track.blob = blob;
      if (file) {
        track.file = file;
      }
      if (index === currentIndex) {
        dispatch({ type: "activeTrackLoaded" })
      }
    }).catch((error) => {
      console.error(error);
      enqueueSnackbar(`${error}`, { variant: "error" });
    });
  });
}


const reducer = (state: PlayerStateProps, action: Action) => {
  switch (action.type) {
    case "play": {
      let currentTrack = state.activeTrack;
      return { ...state, isPlaying: currentTrack !== null };
    }
    case "playTrack": {
      const { index, tracks, isActiveTrackLoading } = action.payload;
      return { ...state, isPlaying: true, activeTrack: tracks[index], activeTrackIndex: index, isActiveTrackLoading, tracks };
    }
    case "pause": {
      return { ...state, isPlaying: false };
    }
    case "activeTrackLoaded": {
      return { ...state, isActiveTrackLoading: false };
    }
    default: {
      throw new Error(`Unknown action: ${action}`);
    }
  }
}

export const PlayerStoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = React.useReducer(reducer, {
    isPlaying: false,
    activeTrack: null,
    tracks: [],
    activeTrackIndex: -1,
    isActiveTrackLoading: false,
  });

  return (
    <PlayerStateContext.Provider value={state}>
      <PlayerDispatchContext.Provider value={dispatch}>
        {children}
      </PlayerDispatchContext.Provider>
    </PlayerStateContext.Provider>
  );
}
