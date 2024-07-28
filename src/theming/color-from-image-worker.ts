import {
    argbFromRgb,
    QuantizerCelebi,
    Score,
} from '@material/material-color-utilities'

const extractColorFromImage = async (blob: Blob): Promise<number> => {
    const bitmap = await createImageBitmap(blob)
    const { width: orgWidth, height: orgHeight } = bitmap

    const scale = Math.min(128 / orgWidth, 128 / orgHeight)
    const width = Math.floor(orgWidth * scale)
    const height = Math.floor(orgHeight * scale)

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Failed to get 2d context')
    }
    ctx.drawImage(bitmap, 0, 0, width, height)

    const imageBytes = ctx.getImageData(0, 0, width, height).data
    const pixels: number[] = []
    for (let i = 0; i < imageBytes.length; i += 4) {
        const r = imageBytes[i]
        const g = imageBytes[i + 1]
        const b = imageBytes[i + 2]
        const a = imageBytes[i + 3]
        if (a >= 255) {
            const argb = argbFromRgb(r, g, b)
            pixels.push(argb)
        }
    }
    // Convert Pixels to Material Colors
    const result = QuantizerCelebi.quantize(pixels, 128)
    const ranked = Score.score(result)
    const top = ranked[0]
    return top
}

self.onmessage = async (event: MessageEvent<Blob>) => {
    try {
        const top = await extractColorFromImage(event.data)
        self.postMessage({ success: true, sourceColor: top });
    } catch (error) {
        self.postMessage({ success: false, error: error });
    } finally {
        self.close();
    }
}