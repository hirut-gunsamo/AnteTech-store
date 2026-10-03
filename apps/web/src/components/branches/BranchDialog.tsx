import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { BranchRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Add a selling store, or rename an existing store.
 *
 * Rename is deliberately the only edit here: the API's PATCH /:id accepts a
 * name and nothing else. Open/closed is a separate endpoint with its own
 * rules, so it lives in the row menu instead. The main store is never made
 * here: there is exactly one, created when the system is set up.
 */
export function BranchDialog({
  branch,
  onClose,
  onDone,
}: {
  branch?: BranchRow
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()
  const editing = branch != null

  const [name, setName] = useState(branch?.name ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = name.trim()
  const valid = trimmed.length >= 2 && trimmed.length <= 100
  const changed = !editing || trimmed !== branch.name

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || !changed || busy) return

    setBusy(true)
    setError(null)

    try {
      if (editing) {
        await api(`/api/branches/${branch.id}`, {
          method: 'PATCH',
          body: { name: trimmed },
        })

        onDone(t('done.branchRenamed', { old: branch.name, name: trimmed }))
      } else {
        await api('/api/branches', {
          method: 'POST',
          body: { name: trimmed },
        })

        onDone(t('done.branchCreated', { name: trimmed }))
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t('branches.saveFailed'),
      )
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
        aria-label={editing ? t('branches.dialogRename') : t('branches.dialogAdd')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>
              {editing
                ? t('branches.dialogRename')
                : t('branches.dialogAdd')}
            </h2>
            <p>
              {editing
                ? t('branches.dialogRenameNote')
                : t('branches.dialogAddNote')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('branches.nameLabel')}<em>{t('branches.nameHint')}</em>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
              placeholder="Hawassa"
              autoFocus
              required
            />
          </label>

          {!editing ? (
            <p className={styles.hint}>{t('branches.sellersNote')}</p>
          ) : null}

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!valid || !changed || busy}
            >
              {busy
                ? t('common.saving')
                : editing
                  ? t('branches.saveName')
                  : t('branches.create')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
