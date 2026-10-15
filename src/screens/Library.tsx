import { motion } from 'motion/react'
import { useRef, useState } from 'react'
import { importPack } from '../lib/wastickers'
import { LIMITS, type StickerKind } from '../lib/types'
import { useStore } from '../store'
import { useFeedback } from '../ui/feedback'
import { Icon } from '../ui/Icon'
import { NavBar } from '../ui/NavBar'
import { spring } from '../ui/motion'
import { PackFormSheet } from './sheets'

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export function Library({ onOpenPack, onCreate }: { onOpenPack: (id: string) => void; onCreate: (kind: StickerKind, packId: string | null) => void }) {
  const { packs, urls, ready, importPacks } = useStore()
  const { toast, setBusy } = useFeedback()
  const [scrolled, setScrolled] = useState(false)
  const [newPack, setNewPack] = useState(false)
  const [installHint, setInstallHint] = useState(() => isIOS && !isStandalone && localStorage.getItem('figurinhas.installHint') !== 'off')
  const importInput = useRef<HTMLInputElement>(null)

  const onImport = async (file: File | undefined) => {
    if (!file) return
    setBusy({ label: 'Importando pacote…' })
    try {
      const result = await importPack(file, file.name.replace(/\.[^.]+$/, ''))
      await importPacks(result)
      toast(
        result.skipped
          ? `Importado: ${result.stickers.length} figurinhas (${result.skipped} ignoradas)`
          : `Importado: ${result.stickers.length} figurinhas`,
        { action: { label: 'Abrir', run: () => onOpenPack(result.pack.id) } },
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Não foi possível importar.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="screen" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 8)}>
      <NavBar
        title="Figurinhas"
        scrolled={scrolled}
        leading={
          <button className="btn-bar" onClick={() => importInput.current?.click()}>
            Importar
          </button>
        }
        trailing={
          <button className="icon-btn" onClick={() => setNewPack(true)} aria-label="Novo pacote">
            <Icon name="plus" size={24} />
          </button>
        }
      />
      <input
        ref={importInput}
        type="file"
        accept=".wastickers,.zip,application/zip"
        hidden
        onChange={(e) => {
          onImport(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <main className="screen-content">
        <h1 className="t-large-title large-title">Figurinhas</h1>

        {installHint && (
          <div className="banner">
            <span className="row-icon" style={{ background: 'var(--tint)', color: 'var(--on-tint)' }}>
              <Icon name="share" size={17} />
            </span>
            <div style={{ flex: 1 }}>
              <div className="t-headline" style={{ fontSize: '0.9375rem' }}>
                Adicione à Tela de Início
              </div>
              <div className="t-footnote" style={{ marginTop: '0.125rem' }}>
                Toque em Compartilhar e depois em “Adicionar à Tela de Início”. Assim o iPhone não apaga seus pacotes.
              </div>
            </div>
            <button
              className="icon-btn"
              style={{ width: '2rem', height: '2rem', color: 'var(--label-2)' }}
              aria-label="Fechar aviso"
              onClick={() => {
                localStorage.setItem('figurinhas.installHint', 'off')
                setInstallHint(false)
              }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}

        {ready && packs.length === 0 && (
          <div className="empty">
            <div className="empty-art">🫶</div>
            <div className="t-title2">Crie sua primeira figurinha</div>
            <p className="t-subhead" style={{ margin: 0, maxWidth: '20rem' }}>
              Escolha uma foto ou um vídeo, ajuste do seu jeito e mande direto para o WhatsApp.
            </p>
          </div>
        )}

        {packs.map((pack, i) => {
          const trayId = pack.trayStickerId ?? pack.stickerIds[0]
          const missing = Math.max(0, LIMITS.minStickers - pack.stickerIds.length)
          return (
            <motion.button
              key={pack.id}
              layout="position"
              className="pack-card press"
              onClick={() => onOpenPack(pack.id)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: Math.min(i, 8) * 0.025 }}
            >
              <span className="pack-tray">{trayId && urls[trayId] ? <img src={urls[trayId]} alt="" /> : <Icon name="sticker" />}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="t-headline" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pack.title}
                </span>
                <span className="t-footnote" style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', marginTop: '0.125rem' }}>
                  {pack.stickerIds.length} de {LIMITS.maxStickers}
                  {pack.kind === 'animated' && <span className="badge">Animado</span>}
                  {missing > 0 && pack.stickerIds.length > 0 && <span>· faltam {missing}</span>}
                </span>
                <span className="pack-strip">
                  {pack.stickerIds.slice(0, 6).map((id) => urls[id] && <img key={id} src={urls[id]} alt="" />)}
                </span>
              </span>
              <span style={{ color: 'var(--label-3)' }}>
                <Icon name="right" size={18} />
              </span>
            </motion.button>
          )
        })}
      </main>

      <div className="dock">
        <button className="dock-btn" data-variant="primary" onClick={() => onCreate('static', null)}>
          <Icon name="photo" /> Foto
        </button>
        <button className="dock-btn" onClick={() => onCreate('animated', null)}>
          <Icon name="video" /> Vídeo
        </button>
      </div>

      <PackFormSheet open={newPack} onClose={() => setNewPack(false)} onSaved={(p) => onOpenPack(p.id)} />
    </div>
  )
}
