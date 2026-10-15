import { AnimatePresence, motion } from 'motion/react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { spring } from './motion'

interface ToastOptions {
  action?: { label: string; run: () => void }
  duration?: number
}

interface Feedback {
  toast: (message: string, options?: ToastOptions) => void
  setBusy: (busy: { label: string; progress?: number | null } | null) => void
}

const FeedbackContext = createContext<Feedback | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; action?: ToastOptions['action'] } | null>(null)
  const [busy, setBusy] = useState<{ label: string; progress?: number | null } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    clearTimeout(timer.current)
    const id = Date.now()
    setToast({ id, message, action: options.action })
    timer.current = setTimeout(() => setToast(null), options.duration ?? (options.action ? 5500 : 2600))
  }, [])

  return (
    <FeedbackContext.Provider value={{ toast: show, setBusy }}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              className="toast"
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={spring}
            >
              <span>{toast.message}</span>
              {toast.action && (
                <button
                  onClick={() => {
                    toast.action!.run()
                    setToast(null)
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {busy && (
          <motion.div className="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <motion.div
              className="busy-card"
              role="status"
              initial={{ scale: 0.92, filter: 'blur(6px)' }}
              animate={{ scale: 1, filter: 'blur(0px)' }}
              exit={{ scale: 0.96, filter: 'blur(4px)' }}
              transition={spring}
            >
              <div className="spinner" />
              <div className="t-headline">{busy.label}</div>
              {busy.progress != null && (
                <div className="progress-track" style={{ width: '100%' }}>
                  <div className="progress-fill" style={{ width: `${Math.round(busy.progress * 100)}%` }} />
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </FeedbackContext.Provider>
  )
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext)
  if (!ctx) throw new Error('useFeedback fora do provider')
  return ctx
}
