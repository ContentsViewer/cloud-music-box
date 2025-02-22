
import * as mm from "music-metadata-browser"

export interface BaseFileItem {
    name: string
    id: string
    type: "file" | "folder" | "audio-track"
    parentId?: string
}

export interface FileItem extends BaseFileItem {
    type: "file"
}

export interface FolderItem extends BaseFileItem {
    type: "folder"
    childrenIds?: string[]
}

export interface AudioTrackFileItem extends BaseFileItem {
    type: "audio-track"
    mimeType: string
    metadata?: mm.IAudioMetadata
}

export const AUDIO_FORMAT_MAPPING: { [key: string]: { mimeType: string } } = {
    aac: { mimeType: "audio/aac" },
    mp3: { mimeType: "audio/mpeg" },
    ogg: { mimeType: "audio/ogg" },
    wav: { mimeType: "audio/wav" },
    flac: { mimeType: "audio/flac" },
    m4a: { mimeType: "audio/mp4" },
}

export interface BaseDriveClient {
    /**
     * Resets the user state, e.g. by removing all stored tokens.
     */
    resetUser(): Promise<void>
    connect(): Promise<void>
    getRootFolderId(): Promise<string>
    getFile(fileId: string): Promise<BaseFileItem>
    getChildren(folderId: string): Promise<BaseFileItem[]>
    fetchFileBlob(fileId: string): Promise<Blob>
}