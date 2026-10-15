import { LIMITS } from './types'

const S = LIMITS.size

export interface Transform {
  x: number
  y: number
  scale: number
  rotation: number
}

export interface TextLayer extends Transform {
  id: string
  text: string
  font: string
  color: string
  stroke: string | null
}

export interface Stroke {
  color: string
  width: number
  points: Array<[number, number]>
}

export interface Outline {
  enabled: boolean
  color: string
  width: number
}

export interface StickerDoc {
  transform: Transform
  outline: Outline
  texts: TextLayer[]
  strokes: Stroke[]
}

export const FONTS: Array<{ id: string; label: string; css: string }> = [
  { id: 'rounded', label: 'Arredondada', css: '800 FONT_SIZE ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif' },
  { id: 'impact', label: 'Meme', css: '900 FONT_SIZE Impact, "Haettenschweiler", "Arial Black", sans-serif' },
  { id: 'marker', label: 'Marcador', css: '700 FONT_SIZE "Marker Felt", "Chalkboard SE", "Comic Sans MS", cursive' },
  { id: 'serif', label: 'Clássica', css: '700 FONT_SIZE "New York", ui-serif, Georgia, serif' },
  { id: 'type', label: 'Máquina', css: '700 FONT_SIZE "American Typewriter", "Courier New", monospace' },
  { id: 'script', label: 'Cursiva', css: '400 FONT_SIZE "Snell Roundhand", "Brush Script MT", cursive' },
]

export const TEXT_BASE_SIZE = 64

export function fontCss(fontId: string, px: number) {
  const font = FONTS.find((f) => f.id === fontId) ?? FONTS[0]
  return font.css.replace('FONT_SIZE', `${px}px`)
}

export function newDoc(): StickerDoc {
  return {
    transform: { x: S / 2, y: S / 2, scale: 1, rotation: 0 },
    outline: { enabled: false, color: '#ffffff', width: 12 },
    texts: [],
    strokes: [],
  }
}

/** Encaixa a fonte no quadrado: "contain" para fotos, "cover" para vídeos. */
export function fitTransform(w: number, h: number, mode: 'contain' | 'cover', margin = 0.92): Transform {
  const scale = mode === 'contain' ? (S * margin) / Math.max(w, h) : S / Math.min(w, h)
  return { x: S / 2, y: S / 2, scale, rotation: 0 }
}

/** Encaixa um retângulo da fonte (ex.: área do recorte) no quadrado. */
export function fitBox(box: { x: number; y: number; w: number; h: number }, srcW: number, srcH: number): Transform {
  const scale = (S * 0.9) / Math.max(box.w, box.h)
  const cx = box.x + box.w / 2 - srcW / 2
  const cy = box.y + box.h / 2 - srcH / 2
  return { x: S / 2 - cx * scale, y: S / 2 - cy * scale, scale, rotation: 0 }
}

export function alphaBounds(image: CanvasImageSource, w: number, h: number) {
  const scale = Math.min(1, 256 / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale))
  const ch = Math.max(1, Math.round(h * scale))
  const canvas = new OffscreenCanvas(cw, ch)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0, cw, ch)
  const { data } = ctx.getImageData(0, 0, cw, ch)
  let minX = cw, minY = ch, maxX = -1, maxY = -1
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (data[(y * cw + x) * 4 + 3] > 24) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null
  return { x: minX / scale, y: minY / scale, w: (maxX - minX + 1) / scale, h: (maxY - minY + 1) / scale }
}

function textLines(layer: TextLayer) {
  return layer.text.split('\n')
}

export function measureText(ctx: CanvasRenderingContext2D, layer: TextLayer) {
  const px = TEXT_BASE_SIZE
  ctx.font = fontCss(layer.font, px)
  const lines = textLines(layer)
  const width = Math.max(...lines.map((l) => ctx.measureText(l).width), px * 0.5)
  return { width: width + px * 0.4, height: lines.length * px * 1.15 + px * 0.3 }
}

