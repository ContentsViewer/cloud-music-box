'use client'

import { BaseFileItem, useFileStore } from '@/src/stores/file-store';
import { enqueueSnackbar } from 'notistack';
import { Suspense, useEffect, useRef, useState } from 'react'
import { FileList } from '@/src/components/file-list';
import { useParams, usePathname, useSearchParams } from "next/navigation";


export default function Page() {

  const [fileStoreState, fileStoreActions] = useFileStore();
  const fileStoreActionsRef = useRef(fileStoreActions);
  fileStoreActionsRef.current = fileStoreActions;

  const [files, setFiles] = useState<BaseFileItem[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const params = useParams();

  useEffect(() => {
    setFolderId(window.location.hash.slice(1));
  }, [params])

  useEffect(() => {
    if (!fileStoreState.configured) {
      return;
    }

    const getFiles = async () => {
      if (!folderId) {
        return;
      }
      try {
        const files = await fileStoreActionsRef.current.getChildren(folderId);
        setFiles(files);

      } catch (error) {
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: "error" });
      }
    }
    getFiles();
  }, [fileStoreState, folderId])

  return (
    <FileList files={files} />
  )
}
