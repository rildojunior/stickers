import type { Transition } from 'motion/react'

// Molas no estilo Apple: amortecimento crítico por padrão; um pouco de bounce só após um gesto com impulso.
export const spring = { type: 'spring', bounce: 0, duration: 0.4 } satisfies Transition
export const sheetSpring = { type: 'spring', bounce: 0, duration: 0.36 } satisfies Transition
export const flickSpring = { type: 'spring', bounce: 0.18, duration: 0.36 } satisfies Transition

/** Projeção de momento (Designing Fluid Interfaces, WWDC18). */
export function project(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate)
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
