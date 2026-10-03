import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { AppUser, BranchRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Moves a seller to a different selling store. The main store has no sellers,
 * so it is not offered.
 */
export function MoveBranchDialog({
  user,
  onClose,
  onDone,
}: {
  user: AppUser
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [branches, setBranches] = useState<BranchRow[]>([])
  const t = useT()
  const [branchId, setBranchId] = useState(user.branchId ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const controller = new AbortController()

    api<{ branches: BranchRow[] }>('/api/branches', {
      signal: controller.signal,
    })
      .then((payload) =>
        setBranches(
          (payload.branches ?? []).filter((b) => b.isActive && !b.isMainStock),
        ),
      )
      .catch(() => {
        /* Leaves the select empty; the form cannot be submitted. */
      })

    return () => controller.abort()
  }, [])

  const target = branches.find((entry) => entry.id === branchId)
  const changed = branchId !== '' && branchId !== user.branchId

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!changed || busy) return

    setBusy(true)
    setError(null)

    try {
      await api(`/api/users/${user.id}/branch`, {
        method: 'PATCH',
        body: { branchId },
      })

      onDone(
        t('done.userMoved', {
          name: user.name,
          store: target?.name ?? t('done.newBranch'),
        }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not move them.',
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
        aria-label={t('a11y.moveName', { name: user.name })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('dlg.changeBranch')}</h2>
            <p>
              {user.name} · {user.branch?.name ?? t('dlg.noBranch')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>
              {t('common.branch')}<em>{t('common.required')}</em>
            </span>
            <select
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              required
            >
              <option value="">{t('dlg.selectBranch')}</option>
              {branches.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!changed || busy}
            >
              {busy ? t('dlg.moving') : t('dlg.move')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
