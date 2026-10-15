import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { seek } from '../lib/video'

const THUMBS = 8
const MIN_LENGTH = 0.5

interface VideoTrimmerProps {
  video: HTMLVideoElement
  start: number
  end: number
  maxLength: number
  onChange: (range: { start: number; end: number }, edge: 'start' | 'end' | 'move') => void
}

/** Gera miniaturas com um vídeo separado, para não interromper a prévia. */
function useThumbnails(src: string, duration: number) {
  const [thumbs, setThumbs] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    const probe = document.createElement('video')
    probe.muted = true
    probe.playsInline = true
    probe.preload = 'auto'
    probe.src = src
    ;(async () => {
      await new Promise<void>((resolve) => {
        probe.onloadeddata = () => resolve()
        probe.onerror = () => resolve()
        probe.load()
      })
      const canvas = document.createElement('canvas')
      const h = 64
      canvas.height = h
      canvas.width = Math.max(1, Math.round((probe.videoWidth / Math.max(1, probe.videoHeight)) * h))
      const ctx = canvas.getContext('2d')!
      const out: string[] = []
      for (let i = 0; i < THUMBS; i++) {
        if (cancelled) return
        await seek(probe, ((i + 0.5) / THUMBS) * duration)
        ctx.drawImage(probe, 0, 0, canvas.width, canvas.height)
        out.push(canvas.toDataURL('image/jpeg', 0.6))
        setThumbs([...out])
      }
    })()
    return () => {
      cancelled = true
      probe.removeAttribute('src')
      probe.load()
    }
  }, [src, duration])
  return thumbs
}

/**
 * Linha do tempo com alças, no estilo do corte de vídeo do iPhone: arrasta as bordas para
 * escolher o trecho (até 10 s) ou o meio para deslocá-lo. Acompanha o dedo 1:1.
 */
export function VideoTrimmer({ video, start, end, maxLength, onChange }: VideoTrimmerProps) {
  const duration = video.duration
  const thumbs = useThumbnails(video.src, duration)
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<{ edge: 'start' | 'end' | 'move'; x0: number; start: number; end: number } | null>(null)
  const [playhead, setPlayhead] = useState(start)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setPlayhead(video.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [video])

  const pct = (t: number) => `${(t / duration) * 100}%`

  const onDown = (edge: 'start' | 'end' | 'move') => (e: RPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    drag.current = { edge, x0: e.clientX, start, end }
    try {
      // Continua acompanhando o dedo mesmo fora da alça.
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // ponteiro já liberado: o movimento ainda chega pelo contêiner
    }
  }

  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || !track.current) return
    const dt = ((e.clientX - d.x0) / track.current.getBoundingClientRect().width) * duration
    let s = d.start
    let en = d.end
    if (d.edge === 'move') {
      const len = d.end - d.start
      s = Math.min(Math.max(0, d.start + dt), duration - len)
      en = s + len
    } else if (d.edge === 'start') {
      s = Math.min(Math.max(0, d.start + dt, d.end - maxLength), d.end - MIN_LENGTH)
    } else {
      en = Math.max(Math.min(duration, d.end + dt, d.start + maxLength), d.start + MIN_LENGTH)
    }
    onChange({ start: s, end: en }, d.edge)
  }

  const onUp = () => {
    drag.current = null
  }

  return (
    <div className="trimmer" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <div ref={track} className="trimmer-track">
        <div className="trimmer-thumbs">
          {Array.from({ length: THUMBS }, (_, i) => (
            <div key={i} className="trimmer-thumb" style={thumbs[i] ? { backgroundImage: `url(${thumbs[i]})` } : undefined} />
          ))}
        </div>
        <div className="trimmer-dim" style={{ left: 0, width: pct(start) }} />
        <div className="trimmer-dim" style={{ left: pct(end), right: 0 }} />
        <div className="trimmer-window" style={{ left: pct(start), width: pct(end - start) }} onPointerDown={onDown('move')}>
          <div className="trimmer-handle" data-edge="start" onPointerDown={onDown('start')} aria-label="Início do trecho" />
          <div className="trimmer-handle" data-edge="end" onPointerDown={onDown('end')} aria-label="Fim do trecho" />
        </div>
        <div className="trimmer-playhead" style={{ left: pct(Math.min(Math.max(playhead, start), end)) }} />
      </div>
    </div>
  )
}
