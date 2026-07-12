import type { AudioFrame } from "../stores/audio-dynamics-store"

// オーディオ解析フレームの購読バス。
// React state を経由せず、生成側(audio-player)から購読者(可視化のLogic層)へ
// 同期 push する。再レンダーを起こさず、レンダーサイクル起因の中間値ロスもない。
// React の役割は「マウント時に subscribe し、アンマウント時に解除する」だけ。
type Listener = (frame: AudioFrame) => void

const listeners = new Set<Listener>()
let latest: AudioFrame | null = null

export const audioBus = {
  emit(frame: AudioFrame) {
    latest = frame
    listeners.forEach(l => l(frame))
  },
  /** 購読を開始し、解除関数を返す(useEffect の cleanup にそのまま渡せる) */
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  getLatest: () => latest,
}
