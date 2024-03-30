'use client'

import { useEffect, useRef, useState } from 'react';
import { MusicTrack, usePlayerStore } from '@/src/stores/player-store';
import { BaseFileItem, useFileStore } from '@/src/stores/file-store';
import { FileList } from '@/src/components/file-list';
import { useRouter } from 'next/navigation';
import { ListItemFile, ListItemFolder } from '@/src/components/list-item';


// function isSupportedAudioFile(name: string) {
//   return name.endsWith('.mp3') || name.endsWith('.wav') || name.endsWith('.flac') || name.endsWith('.ogg');
// }

// let wakeLock: WakeLockSentinel | null = null;

// async function requestWakeLock() {
//   try {
//     if ('wakeLock' in navigator) {
//       wakeLock = await navigator.wakeLock.request('screen');
//       console.log(wakeLock);
//     }
//   } catch (err) {
//     console.error(`${err.name}, ${err.message}`);
//   }
// }

export default function Page() {
  const playerStore = usePlayerStore();
  const fileStore = useFileStore();
  const router = useRouter();
  const { rootFiles } = fileStore;

  return (
    <FileList files={rootFiles} />
  );
}
