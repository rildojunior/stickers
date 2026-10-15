import { createStore, del, delMany, get, getMany, set, setMany, values } from 'idb-keyval'
import type { Pack, Sticker } from './types'

const packsStore = createStore('figurinhas-packs', 'packs')
const stickersStore = createStore('figurinhas-stickers', 'stickers')
const blobsStore = createStore('figurinhas-blobs', 'blobs')

export async function loadAll(): Promise<{ packs: Pack[]; stickers: Sticker[] }> {
  const [packs, stickers] = await Promise.all([values<Pack>(packsStore), values<Sticker>(stickersStore)])
  packs.sort((a, b) => b.updatedAt - a.updatedAt)
  return { packs, stickers }
}

export const savePack = (pack: Pack) => set(pack.id, pack, packsStore)
export const deletePackRecord = (id: string) => del(id, packsStore)

export const saveSticker = (sticker: Sticker) => set(sticker.id, sticker, stickersStore)

export async function saveStickerWithBlob(sticker: Sticker, blob: Blob) {
  await set(sticker.id, blob, blobsStore)
  await set(sticker.id, sticker, stickersStore)
}

export async function deleteStickers(ids: string[]) {
  await delMany(ids, stickersStore)
  await delMany(ids, blobsStore)
}

export const getBlob = (id: string) => get<Blob>(id, blobsStore)
export const getBlobs = (ids: string[]) => getMany<Blob | undefined>(ids, blobsStore)

export async function saveMany(packs: Pack[], stickers: Array<{ sticker: Sticker; blob: Blob }>) {
  await setMany(stickers.map(({ sticker, blob }) => [sticker.id, blob]), blobsStore)
  await setMany(stickers.map(({ sticker }) => [sticker.id, sticker]), stickersStore)
  await setMany(packs.map((p) => [p.id, p]), packsStore)
}

/** Pede ao navegador para não apagar os dados (o Safari apaga após 7 dias sem uso fora da Tela de Início). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) {
      await navigator.storage.persist?.()
    }
  } catch {
    // sem suporte: nada a fazer
  }
}
