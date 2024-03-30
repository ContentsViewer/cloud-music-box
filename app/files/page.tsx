'use client'

import { BaseFileItem, useFileStore } from '@/src/stores/file-store';
import { enqueueSnackbar } from 'notistack';
import { Suspense, useEffect, useState } from 'react'
import { FileList } from '@/src/components/file-list';
import { useSearchParams } from "next/navigation";

function Content() {

  const fileStore = useFileStore();
  const [files, setFiles] = useState<BaseFileItem[]>([]);
  const searchParams = useSearchParams();
  const fileId = searchParams.get("id");


  useEffect(() => {
    if (!fileStore.configured) {
      return;
    }
    console.log(fileId)

    const getFiles = async () => {
      if (!fileId) {
        return;
      }
      try {
        const files = await fileStore.getChildren(fileId);
        setFiles(files);

      } catch (error) {
        console.error(error);
        enqueueSnackbar(`${error}`, { variant: "error" });
      }
    }
    getFiles();
  }, [fileStore.configured, fileId])

  return (
    <FileList files={files} />
  )
}

export default function Page() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  )
}
