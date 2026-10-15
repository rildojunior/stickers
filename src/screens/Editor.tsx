import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { removeBackground } from '../lib/bg'
import { BG_MODEL_SIZE_MB, isBgModelCached } from '../lib/bgModel'
import { encodeAnimatedSticker, encodeStaticSticker } from '../lib/encode'
import { uid } from '../lib/id'
import {
  alphaBounds,
  fitBox,
  fitTransform,
  FONTS,
  fontCss,
  hitText,
  newDoc,
  renderSticker,
  type StickerDoc,
  type TextLayer,
  type Transform,
} from '../lib/render'
import { LIMITS, type StickerKind } from '../lib/types'
import { loadVideo, seek } from '../lib/video'
import { useFeedback } from '../ui/feedback'
import { Icon, type IconName } from '../ui/Icon'
import { spring } from '../ui/motion'
import { Sheet } from '../ui/Sheet'
import { VideoTrimmer } from './VideoTrimmer'

const S = LIMITS.size
const COLORS = ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#007aff', '#5856d6', '#af52de', '#ff2d55']
const MAX_IMAGE_SIDE = 1536
// Encaixe: distância (em px da figurinha) e ângulo em que o objeto "gruda" no centro / em 0°, 90°…
const SNAP_DISTANCE = 12
const SNAP_ANGLE = (4 * Math.PI) / 180

interface Guides {
  vertical: boolean
  horizontal: boolean
}

/** Aplica o encaixe sobre a posição "crua" do gesto, para o objeto poder sair do encaixe naturalmente. */
function snapTransform(raw: Transform, offset: { x: number; y: number }): { t: Transform; guides: Guides } {
  let rotation = raw.rotation
  const quarter = Math.round(rotation / (Math.PI / 2)) * (Math.PI / 2)
  if (Math.abs(rotation - quarter) < SNAP_ANGLE) rotation = quarter
  // Centro visual do conteúdo (ex.: o recorte), que pode não coincidir com o centro da imagem.
  const ox = (offset.x * Math.cos(rotation) - offset.y * Math.sin(rotation)) * raw.scale
  const oy = (offset.x * Math.sin(rotation) + offset.y * Math.cos(rotation)) * raw.scale
  const vertical = Math.abs(raw.x + ox - S / 2) < SNAP_DISTANCE
  const horizontal = Math.abs(raw.y + oy - S / 2) < SNAP_DISTANCE
  return {
    t: { x: vertical ? S / 2 - ox : raw.x, y: horizontal ? S / 2 - oy : raw.y, scale: raw.scale, rotation },
    guides: { vertical, horizontal },
  }
}

type Tool = 'move' | 'cutout' | 'text' | 'draw' | 'outline' | 'trim'
type Selection = 'source' | string

interface EditorProps {
  file: File
  kind: StickerKind
  onCancel: () => void
  onSave: (blob: Blob, kind: StickerKind) => Promise<void>
}

async function loadImage(file: File): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1) return bitmap
  const resized = await createImageBitmap(bitmap, {
    resizeWidth: Math.round(bitmap.width * scale),
    resizeHeight: Math.round(bitmap.height * scale),
    resizeQuality: 'high',
  })
  bitmap.close()
  return resized
}

