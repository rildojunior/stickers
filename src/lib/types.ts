export type StickerKind = 'static' | 'animated'

export interface Sticker {
  id: string
  packId: string
  kind: StickerKind
  emojis: string[]
  bytes: number
  createdAt: number
}

export interface Pack {
  id: string
  title: string
  author: string
  /** Definido pela primeira figurinha; o WhatsApp não aceita pacotes mistos. */
  kind: StickerKind | null
  stickerIds: string[]
  trayStickerId: string | null
  createdAt: number
  updatedAt: number
}

/** Regras oficiais: github.com/WhatsApp/stickers (Android/README.md) */
export const LIMITS = {
  size: 512,
  trayIconSize: 96,
  trayIconBytes: 50 * 1024,
  staticBytes: 100 * 1024,
  animatedBytes: 500 * 1024,
  maxAnimationMs: 10_000,
  minFrameMs: 8,
  minStickers: 3,
  maxStickers: 30,
  maxEmojis: 3,
  maxTitle: 128,
  maxAuthor: 128,
} as const
