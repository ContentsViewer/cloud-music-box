'use client'

import { useEffect, useRef, useState } from "react";
import { usePlayerStore, AudioTrack } from "../stores/player-store";
import { enqueueSnackbar } from "notistack";
import { useFileStore } from "../stores/file-store";

const getPlayableSourceUrl = (track: AudioTrack) => {
  if (track.blob) {
    console.log("Using blob URL")
    return URL.createObjectURL(track.blob);
  }

  console.log("Using remote URL")
  return track.remoteUrl;
}

export const AudioPlayer = () => {
  const [playerState, playerDispatch] = usePlayerStore();
  const fileStore = useFileStore();

  const fileStoreRef = useRef(fileStore);
  fileStoreRef.current = fileStore;

  const audioRef = useRef<HTMLAudioElement>(null);
  const sourceRef = useRef<HTMLSourceElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    const source = sourceRef.current;
    if (!audio || !source) return;

    console.log(audio)

    const onError = (error: any) => {
      console.log(error);
      playerDispatch({ type: "pause" });
      enqueueSnackbar(`${error}`, { variant: "error" });
    }

    const onDurationChange = () => {

    }
    const onTimeUpdate = () => {

    }

    const onEnded = () => {
      console.log("Track ended")
      playerDispatch({ type: "playNextTrack", payload: { fileStore: fileStoreRef.current } });
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
  }, [playerDispatch])

  useEffect(() => {
    const audio = audioRef.current;
    const source = sourceRef.current;

    if (!audio || !source) {
      console.error("Audio player not initialized");
      return;
    }

    console.log("Audio player effect", playerState);

    if (!playerState.isPlaying) {
      audio.pause();
      return;
    }

    if (source.src) {
      source.src = "";
      source.removeAttribute("src");
    }

    if (!source.src) {
      if (playerState.activeTrack) {
        const src = getPlayableSourceUrl(playerState.activeTrack);
        if (src) {
          source.src = src;
          // safari(iOS) cannot detect the mime type(especially flac) from the binary.
          source.type = playerState.activeTrack.file.mimeType;
          console.log("Setting source", src, source.type)
        }
      }
      // audio.pause();
      audio.load();
      audio.play().catch((error) => {
        playerDispatch({ type: "pause" });

        console.error(error);
        enqueueSnackbar(`${error}`, { variant: "error" })
      })
      enqueueSnackbar("Playing", { variant: "info" });
    }
  }, [playerState, playerDispatch]);


  useEffect(() => {
    const ms = window.navigator.mediaSession;
    if (!ms) {
      return;
    }

    console.log("Setting media session handlers");

    ms.setActionHandler("play", () => {
      console.log("Play");
      playerDispatch({ type: "play" });
    });
    ms.setActionHandler("pause", () => {
      console.log("Pause");
      playerDispatch({ type: "pause" });
    });
    ms.setActionHandler("previoustrack", () => {
      // playPreviousTrack();
    });
    ms.setActionHandler("nexttrack", () => {
      console.log("Click next track")
      playerDispatch({ type: "playNextTrack", payload: { fileStore: fileStoreRef.current } });
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
      console.log("Unsetting media session handlers");
    };
  }, [playerDispatch]);

  useEffect(() => {
    const ms = window.navigator.mediaSession;
    if (!ms) return;

    if (playerState.activeTrack) {
      console.log("Setting metadata", playerState.activeTrack.file.name);
      ms.metadata = new MediaMetadata({
        title: playerState.activeTrack.file.name,
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

    ms.playbackState = playerState.isPlaying ? "playing" : "paused";

    return () => {
      ms.metadata = null;
    }
  }, [playerState])

  return (
    <audio ref={audioRef}>
      <source ref={sourceRef} />
    </audio>
  );
}