let measureCtx: CanvasRenderingContext2D | null = null
export function hitText(layer: TextLayer, x: number, y: number) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  const { width, height } = measureText(measureCtx, layer)
  // Leva o ponto para o espaço local da camada.
  const dx = x - layer.x
  const dy = y - layer.y
  const cos = Math.cos(-layer.rotation)
  const sin = Math.sin(-layer.rotation)
  const lx = (dx * cos - dy * sin) / layer.scale
  const ly = (dx * sin + dy * cos) / layer.scale
  const pad = 16 / layer.scale
  return Math.abs(lx) <= width / 2 + pad && Math.abs(ly) <= height / 2 + pad
}

function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer) {
  const px = TEXT_BASE_SIZE
  ctx.save()
  ctx.translate(layer.x, layer.y)
  ctx.rotate(layer.rotation)
  ctx.scale(layer.scale, layer.scale)
  ctx.font = fontCss(layer.font, px)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const lines = textLines(layer)
  const lh = px * 1.15
  lines.forEach((line, i) => {
    const y = (i - (lines.length - 1) / 2) * lh
    if (layer.stroke) {
      ctx.strokeStyle = layer.stroke
      ctx.lineWidth = px * 0.22
      ctx.strokeText(line, 0, y)
    }
    ctx.fillStyle = layer.color
    ctx.fillText(line, 0, y)
  })
  ctx.restore()
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const pts = stroke.points
  if (pts.length === 0) return
  ctx.save()
  ctx.strokeStyle = stroke.color
  ctx.fillStyle = stroke.color
  ctx.lineWidth = stroke.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(pts[0][0], pts[0][1], stroke.width / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2
      const my = (pts[i][1] + pts[i + 1][1]) / 2
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last[0], last[1])
    ctx.stroke()
  }
  ctx.restore()
}

let layerCanvas: OffscreenCanvas | null = null
let outlineCanvas: OffscreenCanvas | null = null

/** Desenha a figurinha completa num contexto 512×512. Usado na pré-visualização e na exportação. */
export function renderSticker(
  ctx: CanvasRenderingContext2D,
  doc: StickerDoc,
  source: CanvasImageSource | null,
  srcW: number,
  srcH: number,
) {
  ctx.clearRect(0, 0, S, S)
  if (source && srcW > 0 && srcH > 0) {
    const t = doc.transform
    layerCanvas ??= new OffscreenCanvas(S, S)
    const lctx = layerCanvas.getContext('2d')!
    lctx.clearRect(0, 0, S, S)
    lctx.save()
    lctx.translate(t.x, t.y)
    lctx.rotate(t.rotation)
    lctx.scale(t.scale, t.scale)
    lctx.imageSmoothingQuality = 'high'
    lctx.drawImage(source, -srcW / 2, -srcH / 2, srcW, srcH)
    lctx.restore()

    if (doc.outline.enabled && doc.outline.width > 0) {
      // Contorno: carimba a silhueta em volta e pinta com a cor escolhida.
      outlineCanvas ??= new OffscreenCanvas(S, S)
      const octx = outlineCanvas.getContext('2d')!
      octx.globalCompositeOperation = 'source-over'
      octx.clearRect(0, 0, S, S)
      const w = doc.outline.width
      const steps = 24
      for (const r of [w, w * 0.5]) {
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2
          octx.drawImage(layerCanvas, Math.cos(a) * r, Math.sin(a) * r)
        }
      }
      octx.globalCompositeOperation = 'source-in'
      octx.fillStyle = doc.outline.color
      octx.fillRect(0, 0, S, S)
      octx.globalCompositeOperation = 'source-over'
      ctx.drawImage(outlineCanvas, 0, 0)
    }
    ctx.drawImage(layerCanvas, 0, 0)
  }
  for (const stroke of doc.strokes) drawStroke(ctx, stroke)
  for (const text of doc.texts) drawText(ctx, text)
}
