'use client'

import { FileList } from '@/src/components/file-list';
import { useFileStore } from '@/src/stores/file-store';


export default function Page() {
  const [fileStoreState] = useFileStore();

  return (
    <FileList files={fileStoreState.rootFiles} />
  );
}
