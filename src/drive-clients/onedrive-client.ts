import { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import { AUDIO_FORMAT_MAPPING, AudioTrackFileItem, BaseDriveClient, BaseFileItem, FileItem, FolderItem } from './base-drive-client';
import { Client, ResponseType } from '@microsoft/microsoft-graph-client';


export interface OneDriveClient extends BaseDriveClient {
    pca: PublicClientApplication
    accountInfo: AccountInfo | undefined
    connect(): Promise<void>
}

const DB_KEY_ACCOUNT_INFO = "onedrive.accountInfo"

export async function createOneDriveClient(): Promise<OneDriveClient> {
    console.log("createOneDriveClient")
    const pca = new PublicClientApplication({
        auth: {
            clientId: "28af6fb9-c605-4ad3-8039-3e90df0933cb",
            redirectUri: `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ""
                }/redirect`,
        },
        cache: {
            cacheLocation: "localStorage",
        },
    })
    await pca.initialize()

    let accessToken: string | undefined = undefined
    let accountInfo: AccountInfo | undefined = undefined
    let nativeClient: Client | undefined = undefined

    function createFileItemFromGraphItem(item: any): BaseFileItem {
        if (item.folder) {
            return {
                name: item.name,
                id: item.id,
                type: "folder",
                parentId: item.parentReference.id,
            } as FolderItem
        }
        if (item.file) {
            const ext: string = item.name.split(".").pop()
            const audioMimeType = AUDIO_FORMAT_MAPPING[ext]?.mimeType

            if (audioMimeType !== undefined) {
                return {
                    name: item.name,
                    id: item.id,
                    type: "audio-track",
                    parentId: item.parentReference.id,
                    mimeType: audioMimeType,
                } as AudioTrackFileItem
            } else {
                return {
                    name: item.name,
                    id: item.id,
                    type: "file",
                    parentId: item.parentReference.id,
                } as FileItem
            }
        }
        throw new Error("Unknown item type")
    }

    const init = async () => {
        const accountInfoJson = localStorage.getItem(DB_KEY_ACCOUNT_INFO)
        if (accountInfoJson) {
            accountInfo = JSON.parse(accountInfoJson)
        }

        try {
            const response = await pca.handleRedirectPromise()
            if (response) {
                accessToken = response.accessToken
                accountInfo = response.account
                localStorage.setItem(DB_KEY_ACCOUNT_INFO, JSON.stringify(accountInfo))
            }
        } catch (error) {
            console.error(error)
        }
    }

    await init()

    return {
        pca,
        accountInfo,
        async resetUser() {
            accessToken = undefined
            accountInfo = undefined
            nativeClient = undefined
            localStorage.removeItem(DB_KEY_ACCOUNT_INFO)
        },
        async connect() {
            if (!accessToken && accountInfo) {
                const silentRequest = {
                    scopes: ["Files.Read", "Sites.Read.All"],
                    account: accountInfo,
                }
                try {
                    const response = await pca.acquireTokenSilent(silentRequest)
                    if (response) {
                        accessToken = response.accessToken
                        accountInfo = response.account
                        localStorage.setItem(DB_KEY_ACCOUNT_INFO, JSON.stringify(accountInfo))
                    }

                } catch (error) {
                    console.error(error)
                    throw error
                }
            }

            if (!accessToken) {
                throw new Error("No access token")
            }

            nativeClient = Client.init({
                authProvider: (done) => {
                    done(null, accessToken || null)
                }
            })
        },
        async getRootFolderId() {
            if (!nativeClient) {
                throw new Error("Not connected")
            }
            const responseRootFolderId = await nativeClient
                .api("/me/drive/root")
                .get()
            return responseRootFolderId.id
        },
        async getFile(fileId: string) {
            if (!nativeClient) {
                throw new Error("Not connected")
            }
            const response = await nativeClient
                .api(`/me/drive/items/${fileId}`)
                .get()
            return createFileItemFromGraphItem(response)
        },
        async getChildren(folderId: string) {
            if (!nativeClient) {
                throw new Error("Not connected")
            }

            const response: {
                value: any[]
            } = await nativeClient
                .api(`/me/drive/items/${folderId}/children`)
                .get()
            return response.value.map((item: any) => {
                return createFileItemFromGraphItem(item)
            })
        },
        async fetchFileBlob(fileId: string) {
            if (!nativeClient) {
                throw new Error("Not connected")
            }
            // > To download files in a JavaScript app, you can't use the /content API, because this responds with a 302 redirect
            // https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0&tabs=http
            const responseDownloadUrl = await nativeClient
                .api(
                    `/me/drive/items/${fileId}?select=id,@microsoft.graph.downloadUrl`
                )
                .get()
            const downloadUrl = responseDownloadUrl["@microsoft.graph.downloadUrl"]
            const responseBlob = await fetch(downloadUrl)
            return await responseBlob.blob()
        }
    }
}
