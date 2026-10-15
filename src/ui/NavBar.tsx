import type { ReactNode } from 'react'

/** Barra translúcida: só ganha material quando o conteúdo passa por baixo dela. */
export function NavBar({
  title,
  scrolled,
  leading,
  trailing,
}: {
  title: ReactNode
  scrolled: boolean
  leading?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <header className="navbar" data-scrolled={scrolled}>
      <div className="navbar-material" />
      <div className="navbar-row">
        <div className="navbar-leading">{leading}</div>
        <div className="navbar-title t-headline">{title}</div>
        <div className="navbar-trailing">{trailing}</div>
      </div>
    </header>
  )
}
