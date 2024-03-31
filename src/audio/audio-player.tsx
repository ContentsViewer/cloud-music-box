'use client'

import { useEffect, useState } from "react";
import { usePlayerStore } from "../stores/player-store";
import { enqueueSnackbar } from "notistack";

export const AudioPlayer = () => {
  const [audio, setAudio] = useState<HTMLAudioElement | undefined>();
  const playerStore = usePlayerStore();

  useEffect(() => {
    const audio = new Audio();

    const onEnded = () => {
      // playerStore.pause();
      console.log("Track ended");
    }
    const onError = (error: any) => {
      console.log(error);
    }

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    setAudio(audio);

    console.log("Audio player initialized");

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audio.src = "";
      audio.load();
      console.log("Audio player disposed");
    }
  }, [])

  useEffect(() => {
    if (!audio) {
      console.error("Audio player not initialized");
      return;
    }

    console.log("Audio player effect", playerStore);
    console.trace();

    if (!playerStore.isPlaying) {
      audio.pause();
      return;
    }

    if (audio.src) {
      audio.src = "";
      audio.removeAttribute("src");
    }

    if (!audio.src) {
      if (playerStore.activeTrack) {
        // audio.src = URL.createObjectURL(playerStore.activeTrack?.blob);
        audio.src = playerStore.activeTrack.downloadUrl;
        // safari(iOS) cannot detect the mime type(especially flac) from the binary.
        audio.setAttribute("type", playerStore.activeTrack.mimeType);
        console.log("AAAA", audio.getAttribute("type"));

        console.log(playerStore.activeTrack.mimeType, playerStore.activeTrack.downloadUrl);
      }
      audio.play().catch((error) => {
        playerStore.pause();
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: "error" })
      })
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

  return null;
}