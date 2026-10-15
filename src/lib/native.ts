import { Capacitor, registerPlugin } from '@capacitor/core'
import { encodeWebp, makeTrayIcon } from './encode'
import { LIMITS, type Pack, type Sticker } from './types'
import { blobToBase64 } from './share'
import { muxAnimatedWebp } from './webp'

/** Plugin nativo (android/app/src/main/java/dev/rildo/figurinhas/whatsapp). */
interface WhatsAppStickersPlugin {
  getStatus(): Promise<{ whatsapp: boolean; business: boolean }>
  writePackFile(options: { identifier: string; name: string; data: string }): Promise<void>
  addPack(options: NativePack & { target?: 'whatsapp' | 'business' }): Promise<{ status: 'added' | 'cancelled' }>
  isPackAdded(options: { identifier: string }): Promise<{ added: boolean; whatsapp: boolean; business: boolean }>
}

interface NativePack {
  identifier: string
  name: string
  publisher: string
  imageDataVersion: string
  animated: boolean
  stickers: Array<{ file: string; emojis: string[] }>
}

const WhatsAppStickers = registerPlugin<WhatsAppStickersPlugin>('WhatsAppStickers')

/** Rodando dentro do app Android instalado (Capacitor), e não no navegador. */
export const isNativeApp = () => Capacitor.isNativePlatform()
export const canAddPacksToWhatsApp = () => Capacitor.getPlatform() === 'android'

export const ANDROID_APK_URL = '/download/figurinhas.apk'

export const getWhatsAppStatus = () => WhatsAppStickers.getStatus()
export const isPackAdded = (identifier: string) => WhatsAppStickers.isPackAdded({ identifier })

let placeholderCache: Partial<Record<'static' | 'animated', Blob>> = {}

/**
 * Figurinha transparente para completar o mínimo de 3 do WhatsApp — o mesmo truque do
 * Sticker.ly (StickerContentProvider preenche com "_0702empty0203sticker7467_").
 */
async function placeholder(animated: boolean): Promise<Blob> {
  const key = animated ? 'animated' : 'static'
  const cached = placeholderCache[key]
  if (cached) return cached
  const empty = () => new ImageData(LIMITS.size, LIMITS.size)
  let blob: Blob
  if (animated) {
    // Pacote animado só aceita figurinhas animadas: dois quadros vazios.
    const frames = await Promise.all([0, 1].map(async () => ({ webp: await encodeWebp(empty(), { quality: 10 }), durationMs: 500 })))
    blob = new Blob([muxAnimatedWebp(frames, LIMITS.size, LIMITS.size) as BlobPart], { type: 'image/webp' })
  } else {
    blob = new Blob([(await encodeWebp(empty(), { quality: 10 })) as BlobPart], { type: 'image/webp' })
  }
  placeholderCache = { ...placeholderCache, [key]: blob }
  return blob
}

export interface AddPackResult {
  status: 'added' | 'cancelled'
  padded: number
}

/** Envia o pacote inteiro para o WhatsApp (Android). */
export async function addPackToWhatsApp(
  pack: Pack,
  items: Array<{ sticker: Sticker; blob: Blob }>,
  onProgress?: (fraction: number) => void,
): Promise<AddPackResult> {
  if (items.length === 0) throw new Error('O pacote está vazio.')
  const animated = pack.kind === 'animated'
  const identifier = pack.id
  const files: Array<{ name: string; blob: Blob; emojis: string[] }> = items
    .slice(0, LIMITS.maxStickers)
    .map(({ sticker, blob }, i) => ({ name: `${String(i + 1).padStart(2, '0')}.webp`, blob, emojis: sticker.emojis }))

  const padded = Math.max(0, LIMITS.minStickers - files.length)
  for (let i = 0; i < padded; i++) {
    files.push({ name: `vazia-${i + 1}.webp`, blob: await placeholder(animated), emojis: [] })
  }

  const trayBlob = await makeTrayIcon((items.find((s) => s.sticker.id === pack.trayStickerId) ?? items[0]).blob)
  const uploads = [{ name: 'tray.png', blob: trayBlob }, ...files]
  for (const [i, file] of uploads.entries()) {
    await WhatsAppStickers.writePackFile({ identifier, name: file.name, data: await blobToBase64(file.blob) })
    onProgress?.((i + 1) / uploads.length)
  }

  const result = await WhatsAppStickers.addPack({
    identifier,
    name: pack.title.slice(0, LIMITS.maxTitle),
    publisher: (pack.author || 'Figurinhas').slice(0, LIMITS.maxAuthor),
    // Muda sempre que o pacote muda, para o WhatsApp buscar as figurinhas de novo.
    imageDataVersion: String(pack.updatedAt),
    animated,
    stickers: files.map((f) => ({ file: f.name, emojis: f.emojis })),
  })
  return { status: result.status, padded }
}
