'use client'

import { BaseFileItem, useFileStore } from '@/src/stores/file-store';
import { enqueueSnackbar } from 'notistack';
import { Suspense, useEffect, useState } from 'react'
import { FileList } from '@/src/components/file-list';
import { useParams, usePathname, useSearchParams } from "next/navigation";


export default function Page() {

  const fileStore = useFileStore();
  const [files, setFiles] = useState<BaseFileItem[]>([]);
  // const searchParams = useSearchParams();
  const [folderId, setFolderId] = useState<string | null>(null);
  const params = useParams();
  
  useEffect(() => {
    setFolderId(window.location.hash.slice(1));
  }, [params])

  useEffect(() => {
    if (!fileStore.configured) {
      return;
    }

    const getFiles = async () => {
      if (!folderId) {
        return;
      }
      try {
        const files = await fileStore.getChildren(folderId);
        setFiles(files);

      } catch (error) {
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: "error" });
      }
    }
    getFiles();
  }, [fileStore.configured, folderId])

  return (
    <FileList files={files} />
  )
}
