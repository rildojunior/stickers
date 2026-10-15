import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as db from './lib/db'
import { uid } from './lib/id'
import { LIMITS, type Pack, type Sticker, type StickerKind } from './lib/types'
import type { ImportedPack } from './lib/wastickers'

interface Store {
  ready: boolean
  packs: Pack[]
  stickers: Record<string, Sticker>
  /** URLs de objeto para exibir as figurinhas. */
  urls: Record<string, string>
  createPack: (title: string, author: string) => Promise<Pack>
  updatePack: (id: string, patch: Partial<Pick<Pack, 'title' | 'author' | 'trayStickerId'>>) => Promise<void>
  deletePack: (id: string) => Promise<void>
  addSticker: (packId: string | null, kind: StickerKind, blob: Blob) => Promise<{ sticker: Sticker; pack: Pack }>
  updateSticker: (id: string, patch: Partial<Pick<Sticker, 'emojis'>>) => Promise<void>
  moveSticker: (id: string, toPackId: string) => Promise<void>
  removeSticker: (id: string) => Promise<() => Promise<void>>
  reorderSticker: (packId: string, id: string, delta: number) => Promise<void>
  importPacks: (imported: ImportedPack) => Promise<void>
  getBlob: (id: string) => Promise<Blob | undefined>
}

const StoreContext = createContext<Store | null>(null)

