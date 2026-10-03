import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { CategoryKind, CategoryRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Adds a category (or renames one). A new category also says how its goods
 * are tracked: by IMEI or serial number for every unit sold (phones, laptops),
 * or by count only (chargers, cases). That choice is fixed once made.
 */
export function CategoryDialog({
  editing,
  onClose,
  onDone,
}: {
  editing?: CategoryRow | null
  onClose: () => void
  onDone: (category: CategoryRow) => void
}) {
  const t = useT()
  const [name, setName] = useState(editing?.name ?? '')
  const [kind, setKind] = useState<CategoryKind>('QUANTITY')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const valid = name.trim().length >= 2

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)

    try {
      if (editing) {
        await api(`/api/categories/${editing.id}`, { method: 'PATCH', body: { name: name.trim() } })
        onDone({ ...editing, name: name.trim() })
      } else {
        const payload = await api<{ category: CategoryRow }>('/api/categories', {
          method: 'POST',
          body: { name: name.trim(), kind },
        })
        onDone(payload.category)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.scrim} onClick={onClose}>
      <aside
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t(editing ? 'cat.renameTitle' : 'cat.addTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t(editing ? 'cat.renameTitle' : 'cat.addTitle')}</h2>
            <p>{t('cat.addNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('cat.name')}<em>{t('common.required')}</em>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              placeholder={t('cat.phName')}
              autoFocus
              required
            />
          </label>

          {editing ? null : (
            <label className={styles.field}>
              <span>
                {t('cat.how')}<em>{t('common.required')}</em>
              </span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as CategoryKind)}
              >
                <option value="SERIALIZED">{t('cat.kindSerialized')}</option>
                <option value="QUANTITY">{t('cat.kindQuantity')}</option>
              </select>
            </label>
          )}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!valid || busy}>
              {busy ? t('prod.saving') : t(editing ? 'common.save' : 'cat.add')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
