import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { api } from '../lib/api'
import { count, shortDate } from '../lib/format'
import { useT } from '../lib/i18n'
import type { StockMovement } from '../lib/types'
import styles from './Inventory.module.css'

function movementReasonText(move: StockMovement): string {
  return (move.notes ?? '').replace(/^\[[A-Z_]+\]\s*/, '')
}

function movementKind(move: StockMovement): 'DAMAGED' | 'LOST' | null {
  if ((move.notes ?? '').startsWith('[DAMAGED]')) return 'DAMAGED'
  if ((move.notes ?? '').startsWith('[LOST]')) return 'LOST'
  return null
}

export default function DamageLoss() {
  const { user } = useAuth()
  const t = useT()

  const [movements, setMovements] = useState<StockMovement[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    api<{ movements: StockMovement[] }>('/api/inventory/movements', {
      signal: controller.signal,
    })
      .then((payload) => {
        setMovements(payload.movements ?? [])
        setError(null)
      })
      .catch((caught) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : t('inv.loadFailed'))
        setMovements([])
      })

    return () => controller.abort()
  }, [t])

  const rows = useMemo(
    () =>
      (movements ?? []).filter(
        (move) =>
          move.type === 'ADJUSTMENT' &&
          (move.notes ?? '').match(/^\[(DAMAGED|LOST)\]/),
      ),
    [movements],
  )


  // After every hook, so the hooks run in the same order on each render.
  if (user?.role !== 'OWNER') return <Navigate to="/inventory" replace />

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('inv.damageLossTitle')}</h1>
          <p className={styles.subtitle}>{t('inv.damageLossEmpty')}</p>
        </div>
      </header>

      <Card>
        {error ? <Empty>{error}</Empty> : null}

        {movements === null ? (
          <Empty>{t('common.loading')}</Empty>
        ) : rows.length === 0 ? (
          <Empty>{t('inv.damageLossEmpty')}</Empty>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('inv.product')}</th>
                  <th scope="col">{t('common.branch')}</th>
                  <th scope="col">{t('dlg.adjustmentKind')}</th>
                  <th scope="col">{t('dlg.qty')}</th>
                  <th scope="col">{t('dlg.reason')}</th>
                  <th scope="col">{t('req.date')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((move) => {
                  const kind = movementKind(move)
                  return (
                    <tr key={move.id}>
                      <td data-label={t('inv.product')} className={styles.strong}>
                        {move.product.name}
                      </td>
                      <td data-label={t('common.branch')}>
                        {move.fromLocation?.name ?? '—'}
                      </td>
                      <td data-label={t('dlg.adjustmentKind')}>
                        {kind === 'DAMAGED' ? t('dlg.adjustmentDamaged') : t('dlg.adjustmentLost')}
                      </td>
                      <td data-label={t('dlg.qty')} className="tabular">
                        {count(move.quantity)}
                      </td>
                      <td data-label={t('dlg.reason')}>
                        {movementReasonText(move) || '—'}
                      </td>
                      <td data-label={t('req.date')}>{shortDate(move.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
