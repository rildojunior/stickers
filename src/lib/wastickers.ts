import { strFromU8, strToU8, unzip, zip, type Unzipped } from 'fflate'
import { makeTrayIcon } from './encode'
import { uid } from './id'
import { LIMITS, type Pack, type Sticker } from './types'
import { isAnimatedWebp } from './webp'

/**
 * Formato `.wastickers`: um ZIP com title.txt, author.txt, um PNG de bandeja e as figurinhas .webp.
 * É o formato aberto mais aceito pelos apps de figurinhas (inclusive o projeto de referência).
 */
export async function exportPack(pack: Pack, stickers: Array<{ sticker: Sticker; blob: Blob }>): Promise<Blob> {
  const files: Record<string, Uint8Array> = {
    'title.txt': strToU8(pack.title),
    'author.txt': strToU8(pack.author),
  }
  const tray = stickers.find((s) => s.sticker.id === pack.trayStickerId) ?? stickers[0]
  if (tray) files['tray.png'] = new Uint8Array(await (await makeTrayIcon(tray.blob)).arrayBuffer())
  const emojis: Record<string, string[]> = {}
  for (const [i, { sticker, blob }] of stickers.entries()) {
    const name = `${String(i + 1).padStart(2, '0')}.webp`
    files[name] = new Uint8Array(await blob.arrayBuffer())
    if (sticker.emojis.length) emojis[name] = sticker.emojis
  }
  files['emojis.json'] = strToU8(JSON.stringify(emojis))
  const data = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out))),
  )
  return new Blob([data as BlobPart], { type: 'application/zip' })
}

export interface ImportedPack {
  pack: Pack
  stickers: Array<{ sticker: Sticker; blob: Blob }>
  skipped: number
}

const readText = (files: Unzipped, name: string) => {
  const key = Object.keys(files).find((k) => k.split('/').pop()?.toLowerCase() === name)
  return key ? strFromU8(files[key]).trim() : null
}

export async function importPack(file: Blob, fallbackTitle: string): Promise<ImportedPack> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const files = await new Promise<Unzipped>((resolve, reject) =>
    unzip(bytes, (err, out) => (err ? reject(new Error('Arquivo inválido: não é um ZIP.')) : resolve(out))),
  )

  let title = readText(files, 'title.txt')
  let author = readText(files, 'author.txt')
  let emojiMap: Record<string, string[]> = {}
  const emojiJson = readText(files, 'emojis.json')
  if (emojiJson) {
    try {
      emojiMap = JSON.parse(emojiJson)
    } catch {
      emojiMap = {}
    }
  }
  // Formato do app de referência (lolocomotive/stickers): pack.json
  const packJson = readText(files, 'pack.json')
  if (packJson) {
    try {
      const meta = JSON.parse(packJson) as { title?: string; author?: string; stickers?: Array<{ source?: string; emojis?: string[] }> }
      title ??= meta.title ?? null
      author ??= meta.author ?? null
      for (const s of meta.stickers ?? []) {
        if (s.source && s.emojis) emojiMap[s.source.split('/').pop()!] = s.emojis
      }
    } catch {
      // ignora metadados inválidos
    }
  }

  const packId = uid()
  const now = Date.now()
  const webps = Object.keys(files)
    .filter((k) => k.toLowerCase().endsWith('.webp') && !k.split('/').pop()!.startsWith('.'))
    .sort()

  const stickers: ImportedPack['stickers'] = []
  let kind: Pack['kind'] = null
  let skipped = 0
  for (const name of webps) {
    const data = files[name]
    const stickerKind = isAnimatedWebp(data) ? 'animated' : 'static'
    kind ??= stickerKind
    if (stickerKind !== kind || stickers.length >= LIMITS.maxStickers) {
      skipped++
      continue
    }
    const base = name.split('/').pop()!
    stickers.push({
      sticker: {
        id: uid(),
        packId,
        kind: stickerKind,
        emojis: (emojiMap[base] ?? []).slice(0, LIMITS.maxEmojis),
        bytes: data.length,
        createdAt: now,
      },
      blob: new Blob([data as BlobPart], { type: 'image/webp' }),
    })
  }
  if (stickers.length === 0) throw new Error('Nenhuma figurinha .webp encontrada no arquivo.')

  return {
    pack: {
      id: packId,
      title: (title || fallbackTitle).slice(0, LIMITS.maxTitle),
      author: (author || '').slice(0, LIMITS.maxAuthor),
      kind,
      stickerIds: stickers.map((s) => s.sticker.id),
      trayStickerId: null,
      createdAt: now,
      updatedAt: now,
    },
    stickers,
    skipped,
  }
}
