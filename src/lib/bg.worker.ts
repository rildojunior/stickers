import { env, pipeline, RawImage, type BackgroundRemovalPipeline } from '@huggingface/transformers'
import { BG_MODEL } from './bgModel'

export type BgRequest = { id: number; image: ImageData }
export type BgResponse =
  | { id: number; type: 'progress'; loaded: number; total: number }
  | { id: number; type: 'done'; image: ImageData }
  | { id: number; type: 'error'; error: string }

env.allowLocalModels = false

let segmenter: Promise<BackgroundRemovalPipeline> | null = null
const post = (msg: BgResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = async (event: MessageEvent<BgRequest>) => {
  const { id, image } = event.data
  try {
    const files = new Map<string, { loaded: number; total: number }>()
    segmenter ??= pipeline('background-removal', BG_MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status !== 'progress' || !p.file) return
        files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
        let loaded = 0
        let total = 0
        for (const f of files.values()) {
          loaded += f.loaded
          total += f.total
        }
        post({ id, type: 'progress', loaded, total })
      },
    }) as Promise<BackgroundRemovalPipeline>
    const remove = await segmenter
    const input = new RawImage(image.data, image.width, image.height, 4)
    const result = (await remove(input)) as RawImage
    const rgba = result.channels === 4 ? result : result.rgba()
    const out = new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height)
    post({ id, type: 'done', image: out }, [out.data.buffer])
  } catch (err) {
    segmenter = null
    post({ id, type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
