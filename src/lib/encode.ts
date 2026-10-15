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

// Mesma escada do Sticker.ly: começa alto e desce de 10 em 10 até caber em 100 KB.
const STATIC_QUALITIES = [90, 80, 70, 60, 50, 40, 30, 20, 10, 0]

/** Figurinha estática: 512×512, ≤100 KB. Baixa a qualidade até caber. */
export async function encodeStaticSticker(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of STATIC_QUALITIES) {
    const bytes = await encodeWebp(readPixels(canvas), { quality, method: 6, alpha_quality: 90 })
    if (bytes.length <= LIMITS.staticBytes) return new Blob([bytes as BlobPart], { type: 'image/webp' })
  }
  throw new Error('Não foi possível deixar a figurinha com menos de 100 KB.')
}

export interface AnimatedSource {
  /** Duração do trecho, em segundos. */
  duration: number
  /** Desenha o instante `time` (segundos a partir do início do trecho) no canvas 512×512. */
  draw: (time: number, canvas: HTMLCanvasElement) => Promise<void>
}

export interface AnimatedResult {
  blob: Blob
  fps: number
  quality: number
  /** Quadros que entraram no arquivo final (após juntar repetidos/descartar para caber). */
  frames: number
  /** O ajuste automático precisou reduzir qps ou descartar quadros. */
  reduced: boolean
}

const FPS_STEPS = [20, 15, 12, 10, 8, 6, 5]
const SAMPLE_POINTS = [0.08, 0.36, 0.64, 0.92]
// Margem para o contêiner RIFF/ANMF e para a variação entre os quadros amostrados e o resto.
const SAFETY = 1.04
const MIN_SHARP_QUALITY = 20
const MIN_SHARP_FPS = 8

const animOptions = (quality: number) => ({ quality, method: 4, alpha_quality: 70, sns_strength: 70, filter_strength: 50 })

/**
 * Figurinha animada: 512×512, ≤500 KB, ≤10 s. Mesma técnica do Sticker.ly (cada quadro em WebP
 * pelo libwebp e depois junta), mas com controle de tamanho que sempre termina:
 *  1. mede quadros de amostra para achar a maior qualidade que cabe;
 *  2. se nem a qualidade mínima cabe, reduz os quadros por segundo;
 *  3. no fim, se ainda passar, junta quadros vizinhos (como o Sticker.ly corta além de 10 s).
 */
export async function encodeAnimatedSticker(
  source: AnimatedSource,
  preferredFps: number,
  onProgress: (p: number) => void,
): Promise<AnimatedResult> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = LIMITS.size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const budget = LIMITS.animatedBytes - 4096
  const duration = Math.min(source.duration, LIMITS.maxAnimationMs / 1000)
  const grab = () => ctx.getImageData(0, 0, LIMITS.size, LIMITS.size)

  // 1. Amostras
  const samples: ImageData[] = []
  for (const point of SAMPLE_POINTS) {
    await source.draw(point * duration, canvas)
    samples.push(grab())
    onProgress((samples.length / SAMPLE_POINTS.length) * 0.08)
  }
  const sizeCache = new Map<number, number>()
  const meanSize = async (quality: number) => {
    const cached = sizeCache.get(quality)
    if (cached != null) return cached
    let total = 0
    for (const s of samples) {
      // encodeWebp transfere o buffer, então cada medida usa uma cópia.
      total += (await encodeWebp(new ImageData(new Uint8ClampedArray(s.data), s.width, s.height), animOptions(quality))).length
    }
    const mean = (total / samples.length) * SAFETY
    sizeCache.set(quality, mean)
    return mean
  }

  // 2. Escolhe qps e qualidade: a maior qualidade que cabe em cada qps.
  const bestQuality = async (candidateFps: number) => {
    const perFrame = budget / Math.max(2, Math.round(duration * candidateFps))
    if ((await meanSize(0)) > perFrame) return -1
    let lo = 0
    let hi = 90
    while (hi - lo > 3) {
      const mid = Math.round((lo + hi) / 2)
      if ((await meanSize(mid)) <= perFrame) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  // Prefere o qps pedido; se a imagem ficar muito borrada, troca fluidez por nitidez (até 8 qps).
  const fpsOptions = [preferredFps, ...FPS_STEPS.filter((f) => f < preferredFps)]
  let fps = fpsOptions[fpsOptions.length - 1]
  let quality = 0
  let fallback: { fps: number; quality: number } | null = null
  for (const candidate of fpsOptions) {
    const q = await bestQuality(candidate)
    if (q < 0) continue
    fallback ??= { fps: candidate, quality: q }
    if (q >= MIN_SHARP_QUALITY || candidate <= MIN_SHARP_FPS) {
      fps = candidate
      quality = q
      fallback = null
      break
    }
  }
  if (fallback) ({ fps, quality } = fallback)
  onProgress(0.15)

  // 3. Codifica todos os quadros
  const count = Math.max(2, Math.round(duration * fps))
  let frames: AnimFrame[] = []
  for (let i = 0; i < count; i++) {
    await source.draw(i / fps, canvas)
    const webp = await encodeWebp(grab(), animOptions(quality))
    const durationMs = Math.round(((i + 1) * 1000) / fps) - Math.round((i * 1000) / fps)
    const previous = frames[frames.length - 1]
    // Quadro idêntico ao anterior (ex.: vídeo parado): só estende a duração.
    if (previous && previous.webp.length === webp.length && previous.webp.every((b, j) => b === webp[j])) {
      previous.durationMs += durationMs
    } else {
      frames.push({ webp, durationMs })
    }
    onProgress(0.15 + ((i + 1) / count) * 0.85)
  }

  // 4. Garantia final: junta pares de quadros até caber.
  const total = () => frames.reduce((n, f) => n + f.webp.length + 24, 0)
  let dropped = false
  while (total() > budget && frames.length > 2) {
    frames = frames.flatMap((f, i, all) => (i % 2 === 0 ? [{ ...f, durationMs: f.durationMs + (all[i + 1]?.durationMs ?? 0) }] : []))
    dropped = true
  }
  if (total() > budget) throw new Error('Não foi possível deixar a figurinha com menos de 500 KB.')

  const blob = new Blob([muxAnimatedWebp(frames, LIMITS.size, LIMITS.size) as BlobPart], { type: 'image/webp' })
  return { blob, fps, quality, frames: frames.length, reduced: dropped || fps < preferredFps }
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
