import { webpToPng } from './encode'

export type ShareResult = 'shared' | 'downloaded' | 'cancelled'

function slug(name: string) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').slice(0, 60) || 'figurinha'
}

export function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Abre a folha de compartilhamento do sistema. Precisa ser chamado direto no toque do usuário
 * (sem `await` antes), senão o Safari bloqueia — por isso os blobs já chegam carregados.
 */
export async function shareFiles(files: File[]): Promise<ShareResult> {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      throw err
    }
  }
  files.forEach(download)
  return 'downloaded'
}

export function stickerFile(blob: Blob, name: string) {
  return new File([blob], `${slug(name)}.webp`, { type: 'image/webp' })
}

export function namedFile(blob: Blob, name: string, ext: string, type: string) {
  return new File([blob], `${slug(name)}.${ext}`, { type })
}

/** Copia como PNG transparente — no iPhone dá para colar direto na conversa do WhatsApp. */
export async function copySticker(blob: Blob): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('Este navegador não permite copiar imagens.')
  }
  // O ClipboardItem recebe a Promise para manter o gesto do usuário no Safari.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': webpToPng(blob) })])
}

export const canCopyImages = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
