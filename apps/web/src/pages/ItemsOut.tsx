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

export default function ItemsOut() {
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

  if (user?.role !== 'OWNER') return <Navigate to="/inventory" replace />

  const rows = useMemo(
    () =>
      (movements ?? []).filter(
        (move) =>
          move.type === 'ADJUSTMENT' &&
          (move.notes ?? '').startsWith('[ITEMS_OUT]'),
      ),
    [movements],
  )

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('inv.itemsOutTitle')}</h1>
          <p className={styles.subtitle}>{t('inv.itemsOutEmpty')}</p>
        </div>
      </header>

      <Card>
        {error ? <Empty>{error}</Empty> : null}

        {movements === null ? (
          <Empty>{t('common.loading')}</Empty>
        ) : rows.length === 0 ? (
          <Empty>{t('inv.itemsOutEmpty')}</Empty>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('inv.product')}</th>
                  <th scope="col">{t('common.branch')}</th>
                  <th scope="col">{t('dlg.qty')}</th>
                  <th scope="col">{t('dlg.reason')}</th>
                  <th scope="col">{t('req.date')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((move) => (
                  <tr key={move.id}>
                    <td data-label={t('inv.product')} className={styles.strong}>
                      {move.product.name}
                    </td>
                    <td data-label={t('common.branch')}>
                      {move.fromLocation?.name ?? '—'}
                    </td>
                    <td data-label={t('dlg.qty')} className="tabular">
                      {count(move.quantity)}
                    </td>
                    <td data-label={t('dlg.reason')}>
                      {movementReasonText(move) || '—'}
                    </td>
                    <td data-label={t('req.date')}>{shortDate(move.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
