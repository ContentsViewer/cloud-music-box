'use client'

import { useEffect, useRef, useState } from "react";
import { usePlayerStore, AudioTrack } from "../stores/player-store";
import { enqueueSnackbar } from "notistack";

const getPlayableSourceUrl = (track: AudioTrack) => {
  if (track.blob) {
    console.log("Using blob URL")
    return URL.createObjectURL(track.blob);
  }

  console.log("Using remote URL")
  return track.remoteUrl;
}

export const AudioPlayer = () => {
  // const [audio, setAudio] = useState<HTMLAudioElement | undefined>();
  const playerStore = usePlayerStore();

  const audioRef = useRef<HTMLAudioElement>(null);
  const sourceRef = useRef<HTMLSourceElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    const source = sourceRef.current;
    if (!audio || !source) return;

    const onError = (error: any) => {
      console.log(error);
      playerStore.pause();
      enqueueSnackbar(`${error}`, { variant: "error" });
    }

    const onDurationChange = () => {

    }
    const onTimeUpdate = () => {

    }

    const onEnded = () => {
      playerStore.playNextTrack();
    }

    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("timeupdate", onTimeUpdate);

    
    console.log("Audio player initialized");

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("timeupdate", onTimeUpdate);

      audio.pause();
      source.removeAttribute("src");
      source.removeAttribute("type");
      audio.load();
      console.log("Audio player disposed");
    }
  }, [audioRef, playerStore])

  useEffect(() => {
    const audio = audioRef.current;
    const source = sourceRef.current;

    if (!audio || !source) {
      console.error("Audio player not initialized");
      return;
    }

    console.log("Audio player effect", playerStore);

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
        const src = getPlayableSourceUrl(playerStore.activeTrack);
        if (src) {
          source.src = src;
          // safari(iOS) cannot detect the mime type(especially flac) from the binary.
          source.type = playerStore.activeTrack.file.mimeType;
        }
      }
      // audio.pause();
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

    console.log("Setting media session handlers");

    ms.setActionHandler("play", () => {
      console.log("Play");
      playerStore.play();
    });
    ms.setActionHandler("pause", () => {
      console.log("Pause");
      playerStore.pause();
    });
    ms.setActionHandler("previoustrack", () => {
      playerStore.playPreviousTrack();
    });
    ms.setActionHandler("nexttrack", () => {
      playerStore.playNextTrack();
    });
    ms.setActionHandler("seekbackward", null);
    ms.setActionHandler("seekforward", null);

    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("previoustrack", null);
      ms.setActionHandler("nexttrack", null);
      ms.setActionHandler("seekbackward", null);
      ms.setActionHandler("seekforward", null);
    };
  }, [playerStore]);

  useEffect(() => {
    const ms = window.navigator.mediaSession;
    if (!ms) return;

    if (playerStore.activeTrack) {
      console.log("Setting metadata", playerStore.activeTrack.file.name);
      ms.metadata = new MediaMetadata({
        title: playerStore.activeTrack.file.name,
        // artist: playerStore.activeTrack.file.owner,
        // album: playerStore.activeTrack.file.parentId,
        // artwork: [
        //   { src: playerStore.activeTrack.file.thumbnailUrl, sizes: "96x96", type: "image/png" },
        //   { src: playerStore.activeTrack.file.thumbnailUrl, sizes: "128x128", type: "image/png" },
        //   { src: playerStore.activeTrack.file.thumbnailUrl, sizes: "192x192", type: "image/png" },
        //   { src: playerStore.activeTrack.file.thumbnailUrl, sizes: "256x256", type: "image/png" },
        //   { src: playerStore.activeTrack.file.thumbnailUrl, sizes: "384x384", type: "image/png" },
        //   { src: playerStore.activeTrack.file.thumbnailUrl, sizes: "512x512", type: "image/png" },
        // ],
      });
    }

    ms.playbackState = playerStore.isPlaying ? "playing" : "paused";

    return () => {
      ms.metadata = null;
    }
  }, [playerStore])

  return (
    <audio ref={audioRef}>
      <source ref={sourceRef} />
    </audio>
  );
}