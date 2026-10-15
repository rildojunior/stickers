import { animate, AnimatePresence, motion, useDragControls, useMotionValue, useTransform } from 'motion/react'
import { useRef, useState } from 'react'
import type { StickerKind } from './lib/types'
import { Editor } from './screens/Editor'
import { Library } from './screens/Library'
import { PackScreen } from './screens/PackScreen'
import { SendButtons } from './screens/sheets'
import { StoreProvider, useStore } from './store'
import { FeedbackProvider, useFeedback } from './ui/feedback'
import { Icon } from './ui/Icon'
import { flickSpring, prefersReducedMotion, project, spring } from './ui/motion'
import { Sheet } from './ui/Sheet'

export default function App() {
  return (
    <FeedbackProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </FeedbackProvider>
  )
}

interface EditorState {
  file: File
  kind: StickerKind
  packId: string | null
}

function Shell() {
  const { addSticker, packs, urls } = useStore()
  const { toast } = useFeedback()
  const [packId, setPackId] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [done, setDone] = useState<{ stickerId: string; packId: string } | null>(null)
  const pending = useRef<{ kind: StickerKind; packId: string | null }>({ kind: 'static', packId: null })
  const photoInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)

  // O seletor de arquivos precisa abrir dentro do toque, então isto é síncrono.
  const create = (kind: StickerKind, target: string | null) => {
    pending.current = { kind, packId: target }
    ;(kind === 'static' ? photoInput : videoInput).current?.click()
  }

  const onFile = (file: File | undefined) => {
    if (!file) return
    const kind = file.type.startsWith('video/') ? 'animated' : 'static'
    if (kind !== pending.current.kind) {
      toast(kind === 'animated' ? 'Escolha uma foto para este pacote.' : 'Escolha um vídeo para este pacote.')
      return
    }
    setEditor({ file, kind, packId: pending.current.packId })
  }

  const save = async (blob: Blob, kind: StickerKind) => {
    const { sticker, pack } = await addSticker(editor?.packId ?? null, kind, blob)
    setEditor(null)
    setDone({ stickerId: sticker.id, packId: pack.id })
  }

  const donePack = packs.find((p) => p.id === done?.packId)

  return (
    <>
      <Stack packId={packId} onOpenPack={setPackId} onBack={() => setPackId(null)} onCreate={create} />

      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <AnimatePresence>
        {editor && <Editor key={editor.file.name + editor.file.lastModified} {...editor} onCancel={() => setEditor(null)} onSave={save} />}
      </AnimatePresence>

      <Sheet
        open={!!done}
        onClose={() => setDone(null)}
        title="Figurinha pronta"
        trailing={
          <button className="btn-bar" data-strong="true" onClick={() => setDone(null)}>
            OK
          </button>
        }
      >
        {done && donePack && (
          <>
            <motion.div
              className="sticker-preview"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ ...flickSpring, delay: 0.08 }}
            >
              <img src={urls[done.stickerId]} alt="Figurinha criada" />
            </motion.div>
            <SendButtons stickerId={done.stickerId} name={donePack.title} />
            <div className="group" style={{ marginTop: '1rem' }}>
              <button
                className="row"
                onClick={() => {
                  setDone(null)
                  setPackId(donePack.id)
                }}
              >
                <Icon name="folder" />
                <span className="row-label">
                  Salva em “{donePack.title}”
                  <div className="t-footnote">{donePack.stickerIds.length} de 30 figurinhas</div>
                </span>
                <Icon name="right" size={18} />
              </button>
              <button
                className="row"
                data-tone="tint"
                onClick={() => {
                  setDone(null)
                  create(donePack.kind ?? 'static', donePack.id)
                }}
              >
                <Icon name="plus" />
                <span className="row-label">Criar outra neste pacote</span>
              </button>
            </div>
          </>
        )}
      </Sheet>
    </>
  )
}

/** Pilha de navegação: o pacote entra pela direita e sai pela direita; arraste da borda para voltar. */
function Stack({
  packId,
  onOpenPack,
  onBack,
  onCreate,
}: {
  packId: string | null
  onOpenPack: (id: string) => void
  onBack: () => void
  onCreate: (kind: StickerKind, packId: string | null) => void
}) {
  const reduced = prefersReducedMotion()
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <motion.div
        style={{ position: 'absolute', inset: 0 }}
        animate={reduced ? { opacity: 1 } : { x: packId ? '-28%' : 0 }}
        transition={spring}
      >
        <Library onOpenPack={onOpenPack} onCreate={onCreate} />
      </motion.div>
      <AnimatePresence>
        {packId && (
          <PushedScreen key={packId} onBack={onBack}>
            <PackScreen packId={packId} onBack={onBack} onCreate={onCreate} onOpenPack={onOpenPack} />
          </PushedScreen>
        )}
      </AnimatePresence>
    </div>
  )
}

function PushedScreen({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  const x = useMotionValue(0)
  const controls = useDragControls()
  const ref = useRef<HTMLDivElement>(null)
  const reduced = prefersReducedMotion()
  const shadow = useTransform(x, (v) => `0 0 ${Math.max(0, 24 - v / 20)}px rgba(0,0,0,${Math.max(0, 0.18 - v / 4000)})`)

  return (
    <motion.div
      ref={ref}
      style={{ position: 'absolute', inset: 0, x, boxShadow: shadow, zIndex: 5 }}
      initial={reduced ? { opacity: 0 } : { x: '100%' }}
      animate={reduced ? { opacity: 1 } : { x: 0 }}
      exit={reduced ? { opacity: 0 } : { x: '100%' }}
      transition={reduced ? { duration: 0.2 } : spring}
      drag="x"
      dragListener={false}
      dragControls={controls}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 1 }}
      dragMomentum={false}
      onPointerDownCapture={(e) => {
        if (e.clientX < 24) controls.start(e)
      }}
      onDragEnd={(_, info) => {
        const w = ref.current?.offsetWidth ?? window.innerWidth
        if (x.get() + project(info.velocity.x) > w / 2) onBack()
        else animate(x, 0, { ...flickSpring, velocity: info.velocity.x })
      }}
    >
      {children}
    </motion.div>
  )
}
