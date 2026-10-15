import type { BgRequest, BgResponse } from './bg.worker'
import { markBgModelCached } from './bgModel'

let worker: Worker | null = null
let nextId = 0

/** Remove o fundo de uma imagem. Tudo roda localmente; nenhuma foto sai do aparelho. */
export function removeBackground(
  bitmap: ImageBitmap,
  onProgress: (fraction: number | null) => void,
): Promise<ImageBitmap> {
  worker ??= new Worker(new URL('./bg.worker.ts', import.meta.url), { type: 'module' })
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  const id = nextId++
  const w = worker

  return new Promise((resolve, reject) => {
    const onMessage = async (event: MessageEvent<BgResponse>) => {
      const msg = event.data
      if (msg.id !== id) return
      if (msg.type === 'progress') {
        onProgress(msg.total > 0 ? msg.loaded / msg.total : null)
        return
      }
      w.removeEventListener('message', onMessage)
      if (msg.type === 'error') {
        reject(new Error(msg.error))
        return
      }
      markBgModelCached()
      resolve(await createImageBitmap(msg.image))
    }
    w.addEventListener('message', onMessage)
    w.postMessage({ id, image } satisfies BgRequest, [image.data.buffer])
  })
}
