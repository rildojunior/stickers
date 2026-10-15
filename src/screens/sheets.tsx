import { useEffect, useState } from 'react'
import { canCopyImages, canCopyWebp, copySticker, download, isIOS, openWhatsApp, shareFiles, stickerFile } from '../lib/share'
import { LIMITS, type Pack, type StickerKind } from '../lib/types'
import { useBlobs, useStore } from '../store'
import { useFeedback } from '../ui/feedback'
import { Icon } from '../ui/Icon'
import { Sheet } from '../ui/Sheet'

/**
 * Botões de envio. No iPhone, só colar na conversa faz chegar como figurinha, então o botão
 * principal copia e abre o WhatsApp. O compartilhamento de arquivo fica como opção secundária.
 */
export function SendButtons({ stickerId, name }: { stickerId: string; name: string }) {
  const { stickers } = useStore()
  const blobs = useBlobs([stickerId])
  const blob = blobs[stickerId]
  const { toast } = useFeedback()
  const animated = stickers[stickerId]?.kind === 'animated'
  const copyLosesAnimation = animated && !canCopyWebp()

  const copy = (thenOpen: boolean) => {
    if (!blob) return
    copySticker(blob)
      .then(() => {
        if (thenOpen) {
          toast('Copiada! Abra uma conversa e cole.')
          openWhatsApp()
        } else {
          toast('Copiada! Cole na conversa do WhatsApp.')
        }
      })
      .catch(() => toast('Não deu para copiar neste navegador.'))
  }
  const shareFile = () => {
    if (!blob) return
    shareFiles([stickerFile(blob, name)])
      .then((r) => r === 'downloaded' && toast('Arquivo salvo. Envie pelo WhatsApp Web ou app.'))
      .catch(() => toast('Não foi possível compartilhar.'))
  }

  if (!canCopyImages()) {
    return (
      <div className="stack">
        <button className="btn press" data-variant="primary" onClick={shareFile} disabled={!blob}>
          <Icon name="share" /> Enviar para o WhatsApp
        </button>
      </div>
    )
  }

  return (
    <div className="stack">
      <button className="btn press" data-variant="primary" onClick={() => copy(true)} disabled={!blob}>
        <Icon name="copy" /> Copiar e abrir o WhatsApp
      </button>
      <div className="btn-pair">
        <button className="btn press" onClick={() => copy(false)} disabled={!blob}>
          Só copiar
        </button>
        <button className="btn press" onClick={shareFile} disabled={!blob}>
          <Icon name="share" size={20} /> Arquivo
        </button>
      </div>
      <p className="t-footnote hint">
        {copyLosesAnimation
          ? 'Neste navegador a figurinha copiada perde a animação. Use “Arquivo” e mande pelo WhatsApp Web, ou salve o pacote.'
          : isIOS()
            ? 'No WhatsApp, abra a conversa, toque no campo de mensagem e escolha Colar.'
            : 'Cole na conversa do WhatsApp, ou use “Arquivo” no WhatsApp Web.'}
      </p>
    </div>
  )
}

