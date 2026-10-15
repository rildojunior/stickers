import { animate, AnimatePresence, motion, useDragControls, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { flickSpring, prefersReducedMotion, project, sheetSpring } from './motion'

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  children: ReactNode
}

/**
 * Folha inferior: arrasta 1:1 pelo puxador/cabeçalho, projeta o impulso ao soltar
 * e decide fechar pela posição projetada; pode ser agarrada no meio da animação.
 */
export function Sheet(props: SheetProps) {
  return <AnimatePresence>{props.open && <SheetPanel key="sheet" {...props} />}</AnimatePresence>
}

function SheetPanel({ onClose, title, leading, trailing, children }: SheetProps) {
  const y = useMotionValue(0)
  const panel = useRef<HTMLDivElement>(null)
  const controls = useDragControls()
  const reduced = prefersReducedMotion()
  const scrimOpacity = useTransform(y, (v) => {
    const h = panel.current?.offsetHeight ?? 600
    return Math.max(0, 1 - v / h)
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <motion.div
        className="scrim"
        style={{ background: 'none' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        onClick={onClose}
      >
        <motion.div className="scrim" style={{ opacity: scrimOpacity, zIndex: 'auto' }} />
      </motion.div>
      <motion.div
        ref={panel}
        className="sheet"
        role="dialog"
        aria-modal="true"
        style={{ y }}
        initial={reduced ? { opacity: 0 } : { y: '100%' }}
        animate={reduced ? { opacity: 1 } : { y: 0 }}
        exit={reduced ? { opacity: 0 } : { y: '100%' }}
        transition={reduced ? { duration: 0.2 } : sheetSpring}
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.08, bottom: 1 }}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          const h = panel.current?.offsetHeight ?? 600
          const projected = y.get() + project(info.velocity.y)
          if (projected > h * 0.5) onClose()
          else animate(y, 0, { ...flickSpring, velocity: info.velocity.y })
        }}
      >
        <div className="sheet-grabber" onPointerDown={(e) => controls.start(e)} />
        {(title || leading || trailing) && (
          <div className="sheet-header" onPointerDown={(e) => controls.start(e)}>
            <div style={{ justifySelf: 'start' }}>{leading}</div>
            <div className="t-headline">{title}</div>
            <div style={{ justifySelf: 'end' }}>{trailing}</div>
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </motion.div>
    </>
  )
}