export const DEFAULT_PACK_TITLES: Record<StickerKind, string> = {
  static: 'Minhas figurinhas',
  animated: 'Minhas animadas',
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [packs, setPacks] = useState<Pack[]>([])
  const [stickers, setStickers] = useState<Record<string, Sticker>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})
  const blobCache = useRef(new Map<string, Blob>())
  const packsRef = useRef(packs)
  packsRef.current = packs
  const stickersRef = useRef(stickers)
  stickersRef.current = stickers

  const exposeBlobs = useCallback((entries: Array<[string, Blob]>) => {
    for (const [id, blob] of entries) blobCache.current.set(id, blob)
    setUrls((prev) => {
      const next = { ...prev }
      for (const [id, blob] of entries) next[id] = URL.createObjectURL(blob)
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const data = await db.loadAll()
      // Limpa figurinhas órfãs (ex.: app fechado durante o "desfazer").
      const referenced = new Set(data.packs.flatMap((p) => p.stickerIds))
      const orphans = data.stickers.filter((s) => !referenced.has(s.id)).map((s) => s.id)
      if (orphans.length) await db.deleteStickers(orphans)
      data.stickers = data.stickers.filter((s) => referenced.has(s.id))
      const ids = data.stickers.map((s) => s.id)
      const blobs = await db.getBlobs(ids)
      if (cancelled) return
      setPacks(data.packs)
      setStickers(Object.fromEntries(data.stickers.map((s) => [s.id, s])))
      exposeBlobs(ids.flatMap((id, i) => (blobs[i] ? [[id, blobs[i]] as [string, Blob]] : [])))
      setReady(true)
      db.requestPersistence()
    })()
    return () => {
      cancelled = true
    }
  }, [exposeBlobs])

  const commitPack = useCallback(async (pack: Pack) => {
    setPacks((prev) => [pack, ...prev.filter((p) => p.id !== pack.id)].sort((a, b) => b.updatedAt - a.updatedAt))
    await db.savePack(pack)
  }, [])

  const createPack = useCallback(
    async (title: string, author: string) => {
      const now = Date.now()
      const pack: Pack = {
        id: uid(),
        title: title.trim().slice(0, LIMITS.maxTitle) || 'Novo pacote',
        author: author.trim().slice(0, LIMITS.maxAuthor),
        kind: null,
        stickerIds: [],
        trayStickerId: null,
        createdAt: now,
        updatedAt: now,
      }
      await commitPack(pack)
      return pack
    },
    [commitPack],
  )

  const findPack = (id: string) => packsRef.current.find((p) => p.id === id)

  const updatePack: Store['updatePack'] = useCallback(
    async (id, patch) => {
      const pack = findPack(id)
      if (pack) await commitPack({ ...pack, ...patch, updatedAt: Date.now() })
    },
    [commitPack],
  )

  const deletePack = useCallback(async (id: string) => {
    const pack = findPack(id)
    if (!pack) return
    setPacks((prev) => prev.filter((p) => p.id !== id))
    setStickers((prev) => {
      const next = { ...prev }
      for (const sid of pack.stickerIds) delete next[sid]
      return next
    })
    await db.deleteStickers(pack.stickerIds)
    await db.deletePackRecord(id)
  }, [])

  const addSticker: Store['addSticker'] = useCallback(
    async (packId, kind, blob) => {
      let pack = packId ? findPack(packId) : undefined
      if (pack && pack.kind && pack.kind !== kind) throw new Error('Este pacote não aceita esse tipo de figurinha.')
      if (pack && pack.stickerIds.length >= LIMITS.maxStickers) throw new Error('Este pacote já tem 30 figurinhas.')
      if (!pack) {
        // Criação rápida: usa o pacote padrão do tipo, ou cria um.
        pack =
          packsRef.current.find(
            (p) => p.title === DEFAULT_PACK_TITLES[kind] && (p.kind ?? kind) === kind && p.stickerIds.length < LIMITS.maxStickers,
          ) ?? (await createPack(DEFAULT_PACK_TITLES[kind], ''))
      }
      const sticker: Sticker = { id: uid(), packId: pack.id, kind, emojis: [], bytes: blob.size, createdAt: Date.now() }
      await db.saveStickerWithBlob(sticker, blob)
      exposeBlobs([[sticker.id, blob]])
      setStickers((prev) => ({ ...prev, [sticker.id]: sticker }))
      const next: Pack = { ...pack, kind, stickerIds: [...pack.stickerIds, sticker.id], updatedAt: Date.now() }
      await commitPack(next)
      return { sticker, pack: next }
    },
    [commitPack, createPack, exposeBlobs],
  )

  const updateSticker: Store['updateSticker'] = useCallback(async (id, patch) => {
    let updated: Sticker | undefined
    setStickers((prev) => {
      if (!prev[id]) return prev
      updated = { ...prev[id], ...patch }
      return { ...prev, [id]: updated }
    })
    if (updated) await db.saveSticker(updated)
  }, [])

  const moveSticker = useCallback(
    async (id: string, toPackId: string) => {
      const sticker = stickersRef.current[id]
      const from = findPack(sticker?.packId ?? '')
      const to = findPack(toPackId)
      if (!sticker || !from || !to || from.id === to.id) return
      if (to.kind && to.kind !== sticker.kind) throw new Error('Esse pacote é de outro tipo (estático/animado).')
      if (to.stickerIds.length >= LIMITS.maxStickers) throw new Error('Esse pacote já tem 30 figurinhas.')
      const moved = { ...sticker, packId: to.id }
      setStickers((prev) => ({ ...prev, [id]: moved }))
      await db.saveSticker(moved)
      const remaining = from.stickerIds.filter((s) => s !== id)
      await commitPack({
        ...from,
        stickerIds: remaining,
        kind: remaining.length ? from.kind : null,
        trayStickerId: from.trayStickerId === id ? null : from.trayStickerId,
        updatedAt: Date.now(),
      })
      await commitPack({ ...to, kind: sticker.kind, stickerIds: [...to.stickerIds, id], updatedAt: Date.now() })
    },
    [commitPack],
  )

  /** Remove e devolve uma função de desfazer (Apple: prefira desfazer a confirmar). */
  const removeSticker = useCallback(
    async (id: string) => {
      const sticker = stickersRef.current[id]
      const pack = findPack(sticker?.packId ?? '')
      if (!sticker || !pack) return async () => {}
      const index = pack.stickerIds.indexOf(id)
      const remaining = pack.stickerIds.filter((s) => s !== id)
      await commitPack({
        ...pack,
        stickerIds: remaining,
        kind: remaining.length ? pack.kind : null,
        trayStickerId: pack.trayStickerId === id ? null : pack.trayStickerId,
        updatedAt: Date.now(),
      })
      let undone = false
      const timer = setTimeout(async () => {
        if (undone) return
        setStickers((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        await db.deleteStickers([id])
      }, 6000)
      return async () => {
        undone = true
        clearTimeout(timer)
        const current = findPack(pack.id)
        if (!current) return
        const ids = [...current.stickerIds]
        ids.splice(Math.min(index, ids.length), 0, id)
        await commitPack({ ...current, kind: sticker.kind, stickerIds: ids, trayStickerId: pack.trayStickerId, updatedAt: Date.now() })
      }
    },
    [commitPack],
  )

  const reorderSticker = useCallback(
    async (packId: string, id: string, delta: number) => {
      const pack = findPack(packId)
      if (!pack) return
      const ids = [...pack.stickerIds]
      const from = ids.indexOf(id)
      const to = Math.max(0, Math.min(ids.length - 1, from + delta))
      if (from < 0 || from === to) return
      ids.splice(from, 1)
      ids.splice(to, 0, id)
      await commitPack({ ...pack, stickerIds: ids, updatedAt: Date.now() })
    },
    [commitPack],
  )

  const importPacks = useCallback(
    async ({ pack, stickers: items }: ImportedPack) => {
      await db.saveMany([pack], items)
      exposeBlobs(items.map(({ sticker, blob }) => [sticker.id, blob]))
      setStickers((prev) => ({ ...prev, ...Object.fromEntries(items.map(({ sticker }) => [sticker.id, sticker])) }))
      setPacks((prev) => [pack, ...prev])
    },
    [exposeBlobs],
  )

  const getBlob = useCallback(async (id: string) => blobCache.current.get(id) ?? (await db.getBlob(id)), [])

  const value = useMemo<Store>(
    () => ({
      ready,
      packs,
      stickers,
      urls,
      createPack,
      updatePack,
      deletePack,
      addSticker,
      updateSticker,
      moveSticker,
      removeSticker,
      reorderSticker,
      importPacks,
      getBlob,
    }),
    [ready, packs, stickers, urls, createPack, updatePack, deletePack, addSticker, updateSticker, moveSticker, removeSticker, reorderSticker, importPacks, getBlob],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore fora do StoreProvider')
  return ctx
}

/** Blobs carregados de antemão, para o compartilhamento acontecer direto no toque. */
export function useBlobs(ids: string[]) {
  const { getBlob } = useStore()
  const [blobs, setBlobs] = useState<Record<string, Blob>>({})
  const key = ids.join(',')
  useEffect(() => {
    let cancelled = false
    Promise.all(key.split(',').filter(Boolean).map(async (id) => [id, await getBlob(id)] as const)).then((entries) => {
      if (!cancelled) setBlobs(Object.fromEntries(entries.filter((e): e is [string, Blob] => !!e[1])))
    })
    return () => {
      cancelled = true
    }
  }, [key, getBlob])
  return blobs
}
