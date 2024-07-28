
export const extractColorFromImage = async (blob: Blob) => {
    return new Promise<number>((resolve, reject) => {
        const worker = new Worker(new URL('./color-from-image-worker.ts', import.meta.url));
        worker.onmessage = (event) => {
            if (event.data.success) {
                resolve(event.data.sourceColor);
            } else {
                reject(event.data.error);
            }
        };
        worker.onerror = (error) => {
            reject(error);
        };
        worker.postMessage(blob);
    });
}