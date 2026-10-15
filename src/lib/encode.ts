import type { EncodeOptions } from '@jsquash/webp/meta'
import type { EncodeRequest, EncodeResponse } from './encoder.worker'
import { LIMITS } from './types'
import { muxAnimatedWebp, type AnimFrame } from './webp'

// O Safari não gera WebP com canvas.toBlob, então usamos o libwebp (WASM) num worker.
let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./encoder.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<EncodeResponse>) => {
      const job = pending.get(event.data.id)
      if (!job) return
      pending.delete(event.data.id)
      if ('error' in event.data) job.reject(new Error(event.data.error))
      else job.resolve(new Uint8Array(event.data.buffer))
    }
  }
  return worker
}

export function encodeWebp(image: ImageData, options: Partial<EncodeOptions>): Promise<Uint8Array> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    const req: EncodeRequest = { id, image, options }
    getWorker().postMessage(req, [image.data.buffer])
  })
}

function readPixels(canvas: HTMLCanvasElement | OffscreenCanvas): ImageData {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}

const STATIC_QUALITIES = [90, 80, 70, 60, 50, 40, 30, 20]

/** Figurinha estática: 512×512, ≤100 KB. Baixa a qualidade até caber. */
export async function encodeStaticSticker(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of STATIC_QUALITIES) {
    const bytes = await encodeWebp(readPixels(canvas), { quality, method: 6, alpha_quality: 90 })
    if (bytes.length <= LIMITS.staticBytes) return new Blob([bytes as BlobPart], { type: 'image/webp' })
  }
  throw new Error('Não foi possível deixar a figurinha com menos de 100 KB.')
}

export interface FrameSource {
  frameCount: number
  /** Desenha o quadro i no canvas 512×512. */
  draw: (index: number, canvas: HTMLCanvasElement) => Promise<void>
}

/**
 * Figurinha animada: ≤500 KB. Cada quadro é codificado assim que é desenhado (sem guardar
 * todos na memória do iPhone); se o resultado passar do limite, recodifica com qualidade menor.
 */
export async function encodeAnimatedSticker(
  source: FrameSource,
  fps: number,
  onProgress: (p: number) => void,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = LIMITS.size
  const budget = LIMITS.animatedBytes - 2048
  // Chute inicial a partir do orçamento por quadro.
  const perFrame = budget / source.frameCount
  let quality = perFrame > 12_000 ? 70 : perFrame > 7_000 ? 55 : perFrame > 4_000 ? 40 : 25

  for (let attempt = 0; attempt < 4; attempt++) {
    const frames: AnimFrame[] = []
    let total = 0
    for (let i = 0; i < source.frameCount; i++) {
      await source.draw(i, canvas)
      const webp = await encodeWebp(readPixels(canvas), { quality, method: 4, alpha_quality: 80 })
      const durationMs = Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps)
      frames.push({ webp, durationMs: Math.max(LIMITS.minFrameMs, durationMs) })
      total += webp.length
      onProgress((attempt + (i + 1) / source.frameCount) / (attempt + 1))
    }
    if (total <= budget) {
      return new Blob([muxAnimatedWebp(frames, LIMITS.size, LIMITS.size) as BlobPart], { type: 'image/webp' })
    }
    if (quality <= 5) break
    quality = Math.max(5, Math.floor(quality * Math.min(0.85, budget / total) - 5))
  }
  throw new Error('O vídeo ficou grande demais. Diminua a duração ou os quadros por segundo.')
}

/** Ícone da bandeja: PNG 96×96, ≤50 KB. */
export async function makeTrayIcon(stickerBlob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(stickerBlob)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = LIMITS.trayIconSize
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, LIMITS.trayIconSize, LIMITS.trayIconSize)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao gerar ícone'))), 'image/png'),
  )
}

export async function webpToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao converter'))), 'image/png'),
  )
}