export function StickerSheet({ stickerId, onClose, onOpenPack }: { stickerId: string | null; onClose: () => void; onOpenPack?: (id: string) => void }) {
  const { stickers, packs, urls, updateSticker, updatePack, removeSticker, moveSticker, reorderSticker, getBlob } = useStore()
  const { toast } = useFeedback()
  const [moving, setMoving] = useState(false)
  const sticker = stickerId ? stickers[stickerId] : undefined
  const pack = packs.find((p) => p.id === sticker?.packId)
  const [emojis, setEmojis] = useState('')

  useEffect(() => {
    setEmojis(sticker?.emojis.join('') ?? '')
    setMoving(false)
  }, [stickerId])

  const saveEmojis = (value: string) => {
    if (!sticker) return
    // Só emojis, no máximo 3 (exigência do WhatsApp).
    const list = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)]
      .map((s) => s.segment)
      .filter((g) => /\p{Extended_Pictographic}/u.test(g))
      .slice(0, LIMITS.maxEmojis)
    setEmojis(list.join(''))
    updateSticker(sticker.id, { emojis: list })
  }

  const index = pack ? pack.stickerIds.indexOf(stickerId ?? '') : -1
  const targets = packs.filter((p) => p.id !== pack?.id && (!p.kind || p.kind === sticker?.kind) && p.stickerIds.length < LIMITS.maxStickers)

  return (
    <Sheet
      open={!!sticker}
      onClose={onClose}
      title={moving ? 'Mover para…' : 'Figurinha'}
      leading={
        moving ? (
          <button className="btn-bar" onClick={() => setMoving(false)}>
            Voltar
          </button>
        ) : undefined
      }
      trailing={
        <button className="btn-bar" data-strong="true" onClick={onClose}>
          OK
        </button>
      }
    >
      {sticker && pack && !moving && (
        <>
          <div className="sticker-preview">
            <img src={urls[sticker.id]} alt="" />
          </div>
          <SendButtons stickerId={sticker.id} name={pack.title} />

          <div className="group-header t-footnote">Emojis (até 3)</div>
          <div className="group">
            <label className="row">
              <Icon name="smile" />
              <input
                className="row-input emoji-input"
                value={emojis}
                inputMode="text"
                placeholder="😂🔥"
                onChange={(e) => setEmojis(e.target.value)}
                onBlur={(e) => saveEmojis(e.target.value)}
              />
            </label>
          </div>
          <div className="group-footer t-caption">Ajudam a achar a figurinha na busca do WhatsApp.</div>

          <div className="group" style={{ marginTop: '1.25rem' }}>
            <button
              className="row"
              onClick={async () => {
                const blob = await getBlob(sticker.id)
                if (blob) download(stickerFile(blob, pack.title))
              }}
            >
              <Icon name="download" />
              <span className="row-label">Salvar arquivo .webp</span>
            </button>
            <button
              className="row"
              onClick={() => {
                updatePack(pack.id, { trayStickerId: sticker.id })
                toast('Ícone do pacote atualizado')
              }}
            >
              <Icon name="star" />
              <span className="row-label">Usar como ícone do pacote</span>
              {pack.trayStickerId === sticker.id && <Icon name="check" />}
            </button>
            <div className="row">
              <Icon name="left" />
              <span className="row-label">Posição {index + 1} de {pack.stickerIds.length}</span>
              <button className="icon-btn" disabled={index <= 0} onClick={() => reorderSticker(pack.id, sticker.id, -1)} aria-label="Mover para trás">
                <Icon name="left" />
              </button>
              <button
                className="icon-btn"
                disabled={index >= pack.stickerIds.length - 1}
                onClick={() => reorderSticker(pack.id, sticker.id, 1)}
                aria-label="Mover para frente"
              >
                <Icon name="right" />
              </button>
            </div>
            <button className="row" onClick={() => setMoving(true)}>
              <Icon name="folder" />
              <span className="row-label">Mover para outro pacote</span>
            </button>
            <button
              className="row"
              data-tone="danger"
              onClick={async () => {
                onClose()
                const restore = await removeSticker(sticker.id)
                toast('Figurinha apagada', { action: { label: 'Desfazer', run: restore } })
              }}
            >
              <Icon name="trash" />
              <span className="row-label">Apagar figurinha</span>
            </button>
          </div>
        </>
      )}

      {sticker && moving && (
        <>
          {targets.length === 0 && <p className="t-subhead" style={{ textAlign: 'center' }}>Nenhum outro pacote compatível. Crie um novo na biblioteca.</p>}
          <div className="group">
            {targets.map((p) => (
              <button
                key={p.id}
                className="row"
                onClick={async () => {
                  try {
                    await moveSticker(sticker.id, p.id)
                    toast(`Movida para “${p.title}”`, onOpenPack ? { action: { label: 'Ver', run: () => onOpenPack(p.id) } } : undefined)
                    onClose()
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Erro ao mover')
                  }
                }}
              >
                <PackThumb pack={p} />
                <span className="row-label">{p.title}</span>
                <span className="t-footnote">{p.stickerIds.length}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}

export function PackThumb({ pack, size = '2rem' }: { pack: Pack; size?: string }) {
  const { urls } = useStore()
  const id = pack.trayStickerId ?? pack.stickerIds[0]
  return (
    <span className="pack-tray" style={{ width: size, height: size, borderRadius: '0.5rem' }}>
      {id && urls[id] ? <img src={urls[id]} alt="" /> : <Icon name="sticker" size={16} />}
    </span>
  )
}

export function PackFormSheet({
  open,
  pack,
  onClose,
  onSaved,
}: {
  open: boolean
  pack?: Pack
  onClose: () => void
  onSaved?: (pack: Pack) => void
}) {
  const { createPack, updatePack } = useStore()
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')

  useEffect(() => {
    if (open) {
      setTitle(pack?.title ?? '')
      setAuthor(pack?.author ?? localStorage.getItem('figurinhas.author') ?? '')
    }
  }, [open, pack])

  const submit = async () => {
    localStorage.setItem('figurinhas.author', author.trim())
    if (pack) {
      await updatePack(pack.id, { title: title.trim() || pack.title, author: author.trim() })
      onClose()
    } else {
      const created = await createPack(title, author)
      onClose()
      onSaved?.(created)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={pack ? 'Editar pacote' : 'Novo pacote'}
      leading={
        <button className="btn-bar" onClick={onClose}>
          Cancelar
        </button>
      }
      trailing={
        <button className="btn-bar" data-strong="true" onClick={submit} disabled={!title.trim()}>
          {pack ? 'Salvar' : 'Criar'}
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) submit()
        }}
      >
        <div className="group" style={{ marginTop: '0.5rem' }}>
          <label className="row">
            <span style={{ width: '4.5rem' }}>Nome</span>
            <input
              className="row-input"
              autoFocus
              maxLength={LIMITS.maxTitle}
              value={title}
              placeholder="Ex.: Memes da família"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="row">
            <span style={{ width: '4.5rem' }}>Autor</span>
            <input className="row-input" maxLength={LIMITS.maxAuthor} value={author} placeholder="Seu nome" onChange={(e) => setAuthor(e.target.value)} />
          </label>
        </div>
        <div className="group-footer t-caption">
          O WhatsApp aceita de {LIMITS.minStickers} a {LIMITS.maxStickers} figurinhas por pacote, todas estáticas ou todas animadas.
        </div>
        <button type="submit" hidden />
      </form>
    </Sheet>
  )
}

export function ChooseMediaSheet({
  open,
  onClose,
  onPick,
  allowed,
}: {
  open: boolean
  onClose: () => void
  onPick: (kind: StickerKind) => void
  allowed: StickerKind | null
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Nova figurinha">
      <div className="group">
        <button className="row" disabled={allowed === 'animated'} style={{ opacity: allowed === 'animated' ? 0.4 : 1 }} onClick={() => onPick('static')}>
          <span className="row-icon" style={{ background: '#007aff' }}>
            <Icon name="photo" size={18} />
          </span>
          <span className="row-label">
            Com uma foto
            <div className="t-footnote">Figurinha estática</div>
          </span>
        </button>
        <button className="row" disabled={allowed === 'static'} style={{ opacity: allowed === 'static' ? 0.4 : 1 }} onClick={() => onPick('animated')}>
          <span className="row-icon" style={{ background: '#ff2d55' }}>
            <Icon name="video" size={18} />
          </span>
          <span className="row-label">
            Com um vídeo
            <div className="t-footnote">Figurinha animada, até 10 s</div>
          </span>
        </button>
      </div>
      {allowed && (
        <div className="group-footer t-caption">
          Este pacote é {allowed === 'static' ? 'de figurinhas estáticas' : 'de figurinhas animadas'} — o WhatsApp não aceita misturar.
        </div>
      )}
    </Sheet>
  )
}
