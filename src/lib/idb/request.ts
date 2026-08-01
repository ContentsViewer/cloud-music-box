/** Awaits an IDBRequest. The only IndexedDB helper the app needs — there is no
 *  wrapper library, stores are addressed by string literals at the call site. */
export function idbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = event => {
      resolve((event.target as IDBRequest).result)
    }
    request.onerror = event => {
      reject((event.target as IDBRequest).error)
    }
  })
}