export function Editor({ file, kind, onCancel, onSave }: EditorProps) {
  const { toast, setBusy } = useFeedback()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [cutout, setCutout] = useState<ImageBitmap | null>(null)
  const [useCutout, setUseCutout] = useState(false)
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [doc, setDoc] = useState<StickerDoc>(newDoc)
  const docRef = useRef(doc)
  docRef.current = doc
  const [history, setHistory] = useState<StickerDoc[]>([])
  // Vídeo começa no corte do trecho, como no Sticker.ly (cortar → ajustar).
  const [tool, setTool] = useState<Tool>(kind === 'animated' ? 'trim' : 'move')
  const [selected, setSelected] = useState<Selection>('source')
  const [editingText, setEditingText] = useState<TextLayer | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [askModel, setAskModel] = useState(false)

  const [brush, setBrush] = useState({ color: '#ffffff', width: 14 })

  const [trim, setTrim] = useState({ start: 0, duration: 3, fps: 12 })
  const trimLabel = `${trim.duration.toFixed(1).replace('.', ',')} s`
  const [playing, setPlaying] = useState(true)

  // ---------- Carregar a mídia ----------
  useEffect(() => {
    let cancelled = false
    let loadedVideo: HTMLVideoElement | null = null
    ;(async () => {
      try {
        if (kind === 'static') {
          const bitmap = await loadImage(file)
          if (cancelled) return bitmap.close()
          setImage(bitmap)
          setDoc((d) => ({ ...d, transform: fitTransform(bitmap.width, bitmap.height, 'contain') }))
        } else {
          loadedVideo = await loadVideo(file)
          if (cancelled) return
          loadedVideo.loop = false
          setVideo(loadedVideo)
          setTrim((t) => ({ ...t, duration: Math.min(loadedVideo!.duration || 3, 3) }))
          setDoc((d) => ({ ...d, transform: fitTransform(loadedVideo!.videoWidth, loadedVideo!.videoHeight, 'cover') }))
          loadedVideo.play().catch(() => setPlaying(false))
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Não foi possível abrir o arquivo.')
      }
    })()
    return () => {
      cancelled = true
      if (loadedVideo) {
        loadedVideo.pause()
        URL.revokeObjectURL(loadedVideo.src)
      }
    }
  }, [file, kind])

  const source: CanvasImageSource | null = video ?? (useCutout && cutout ? cutout : image)
  const srcW = video ? video.videoWidth : (image?.width ?? 0)
  const srcH = video ? video.videoHeight : (image?.height ?? 0)

  // ---------- Renderização ----------
  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    renderSticker(ctx, docRef.current, source, srcW, srcH)
  }, [source, srcW, srcH])

  useLayoutEffect(() => {
    if (!video) draw()
  }, [doc, draw, video])

  // Vídeo: loop dentro do trecho escolhido, desenhando a cada quadro.
  useEffect(() => {
    if (!video) return
    let raf = 0
    const tick = () => {
      const end = trim.start + trim.duration
      if (video.currentTime >= end - 0.02 || video.currentTime < trim.start - 0.05) {
        video.currentTime = trim.start
      }
      draw()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [video, draw, trim.start, trim.duration])

  useEffect(() => {
    if (!video) return
    if (playing) video.play().catch(() => setPlaying(false))
    else video.pause()
  }, [video, playing])

  // ---------- Histórico ----------
  const checkpoint = useCallback(() => {
    setHistory((h) => [...h.slice(-40), docRef.current])
  }, [])
  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h
      setDoc(h[h.length - 1])
      return h.slice(0, -1)
    })
  }
  const update = useCallback((fn: (d: StickerDoc) => StickerDoc) => {
    docRef.current = fn(docRef.current)
    setDoc(docRef.current)
  }, [])

  // ---------- Gestos (1:1, pinça e rotação) ----------
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ moved: number; startSelected: Selection; downOnSelected: boolean; raw: Transform | null } | null>(null)
  const [guides, setGuides] = useState<Guides>({ vertical: false, horizontal: false })

  // Deslocamento do centro do conteúdo visível em relação ao centro da imagem (no recorte, é o objeto).
  const cutoutOffset = useMemo(() => {
    if (!cutout) return { x: 0, y: 0 }
    const box = alphaBounds(cutout, cutout.width, cutout.height)
    return box ? { x: box.x + box.w / 2 - cutout.width / 2, y: box.y + box.h / 2 - cutout.height / 2 } : { x: 0, y: 0 }
  }, [cutout])
  const contentOffset = (sel: Selection) => (sel === 'source' && useCutout ? cutoutOffset : { x: 0, y: 0 })

  const toSticker = (e: { clientX: number; clientY: number }) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    const k = S / rect.width
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k }
  }

  const getTarget = (d: StickerDoc, sel: Selection): Transform | undefined =>
    sel === 'source' ? d.transform : d.texts.find((t) => t.id === sel)

  const setTarget = (d: StickerDoc, sel: Selection, t: Transform): StickerDoc =>
    sel === 'source'
      ? { ...d, transform: { x: t.x, y: t.y, scale: t.scale, rotation: t.rotation } }
      : { ...d, texts: d.texts.map((l) => (l.id === sel ? { ...l, x: t.x, y: t.y, scale: t.scale, rotation: t.rotation } : l)) }

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = toSticker(e)
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size === 1) {
      checkpoint()
      if (tool === 'draw') {
        update((d) => ({ ...d, strokes: [...d.strokes, { color: brush.color, width: brush.width, points: [[p.x, p.y]] }] }))
        gesture.current = { moved: 0, startSelected: selected, downOnSelected: false, raw: null }
        return
      }
      const hit = [...docRef.current.texts].reverse().find((t) => hitText(t, p.x, p.y))
      const sel = hit ? hit.id : 'source'
      const target = getTarget(docRef.current, sel)
      gesture.current = { moved: 0, startSelected: sel, downOnSelected: sel === selected && sel !== 'source', raw: target ? { ...target } : null }
      setSelected(sel)
      if (hit && tool !== 'text') setTool('text')
      if (!hit && tool === 'text') setTool('move')
    }
  }

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev || !gesture.current) return
    const p = toSticker(e)
    const all = [...pointers.current.entries()]
    const before = all.map(([, v]) => v)
    pointers.current.set(e.pointerId, p)
    const after = [...pointers.current.values()]
    gesture.current.moved += Math.hypot(p.x - prev.x, p.y - prev.y)

    if (tool === 'draw' && pointers.current.size === 1) {
      update((d) => {
        const strokes = [...d.strokes]
        const last = strokes[strokes.length - 1]
        strokes[strokes.length - 1] = { ...last, points: [...last.points, [p.x, p.y]] }
        return { ...d, strokes }
      })
      return
    }
    if (tool === 'draw') return

    const g = gesture.current
    const sel = g.startSelected
    const t = g.raw
    if (!t) return
    let next: Transform
    if (after.length === 1) {
      next = { ...t, x: t.x + (p.x - prev.x), y: t.y + (p.y - prev.y) }
    } else {
      const [a0, b0] = before
      const [a1, b1] = after
      const c0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }
      const c1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 }
      const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1
      const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y) || 1
      const s = d1 / d0
      const th = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)
      // Mantém o ponto sob os dedos: P' = C1 + R(θ)·s·(P − C0)
      const vx = (t.x - c0.x) * s
      const vy = (t.y - c0.y) * s
      next = {
        x: c1.x + vx * Math.cos(th) - vy * Math.sin(th),
        y: c1.y + vx * Math.sin(th) + vy * Math.cos(th),
        scale: Math.min(40, Math.max(0.02, t.scale * s)),
        rotation: t.rotation + th,
      }
    }
    g.raw = next
    const snapped = snapTransform(next, contentOffset(sel))
    if (snapped.guides.vertical !== guides.vertical || snapped.guides.horizontal !== guides.horizontal) {
      setGuides(snapped.guides)
      // Retorno tátil no instante do encaixe (onde houver suporte).
      if ((snapped.guides.vertical && !guides.vertical) || (snapped.guides.horizontal && !guides.horizontal)) navigator.vibrate?.(8)
    }
    update((d) => setTarget(d, sel, snapped.t))
  }

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size > 0 || !gesture.current) return
    const g = gesture.current
    gesture.current = null
    setGuides({ vertical: false, horizontal: false })
    if (g.moved < 6) {
      setHistory((h) => h.slice(0, -1)) // um toque não muda nada
      // Tocar de novo num texto já selecionado abre a edição.
      if (g.downOnSelected) {
        const layer = docRef.current.texts.find((t) => t.id === g.startSelected)
        if (layer) setEditingText(layer)
      }
    }
  }

  const onWheel = (e: React.WheelEvent) => {
    const factor = Math.exp(-e.deltaY * 0.002)
    const p = toSticker(e)
    update((d) => {
      const t = getTarget(d, selected)
      if (!t) return d
      return setTarget(d, selected, {
        ...t,
        x: p.x + (t.x - p.x) * factor,
        y: p.y + (t.y - p.y) * factor,
        scale: t.scale * factor,
      })
    })
  }

  // ---------- Enquadramento rápido ----------
  /** Centraliza o item selecionado (ou a imagem), mantendo tamanho e rotação. */
  const centerSelected = () => {
    const sel = getTarget(docRef.current, selected) ? selected : 'source'
    const t = getTarget(docRef.current, sel)
    if (!t) return
    const o = contentOffset(sel)
    const ox = (o.x * Math.cos(t.rotation) - o.y * Math.sin(t.rotation)) * t.scale
    const oy = (o.x * Math.sin(t.rotation) + o.y * Math.cos(t.rotation)) * t.scale
    checkpoint()
    update((d) => setTarget(d, sel, { ...t, x: S / 2 - ox, y: S / 2 - oy }))
  }

  /** Volta a imagem ao enquadramento automático. */
  const refit = () => {
    checkpoint()
    if (useCutout && cutout) {
      const box = alphaBounds(cutout, cutout.width, cutout.height)
      if (box) return update((d) => ({ ...d, transform: fitBox(box, cutout.width, cutout.height) }))
    }
    update((d) => ({ ...d, transform: fitTransform(srcW, srcH, kind === 'static' ? 'contain' : 'cover') }))
  }

  // ---------- Ferramentas ----------
  const addText = () => {
    setEditingText({
      id: uid(),
      text: '',
      font: 'rounded',
      color: '#ffffff',
      stroke: '#000000',
      x: S / 2,
      y: S * 0.82,
      scale: 1,
      rotation: 0,
    })
  }

  const commitText = (layer: TextLayer | null, remove = false) => {
    const editing = editingText
    setEditingText(null)
    if (!editing) return
    const exists = doc.texts.some((t) => t.id === editing.id)
    if (!layer && !remove) return
    if (remove || !layer || !layer.text.trim()) {
      if (exists) {
        checkpoint()
        update((d) => ({ ...d, texts: d.texts.filter((t) => t.id !== editing.id) }))
      }
      setSelected('source')
      return
    }
    checkpoint()
    update((d) => ({
      ...d,
      texts: exists ? d.texts.map((t) => (t.id === layer.id ? layer : t)) : [...d.texts, layer],
    }))
    setSelected(layer.id)
    setTool('text')
  }

  const runCutout = async () => {
    if (!image) return
    setAskModel(false)
    const cached = isBgModelCached()
    setBusy({ label: cached ? 'Removendo fundo…' : 'Baixando modelo de IA…', progress: cached ? null : 0 })
    try {
      const result = await removeBackground(image, (fraction) => {
        if (fraction != null && fraction < 1) setBusy({ label: 'Baixando modelo de IA…', progress: fraction })
        else setBusy({ label: 'Removendo fundo…', progress: null })
      })
      setCutout(result)
      setUseCutout(true)
      checkpoint()
      const box = alphaBounds(result, result.width, result.height)
      update((d) => ({
        ...d,
        transform: box ? fitBox(box, result.width, result.height) : d.transform,
        outline: { ...d.outline, enabled: true },
      }))
    } catch (err) {
      console.error(err)
      toast('Não deu para remover o fundo. Verifique a conexão e tente de novo.')
    } finally {
      setBusy(null)
    }
  }

  const onTool = (next: Tool) => {
    if (next === 'cutout') {
      if (cutout) {
        setUseCutout((u) => !u)
        return
      }
      if (isBgModelCached()) runCutout()
      else setAskModel(true)
      return
    }
    if (next === 'text' && (tool !== 'text' || selected === 'source')) {
      addText()
      return
    }
    setTool((t) => (t === next && next !== 'text' ? 'move' : next))
    if (next !== 'text') setSelected('source')
  }

  // ---------- Salvar ----------
  const save = async () => {
    const out = document.createElement('canvas')
    out.width = out.height = S
    const ctx = out.getContext('2d', { willReadFrequently: true })!
    setPlaying(false)
    try {
      if (kind === 'static') {
        setBusy({ label: 'Criando figurinha…' })
        renderSticker(ctx, doc, source, srcW, srcH)
        const blob = await encodeStaticSticker(out)
        await onSave(blob, 'static')
      } else if (video) {
        video.pause()
        setBusy({ label: 'Criando figurinha animada…', progress: 0 })
        const result = await encodeAnimatedSticker(
          {
            duration: trim.duration,
            draw: async (time, canvas) => {
              await seek(video, trim.start + time)
              renderSticker(canvas.getContext('2d', { willReadFrequently: true })!, doc, video, srcW, srcH)
            },
          },
          trim.fps,
          (p) => setBusy({ label: 'Criando figurinha animada…', progress: p }),
        )
        await onSave(result.blob, 'animated')
        if (result.reduced) {
          toast(`Ajustada para caber nos 500 KB do WhatsApp (${result.fps} qps). Trechos mais curtos ficam mais fluidos.`)
        }
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Algo deu errado ao salvar.')
      setPlaying(true)
    } finally {
      setBusy(null)
    }
  }

  const dirty = history.length > 0 || useCutout
  const cancel = () => (dirty ? setConfirmDiscard(true) : onCancel())

  // Caixa de seleção do texto (em % do canvas)
  const selectionBox = useMemo(() => {
    if (tool !== 'text' || selected === 'source') return null
    const layer = doc.texts.find((t) => t.id === selected)
    if (!layer) return null
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = fontCss(layer.font, 64)
    const lines = layer.text.split('\n')
    const w = (Math.max(...lines.map((l) => ctx.measureText(l).width)) + 36) * layer.scale
    const h = (lines.length * 64 * 1.15 + 20) * layer.scale
    return {
      left: `${((layer.x - w / 2) / S) * 100}%`,
      top: `${((layer.y - h / 2) / S) * 100}%`,
      width: `${(w / S) * 100}%`,
      height: `${(h / S) * 100}%`,
      transform: `rotate(${layer.rotation}rad)`,
    }
  }, [doc.texts, selected, tool])

  const tools: Array<{ id: Tool; icon: IconName; label: string; active?: boolean; disabled?: boolean }> =
    kind === 'static'
      ? [
          { id: 'cutout', icon: 'magic', label: cutout ? (useCutout ? 'Com fundo' : 'Sem fundo') : 'Tirar fundo', active: useCutout, disabled: !image },
          { id: 'text', icon: 'text', label: 'Texto', active: tool === 'text' },
          { id: 'draw', icon: 'draw', label: 'Desenhar', active: tool === 'draw' },
          { id: 'outline', icon: 'outline', label: 'Contorno', active: tool === 'outline' },
        ]
      : [
          { id: 'trim', icon: 'scissors', label: 'Trecho', active: tool === 'trim' },
          { id: 'text', icon: 'text', label: 'Texto', active: tool === 'text' },
          { id: 'draw', icon: 'draw', label: 'Desenhar', active: tool === 'draw' },
          { id: 'outline', icon: 'outline', label: 'Contorno', active: tool === 'outline' },
        ]

  const selectedText = doc.texts.find((t) => t.id === selected)
  const maxDuration = Math.min(LIMITS.maxAnimationMs / 1000, video?.duration || 10)

  return (
    <motion.div
      className="editor"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={spring}
    >
      <div className="editor-top">
        <div style={{ justifySelf: 'start' }}>
          <button className="btn-bar" onClick={cancel}>
            Cancelar
          </button>
        </div>
        <div className="t-headline">{kind === 'static' ? 'Nova figurinha' : 'Figurinha animada'}</div>
        <div style={{ justifySelf: 'end', display: 'flex' }}>
          <button className="icon-btn" onClick={undo} disabled={!history.length} aria-label="Desfazer" style={{ opacity: history.length ? 1 : 0.3 }}>
            <Icon name="undo" />
          </button>
          <button className="btn-bar" data-strong="true" onClick={save} disabled={!source}>
            Salvar
          </button>
        </div>
      </div>

      <div className="editor-stage">
        <div
          ref={wrapRef}
          className="canvas-wrap"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          <canvas ref={canvasRef} width={S} height={S} aria-label="Prévia da figurinha" />
          <div className="canvas-guide" />
          <div className="snap-guide" data-axis="vertical" data-on={guides.vertical} />
          <div className="snap-guide" data-axis="horizontal" data-on={guides.horizontal} />
          {selectionBox && <div className="selection-box" style={selectionBox} />}
          {!source && !loadError && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <div className="spinner" style={{ borderTopColor: '#fff' }} />
            </div>
          )}
          {loadError && (
            <div className="empty" style={{ position: 'absolute', inset: 0, alignContent: 'center' }}>
              <div className="t-headline">{loadError}</div>
            </div>
          )}
        </div>
        <div className="frame-actions">
          <button className="chip press" onClick={centerSelected} disabled={!source}>
            Centralizar{selectedText && tool === 'text' ? ' texto' : ''}
          </button>
          <button className="chip press" onClick={refit} disabled={!source}>
            Enquadrar
          </button>
        </div>
      </div>

      <div className="editor-panel">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tool + (tool === 'text' ? selected : '')}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
          >
            {tool === 'move' && (
              <div className="panel-row" style={{ justifyContent: 'center', minHeight: '4rem' }}>
                <span className="t-footnote">Arraste, pince e gire — as guias amarelas mostram o centro</span>
              </div>
            )}

            {tool === 'draw' && (
              <>
                <div className="swatches">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      className="swatch"
                      style={{ background: c }}
                      data-selected={brush.color === c}
                      onClick={() => setBrush((b) => ({ ...b, color: c }))}
                      aria-label={`Cor ${c}`}
                    />
                  ))}
                </div>
                <div className="slider-row" style={{ marginTop: '0.5rem' }}>
                  <span>Espessura</span>
                  <input type="range" min={4} max={48} value={brush.width} onChange={(e) => setBrush((b) => ({ ...b, width: +e.target.value }))} />
                  <span
                    style={{ width: Math.max(6, brush.width / 2), height: Math.max(6, brush.width / 2), borderRadius: '50%', background: brush.color, flex: 'none' }}
                  />
                </div>
              </>
            )}

            {tool === 'outline' && (
              <>
                <div className="panel-row">
                  <div className="segmented" style={{ flex: 1 }}>
                    {[false, true].map((on) => (
                      <button
                        key={String(on)}
                        data-selected={doc.outline.enabled === on}
                        onClick={() => {
                          checkpoint()
                          update((d) => ({ ...d, outline: { ...d.outline, enabled: on } }))
                        }}
                      >
                        {on ? 'Com contorno' : 'Sem contorno'}
                      </button>
                    ))}
                  </div>
                </div>
                {!doc.outline.enabled && (
                  <p className="t-footnote" style={{ margin: '0.625rem 0 0', textAlign: 'center' }}>
                    Sem contorno, o WhatsApp do iPhone coloca um contorno branco automático ao colar.
                  </p>
                )}
                {doc.outline.enabled && (
                  <>
                    <div className="swatches" style={{ marginTop: '0.5rem' }}>
                      {COLORS.map((c) => (
                        <button
                          key={c}
                          className="swatch"
                          style={{ background: c }}
                          data-selected={doc.outline.color === c}
                          onClick={() => update((d) => ({ ...d, outline: { ...d.outline, color: c } }))}
                          aria-label={`Cor ${c}`}
                        />
                      ))}
                    </div>
                    <div className="slider-row" style={{ marginTop: '0.375rem' }}>
                      <span>Espessura</span>
                      <input
                        type="range"
                        min={3}
                        max={28}
                        value={doc.outline.width}
                        onChange={(e) => update((d) => ({ ...d, outline: { ...d.outline, width: +e.target.value } }))}
                      />
                    </div>
                  </>
                )}
              </>
            )}

            {tool === 'text' && selectedText && (
              <>
                <div className="panel-row">
                  <button className="chip press" onClick={() => setEditingText(selectedText)}>
                    Editar texto
                  </button>
                  <button className="chip press" onClick={addText}>
                    Novo texto
                  </button>
                  <button
                    className="chip press"
                    style={{ color: '#ff453a' }}
                    onClick={() => {
                      checkpoint()
                      update((d) => ({ ...d, texts: d.texts.filter((t) => t.id !== selectedText.id) }))
                      setSelected('source')
                      setTool('move')
                    }}
                  >
                    Excluir
                  </button>
                </div>
                <div className="swatches" style={{ marginTop: '0.5rem' }}>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      className="swatch"
                      style={{ background: c }}
                      data-selected={selectedText.color === c}
                      onClick={() => update((d) => ({ ...d, texts: d.texts.map((t) => (t.id === selectedText.id ? { ...t, color: c } : t)) }))}
                      aria-label={`Cor ${c}`}
                    />
                  ))}
                </div>
              </>
            )}

            {tool === 'trim' && video && (
              <>
                <VideoTrimmer
                  video={video}
                  start={trim.start}
                  end={trim.start + trim.duration}
                  maxLength={maxDuration}
                  onChange={({ start, end }, edge) => {
                    setTrim((t) => ({ ...t, start, duration: end - start }))
                    // Mostra o quadro da borda que está sendo arrastada.
                    setPlaying(false)
                    video.currentTime = edge === 'end' ? end : start
                  }}
                />
                <div className="panel-row" style={{ marginTop: '0.5rem' }}>
                  <button className="icon-btn" style={{ color: '#fff' }} onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pausar' : 'Reproduzir'}>
                    <Icon name={playing ? 'pause' : 'play'} />
                  </button>
                  <span className="t-footnote" style={{ width: '3.25rem', fontVariantNumeric: 'tabular-nums' }}>
                    {trimLabel}
                  </span>
                  <div className="segmented" style={{ flex: 1 }}>
                    {[
                      { fps: 8, label: 'Leve' },
                      { fps: 12, label: 'Normal' },
                      { fps: 15, label: 'Fluida' },
                    ].map((o) => (
                      <button key={o.fps} data-selected={trim.fps === o.fps} onClick={() => setTrim((t) => ({ ...t, fps: o.fps }))}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <nav className="editor-tools">
        {tools.map((t) => (
          <button key={t.id} className="tool" data-active={!!t.active} disabled={t.disabled} onClick={() => onTool(t.id)}>
            <Icon name={t.icon} size={24} />
            {t.label}
          </button>
        ))}
      </nav>

      <AnimatePresence>
        {editingText && <TextEditor key={editingText.id} layer={editingText} onDone={commitText} />}
      </AnimatePresence>

      <Sheet open={askModel} onClose={() => setAskModel(false)} title="Remover fundo com IA">
        <div className="stack" style={{ color: 'var(--label)' }}>
          <p className="t-subhead" style={{ margin: '0.25rem 0 0.75rem' }}>
            Na primeira vez, o modelo de IA (cerca de {BG_MODEL_SIZE_MB} MB) é baixado e fica guardado no aparelho. O recorte acontece
            no seu iPhone — a foto não é enviada para nenhum servidor. Use Wi-Fi se puder.
          </p>
          <button className="btn press" data-variant="primary" onClick={runCutout}>
            Baixar e remover fundo
          </button>
          <button className="btn press" onClick={() => setAskModel(false)}>
            Agora não
          </button>
        </div>
      </Sheet>

      <Sheet open={confirmDiscard} onClose={() => setConfirmDiscard(false)} title="Descartar figurinha?">
        <div className="stack">
          <button className="btn press" data-variant="danger" onClick={onCancel}>
            Descartar alterações
          </button>
          <button className="btn press" onClick={() => setConfirmDiscard(false)}>
            Continuar editando
          </button>
        </div>
      </Sheet>
    </motion.div>
  )
}

function TextEditor({ layer, onDone }: { layer: TextLayer; onDone: (layer: TextLayer | null, remove?: boolean) => void }) {
  const [draft, setDraft] = useState(layer)
  const family = fontCss(draft.font, 36).replace(/^\d+\s+36px\s+/, '')
  const weight = fontCss(draft.font, 36).split(' ')[0]
  return (
    <motion.div className="text-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <div className="editor-top">
        <div style={{ justifySelf: 'start' }}>
          <button className="btn-bar" onClick={() => onDone(null, !layer.text)}>
            Cancelar
          </button>
        </div>
        <div className="t-headline">Texto</div>
        <div style={{ justifySelf: 'end' }}>
          <button className="btn-bar" data-strong="true" onClick={() => onDone(draft)}>
            OK
          </button>
        </div>
      </div>
      <textarea
        autoFocus
        value={draft.text}
        placeholder="Digite algo"
        onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        style={{
          fontFamily: family,
          fontWeight: weight,
          color: draft.color,
          WebkitTextStroke: draft.stroke ? `1.5px ${draft.stroke}` : undefined,
          paintOrder: 'stroke fill',
        }}
      />
      <div style={{ padding: '0 1rem calc(var(--safe-bottom) + 1rem)' }}>
        <div className="swatches">
          {FONTS.map((f) => (
            <button
              key={f.id}
              className="chip"
              data-selected={draft.font === f.id}
              style={{ fontFamily: fontCss(f.id, 14).replace(/^\d+\s+14px\s+/, '') }}
              onClick={() => setDraft({ ...draft, font: f.id })}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="swatches" style={{ marginTop: '0.625rem' }}>
          <button
            className="chip"
            data-selected={!!draft.stroke}
            onClick={() => setDraft({ ...draft, stroke: draft.stroke ? null : draft.color === '#000000' ? '#ffffff' : '#000000' })}
          >
            Borda
          </button>
          {COLORS.map((c) => (
            <button
              key={c}
              className="swatch"
              style={{ background: c }}
              data-selected={draft.color === c}
              onClick={() => setDraft({ ...draft, color: c, stroke: draft.stroke ? (c === '#000000' ? '#ffffff' : '#000000') : null })}
              aria-label={`Cor ${c}`}
            />
          ))}
        </div>
      </div>
    </motion.div>
  )
}
