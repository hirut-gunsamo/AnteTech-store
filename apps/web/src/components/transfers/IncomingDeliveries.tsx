import { useEffect, useState } from 'react'

import { Card } from '../Card'
import { api } from '../../lib/api'
import { count, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { TransferRow } from '../../lib/types'
import styles from './IncomingDeliveries.module.css'

/**
 * Deliveries on their way to the seller's store, each with a Received
 * button, so stock the Owner approved can be taken in from the Sales page
 * and sold straight away. Shows nothing when none are on the way.
 */
export function IncomingDeliveries({
  storeId,
  onReceived,
  onError,
}: {
  storeId: string | null | undefined
  onReceived: (message: string) => void
  onError: (message: string) => void
}) {
  const t = useT()
  const [rows, setRows] = useState<TransferRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!storeId) return
    const controller = new AbortController()
    api<{ transfers: TransferRow[] }>('/api/transfers?status=IN_TRANSIT', { signal: controller.signal })
      .then((payload) =>
        setRows((payload.transfers ?? []).filter((row) => row.status === 'IN_TRANSIT' && row.toLocation.id === storeId)),
      )
      .catch(() => undefined)
    return () => controller.abort()
  }, [storeId, reloadKey])

  async function receive(row: TransferRow) {
    if (!window.confirm(t('tr.receiveConfirm', { from: row.fromLocation.name }))) return
    setBusyId(row.id)
    try {
      await api(`/api/transfers/${row.id}/receive`, { method: 'PATCH', body: {} })
      setReloadKey((n) => n + 1)
      onReceived(t('tr.receivedToast'))
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Failed.')
    } finally {
      setBusyId(null)
    }
  }

  if (rows.length === 0) return null

  return (
    <Card title={t('tr.incomingTitle', { n: count(rows.length) })} subtitle={t('tr.receiveNote')}>
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.id} className={styles.row}>
            <div className={styles.what}>
              <strong>
                {t('tr.incomingFrom', { from: row.fromLocation.name })} · {shortDate(row.shippedAt ?? row.createdAt)}
              </strong>
              <span>{row.items.map((item) => `${item.product.name} × ${count(item.quantity)}`).join(' · ')}</span>
            </div>
            <button type="button" className={styles.receive} onClick={() => void receive(row)} disabled={busyId === row.id}>
              {t('tr.received')}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
