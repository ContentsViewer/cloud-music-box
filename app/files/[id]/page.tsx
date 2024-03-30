'use client'

import { BaseFileItem, useFileStore } from '@/src/stores/file-store';
import { enqueueSnackbar } from 'notistack';
import { useEffect, useState } from 'react'
import { FileList } from '@/src/components/file-list';

export default function Page({ params }: { params: { id: string } }) {
  const fileStore = useFileStore();
  const [files, setFiles] = useState<BaseFileItem[]>([]);

  useEffect(() => {
    console.log("AAAA", fileStore.configured)
    if (!fileStore.configured) {
      return;
    }

    const getFiles = async () => {
      try {
        const files = await fileStore.getChildren(params.id);
        setFiles(files);
        console.log(files);

      } catch (error) {
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: "error" });
      }
    }
    getFiles();
  }, [fileStore.configured])

  return (
    <FileList files={files} />
  )
}