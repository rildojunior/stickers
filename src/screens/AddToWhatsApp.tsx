import { useCallback, useEffect, useState } from 'react'
import { addPackToWhatsApp, canAddPacksToWhatsApp, canCheckPackAdded, isPackAdded } from '../lib/native'
import { LIMITS } from '../lib/types'
import { useStore } from '../store'
import { useFeedback } from '../ui/feedback'
import { Icon } from '../ui/Icon'

const ERRORS: Record<string, string> = {
  WHATSAPP_NOT_INSTALLED: 'Instale o WhatsApp para adicionar o pacote.',
  WHATSAPP_OUTDATED: 'Atualize o WhatsApp para adicionar pacotes.',
}

/**
 * Adiciona o pacote inteiro ao WhatsApp (app Android). As figurinhas entram pela gaveta de
 * figurinhas do WhatsApp, sem o contorno automático que ele aplica em imagens coladas.
 */
export function AddToWhatsAppButton({ packId, variant = 'primary' }: { packId: string; variant?: 'primary' | 'secondary' }) {
  const { packs, stickers, getBlob } = useStore()
  const { toast, setBusy } = useFeedback()
  const pack = packs.find((p) => p.id === packId)
  const [added, setAdded] = useState<boolean | null>(null)
  // Versão do pacote que o WhatsApp recebeu por último neste aparelho.
  const syncedKey = `figurinhas.synced.${packId}`
  const [syncedVersion, setSyncedVersion] = useState(() => localStorage.getItem(syncedKey))

  const refresh = useCallback(() => {
    if (!canCheckPackAdded()) return
    isPackAdded(packId)
      .then((r) => setAdded(r.added))
      .catch(() => setAdded(null))
  }, [packId])

  useEffect(() => {
    refresh()
    // O usuário pode remover o pacote no WhatsApp e voltar para o app.
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  if (!canAddPacksToWhatsApp() || !pack) return null

  const count = pack.stickerIds.length
  // No iPhone não há como consultar: usamos a última versão enviada neste aparelho.
  const sentBefore = !canCheckPackAdded() && syncedVersion != null
  const outdated = (added === true || sentBefore) && syncedVersion !== String(pack.updatedAt)
  const label = added
    ? outdated
      ? 'Atualizar no WhatsApp'
      : 'Já está no WhatsApp'
    : sentBefore
      ? outdated
        ? 'Atualizar no WhatsApp'
        : 'Enviar de novo ao WhatsApp'
      : 'Adicionar ao WhatsApp'

  const run = async () => {
    setBusy({ label: 'Preparando pacote…', progress: 0 })
    try {
      const items = await Promise.all(pack.stickerIds.map(async (id) => ({ sticker: stickers[id], blob: (await getBlob(id))! })))
      const result = await addPackToWhatsApp(pack, items, (p) => setBusy({ label: 'Preparando pacote…', progress: p }))
      setBusy(null)
      if (result.status === 'sent') {
        localStorage.setItem(syncedKey, String(pack.updatedAt))
        setSyncedVersion(String(pack.updatedAt))
        toast('Confirme “Salvar” no WhatsApp para adicionar o pacote.')
      } else if (result.status === 'added') {
        localStorage.setItem(syncedKey, String(pack.updatedAt))
        setSyncedVersion(String(pack.updatedAt))
        setAdded(true)
        toast(result.padded ? `Pacote adicionado (completado com ${result.padded} figurinha(s) vazia(s))` : 'Pacote adicionado ao WhatsApp!')
      } else {
        refresh()
      }
    } catch (err) {
      const code = (err as { code?: string }).code
      toast((code && ERRORS[code]) || (err instanceof Error ? err.message : 'Não foi possível adicionar o pacote.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack">
      <button
        className="btn press"
        data-variant={added && !outdated ? undefined : variant === 'primary' ? 'primary' : undefined}
        onClick={run}
        disabled={count === 0}
      >
        <Icon name={added && !outdated ? 'check' : 'sticker'} /> {label}
      </button>
      {count > 0 && count < LIMITS.minStickers && !added && (
        <p className="t-footnote hint" style={{ marginTop: 0 }}>
          O WhatsApp exige 3 figurinhas; completamos com figurinhas transparentes até você criar mais.
        </p>
      )}
    </div>
  )
}
