'use client'

import { useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../stores/player-store";
import { enqueueSnackbar } from "notistack";

export const AudioPlayer = () => {
  // const [audio, setAudio] = useState<HTMLAudioElement | undefined>();
  const playerStore = usePlayerStore();

  const audioRef = useRef<HTMLAudioElement>(null);
  const sourceRef = useRef<HTMLSourceElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    const source = sourceRef.current;
    if (!audio || !source) return;

    // const audio = new Audio();

    const onEnded = () => {
      // playerStore.pause();
      console.log("Track ended");

      setTimeout(() => {
        console.log("Next track");
      }, 2000);
    }
    const onError = (error: any) => {
      console.log(error);
    }

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    // setAudio(audio);

    console.log("Audio player initialized");

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      source.removeAttribute("src");
      source.removeAttribute("type");
      audio.load();
      console.log("Audio player disposed");
    }
  }, [audioRef])

  useEffect(() => {
    const audio = audioRef.current;
    const source = sourceRef.current;

    if (!audio || !source) {
      console.error("Audio player not initialized");
      return;
    }

    console.log("Audio player effect", playerStore);
    // console.trace();

    if (!playerStore.isPlaying) {
      audio.pause();
      return;
    }

    if (source.src) {
      source.src = "";
      source.removeAttribute("src");
    }

    if (!source.src) {
      if (playerStore.activeTrack) {
        // audio.src = URL.createObjectURL(playerStore.activeTrack?.blob);
        source.src = playerStore.activeTrack.downloadUrl;
        // safari(iOS) cannot detect the mime type(especially flac) from the binary.
        source.type = playerStore.activeTrack.mimeType;
        // audio.setAttribute("type", playerStore.activeTrack.mimeType);
        // console.log("AAAA", audio.getAttribute("type"));

        console.log(playerStore.activeTrack.mimeType, playerStore.activeTrack.downloadUrl);
      }
      audio.pause();
      audio.load();
      audio.play().catch((error) => {
        playerStore.pause();
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: "error" })
      })
      enqueueSnackbar("Playing", { variant: "info" });
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

  return (
    <audio ref={audioRef}>
      <source ref={sourceRef} />
    </audio>
  );
}