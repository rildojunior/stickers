import { motion } from 'motion/react'
import { useState } from 'react'
import { namedFile, shareFiles, stickerFile } from '../lib/share'
import { LIMITS, type StickerKind } from '../lib/types'
import { exportPack } from '../lib/wastickers'
import { useBlobs, useStore } from '../store'
import { useFeedback } from '../ui/feedback'
import { Icon } from '../ui/Icon'
import { NavBar } from '../ui/NavBar'
import { spring } from '../ui/motion'
import { Sheet } from '../ui/Sheet'
import { ChooseMediaSheet, PackFormSheet, StickerSheet } from './sheets'

export function PackScreen({
  packId,
  onBack,
  onCreate,
  onOpenPack,
}: {
  packId: string
  onBack: () => void
  onCreate: (kind: StickerKind, packId: string) => void
  onOpenPack: (id: string) => void
}) {
  const { packs, stickers, urls, deletePack, getBlob } = useStore()
  const { toast, setBusy } = useFeedback()
  const [scrolled, setScrolled] = useState(false)
  const [openSticker, setOpenSticker] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [choose, setChoose] = useState(false)
  const [exported, setExported] = useState<File | null>(null)
  const pack = packs.find((p) => p.id === packId)
  const blobs = useBlobs(pack?.stickerIds ?? [])

  if (!pack) return <div className="screen" />

  const count = pack.stickerIds.length
  const missing = Math.max(0, LIMITS.minStickers - count)
  const trayId = pack.trayStickerId ?? pack.stickerIds[0]
  const full = count >= LIMITS.maxStickers
  const allLoaded = pack.stickerIds.every((id) => blobs[id])

  // Envia todas de uma vez pela folha do sistema (o WhatsApp recebe várias imagens).
  const sendAll = () => {
    if (!allLoaded || count === 0) return
    const files = pack.stickerIds.map((id, i) => stickerFile(blobs[id], `${pack.title}-${i + 1}`))
    shareFiles(files).catch(() => toast('Não foi possível compartilhar.'))
  }

  const exportZip = async () => {
    setMenu(false)
    setBusy({ label: 'Gerando .wastickers…' })
    try {
      const items = await Promise.all(
        pack.stickerIds.map(async (id) => ({ sticker: stickers[id], blob: (await getBlob(id))! })),
      )
      const zip = await exportPack(pack, items)
      // O Safari só abre o compartilhamento num toque novo, então mostramos o arquivo pronto.
      setExported(namedFile(zip, pack.title, 'wastickers', 'application/zip'))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Falha ao exportar.')
    } finally {
      setBusy(null)
    }
  }

  const add = () => {
    if (full) {
      toast('O WhatsApp aceita no máximo 30 figurinhas por pacote.')
      return
    }
    if (pack.kind) onCreate(pack.kind, pack.id)
    else setChoose(true)
  }

  return (
    <div className="screen" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 60)}>
      <NavBar
        title={pack.title}
        scrolled={scrolled}
        leading={
          <button className="btn-bar" onClick={onBack} style={{ paddingLeft: 0 }}>
            <Icon name="back" size={26} /> Figurinhas
          </button>
        }
        trailing={
          <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Mais opções">
            <Icon name="more" />
          </button>
        }
      />

      <main className="screen-content">
        <div className="pack-hero">
          <span className="pack-tray">{trayId && urls[trayId] ? <img src={urls[trayId]} alt="" /> : <Icon name="sticker" size={28} />}</span>
          <div style={{ minWidth: 0 }}>
            <h1 className="t-title2" style={{ margin: 0, overflowWrap: 'anywhere' }}>
              {pack.title}
            </h1>
            <div className="t-subhead">{pack.author || 'Sem autor'}</div>
            <div className="t-footnote" style={{ display: 'flex', gap: '0.375rem', marginTop: '0.25rem' }}>
              <span className="badge">{pack.kind === 'animated' ? 'Animado' : pack.kind === 'static' ? 'Estático' : 'Vazio'}</span>
              <span className="badge">
                {count}/{LIMITS.maxStickers}
              </span>
            </div>
          </div>
        </div>

        <div className="actions-row">
          <button className="action-tile press" onClick={sendAll} disabled={!count || !allLoaded}>
            <Icon name="share" /> Enviar todas
          </button>
          <button className="action-tile press" onClick={exportZip} disabled={!count}>
            <Icon name="download" /> Exportar
          </button>
          <button className="action-tile press" onClick={() => setEditing(true)}>
            <Icon name="pencil" /> Editar
          </button>
        </div>

        {missing > 0 && (
          <div className="banner">
            <div style={{ flex: 1 }}>
              <div className="t-headline" style={{ fontSize: '0.9375rem' }}>
                {count === 0 ? 'Pacote vazio' : `Faltam ${missing} para completar o pacote`}
              </div>
              <div className="t-footnote">Um pacote do WhatsApp precisa de pelo menos {LIMITS.minStickers} figurinhas.</div>
              <div className="progress-track" style={{ marginTop: '0.5rem' }}>
                <div className="progress-fill" style={{ width: `${(count / LIMITS.minStickers) * 100}%` }} />
              </div>
            </div>
          </div>
        )}

        <div className="sticker-grid">
          {pack.stickerIds.map((id, i) => (
            <motion.button
              key={id}
              layout
              className="sticker-cell press"
              onClick={() => setOpenSticker(id)}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...spring, delay: Math.min(i, 12) * 0.015 }}
              aria-label={`Figurinha ${i + 1}`}
            >
              {urls[id] && <img src={urls[id]} alt="" loading="lazy" />}
              {stickers[id]?.emojis.length > 0 && <span className="sticker-cell-emoji">{stickers[id].emojis.join('')}</span>}
            </motion.button>
          ))}
          {!full && (
            <motion.button layout className="sticker-cell press" data-add="true" onClick={add} aria-label="Adicionar figurinha">
              <Icon name="plus" size={30} />
            </motion.button>
          )}
        </div>
      </main>

      <StickerSheet stickerId={openSticker} onClose={() => setOpenSticker(null)} onOpenPack={onOpenPack} />
      <PackFormSheet open={editing} pack={pack} onClose={() => setEditing(false)} />
      <ChooseMediaSheet
        open={choose}
        allowed={pack.kind}
        onClose={() => setChoose(false)}
        onPick={(kind) => {
          setChoose(false)
          onCreate(kind, pack.id)
        }}
      />

      <Sheet open={menu} onClose={() => setMenu(false)} title={pack.title}>
        <div className="group">
          <button
            className="row"
            onClick={() => {
              setMenu(false)
              setEditing(true)
            }}
          >
            <Icon name="pencil" />
            <span className="row-label">Editar nome e autor</span>
          </button>
          <button className="row" onClick={exportZip} disabled={!count}>
            <Icon name="download" />
            <span className="row-label">Exportar .wastickers</span>
          </button>
          <button
            className="row"
            data-tone="danger"
            onClick={() => {
              setMenu(false)
              setConfirmDelete(true)
            }}
          >
            <Icon name="trash" />
            <span className="row-label">Apagar pacote</span>
          </button>
        </div>
        <div className="group-footer t-caption">
          O arquivo .wastickers funciona como backup e pode ser importado em outros apps de figurinhas.
        </div>
      </Sheet>

      <Sheet open={!!exported} onClose={() => setExported(null)} title="Pacote exportado">
        <p className="t-subhead" style={{ textAlign: 'center', marginTop: 0 }}>
          {exported?.name} · {exported ? Math.round(exported.size / 1024) : 0} KB
        </p>
        <div className="stack">
          <button
            className="btn press"
            data-variant="primary"
            onClick={() => {
              if (!exported) return
              shareFiles([exported])
                .then((r) => r !== 'cancelled' && setExported(null))
                .catch(() => toast('Não foi possível compartilhar.'))
            }}
          >
            <Icon name="share" /> Compartilhar ou salvar em Arquivos
          </button>
        </div>
      </Sheet>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Apagar pacote?">
        <p className="t-subhead" style={{ textAlign: 'center', marginTop: 0 }}>
          As {count} figurinhas de “{pack.title}” serão apagadas deste aparelho. Isso não pode ser desfeito.
        </p>
        <div className="stack">
          <button
            className="btn press"
            data-variant="danger"
            onClick={async () => {
              setConfirmDelete(false)
              onBack()
              await deletePack(pack.id)
              toast('Pacote apagado')
            }}
          >
            Apagar pacote
          </button>
          <button className="btn press" onClick={() => setConfirmDelete(false)}>
            Cancelar
          </button>
        </div>
      </Sheet>
    </div>
  )
}
