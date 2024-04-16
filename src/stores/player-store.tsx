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
  currentTime: number;
  currentTimeChanged: boolean;
  duration: number;
}

export const PlayerStateContext = createContext<PlayerStateProps>({
  isPlaying: false,
  activeTrack: null,
  tracks: [],
  activeTrackIndex: -1,
  isActiveTrackLoading: false,
  currentTime: 0,
  currentTimeChanged: false,
  duration: 0,
});


type Action =
  | { type: "play" }
  | { type: "pause" }
  | { type: "playTrack", payload: { index: number, tracks: AudioTrack[], isActiveTrackLoading: boolean } }
  | { type: "activeTrackLoaded" }
  | { type: "setCurrentTime", payload: { currentTime: number, changed: boolean } }
  | { type: "setDuration", payload: { duration: number } };

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
    },
    playPreviousTrack: () => {
      if (state.tracks.length === 0) {
        return;
      }

      let newIndex = state.activeTrackIndex

      if (newIndex === -1) {
        newIndex = 0;
      }

      if (state.currentTime < 4) {
        const isTheFirstTrack = state.activeTrackIndex === 0;
        newIndex = isTheFirstTrack ? state.tracks.length - 1 : state.activeTrackIndex - 1;
      }

      return playTrack(newIndex);
    },
    setCurrentTime: (currentTime: number) => {
      dispatch({ type: "setCurrentTime", payload: { currentTime, changed: false } });
    },
    changeCurrentTime: (currentTime: number) => {
      dispatch({ type: "setCurrentTime", payload: { currentTime, changed: true } });
    },
    setDuration: (duration: number) => {
      dispatch({ type: "setDuration", payload: { duration } });
    },
  }

  return [state, actions] as const;
}

const cacheBlobs = (
  currentIndex: number, tracks: AudioTrack[], fileStoreActions: ReturnType<typeof useFileStore>[1],
  dispatch: React.Dispatch<Action>) => {
  if (tracks.length === 0) return;
  
  const prevIndex = currentIndex - 1 < 0 ? tracks.length - 1 : currentIndex - 1;
  const nextIndex = currentIndex + 1 >= tracks.length ? 0 : currentIndex + 1;
  
  [currentIndex, nextIndex, prevIndex].forEach((index) => {
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
      return {
        ...state, isPlaying: true, activeTrack: tracks[index], activeTrackIndex: index, isActiveTrackLoading, tracks,
        currentTime: 0, currentTimeChanged: true,
       };
    }
    case "pause": {
      return { ...state, isPlaying: false };
    }
    case "activeTrackLoaded": {
      return { ...state, isActiveTrackLoading: false };
    }
    case "setCurrentTime": {
      return { ...state, currentTime: action.payload.currentTime, currentTimeChanged: action.payload.changed };
    }
    case "setDuration": {
      return { ...state, duration: action.payload.duration };
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
    currentTime: 0,
    currentTimeChanged: false,
    duration: 0,
  });

  return (
    <PlayerStateContext.Provider value={state}>
      <PlayerDispatchContext.Provider value={dispatch}>
        {children}
      </PlayerDispatchContext.Provider>
    </PlayerStateContext.Provider>
  );
}
