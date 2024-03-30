'use client'

import { useEffect, useState } from "react";
import { usePlayerStore } from "../stores/player-store";
import { enqueueSnackbar } from "notistack";

export const useAudioPlayer = (): void => {
  const [audio, setAudio] = useState<HTMLAudioElement | undefined>();
  const playerStore = usePlayerStore();

  useEffect(() => {
    const audio = new Audio();
    audio.addEventListener("ended", () => {
      // playerStore.pause();
    });

    setAudio(audio);
  }, [])

  useEffect(() => {
    if (!audio) {
      return;
    }
    
    console.log("Audio player effect", playerStore);

    if (!playerStore.isPlaying) {
      audio.pause();
      return;
    }

    try {
      if (!audio.src) {
        if (playerStore.activeTrack) {
          audio.src = URL.createObjectURL(playerStore.activeTrack?.blob);
        }
        audio.play();
      }
    } catch (error) {
      playerStore.pause();
      console.error(error);
      enqueueSnackbar(`${error}`, { variant: "error" })
    }
  }, [playerStore]);

  useEffect(() => {
    const ms = window.navigator.mediaSession;
    if (!ms) {
      return;
    }

    ms.setActionHandler("play", () => {
      playerStore.play();
    });
    ms.setActionHandler("pause", () => {
      playerStore.pause();
    });
    ms.setActionHandler("previoustrack", () => {
      console.log("Previous track");
    });
    ms.setActionHandler("nexttrack", () => {
      console.log("Next track");
    });

    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("previoustrack", null);
      ms.setActionHandler("nexttrack", null);
    };
  }, []);
}