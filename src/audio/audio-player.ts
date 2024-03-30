'use client'

import { useEffect, useState } from "react";
import { usePlayerStore } from "../stores/player-store";

export const useAudioPlayer = (): void => {
  const [audio] = useState<HTMLAudioElement>(new Audio());
  const playerStore = usePlayerStore();

  useEffect(() => {
    console.log("Audio player effect", playerStore);

    if (!playerStore.isPlaying) {
      audio.pause();
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