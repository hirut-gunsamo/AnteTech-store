import { useEffect, useState } from 'react'

import { Card } from '../Card'
import { api } from '../../lib/api'
import { count, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { TransferRow } from '../../lib/types'
import styles from './IncomingDeliveries.module.css'
import panel from '../inventory/Panel.module.css'

// How many items a delivery card names before "View all" takes over.
const ITEMS_SHOWN = 4

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
  // The delivery whose full item list is open on the right.
  const [viewing, setViewing] = useState<TransferRow | null>(null)

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
      setViewing(null)
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
        {rows.map((row) => {
          const units = row.items.reduce((sum, item) => sum + item.quantity, 0)
          const more = row.items.length - ITEMS_SHOWN
          return (
            <li key={row.id} className={styles.row}>
              <div className={styles.what}>
                <strong>
                  {t('tr.incomingFrom', { from: row.fromLocation.name })} · {shortDate(row.shippedAt ?? row.createdAt)}
                </strong>
                <em className={styles.sum}>
                  {t('tr.itemsUnits', { items: count(row.items.length), units: count(units) })}
                </em>
                {/* A few names as chips; a long delivery opens in full on the right. */}
                <div className={styles.chips}>
                  {row.items.slice(0, ITEMS_SHOWN).map((item) => (
                    <span key={item.id ?? item.product.id} className={styles.chip} title={item.product.name}>
                      {item.product.name} <b>× {count(item.quantity)}</b>
                    </span>
                  ))}
                  {more > 0 ? (
                    <button type="button" className={styles.more} onClick={() => setViewing(row)}>
                      {t('req.moreItems', { n: more })}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className={styles.buttons}>
                <button type="button" className={styles.view} onClick={() => setViewing(row)}>
                  {t('tr.viewItems')}
                </button>
                <button type="button" className={styles.receive} onClick={() => void receive(row)} disabled={busyId === row.id}>
                  {t('tr.received')}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {viewing ? (
        <div className={panel.scrim} onClick={() => setViewing(null)}>
          <aside
            className={panel.panel}
            role="dialog"
            aria-modal="true"
            aria-label={t('tr.incomingFrom', { from: viewing.fromLocation.name })}
            onClick={(event) => event.stopPropagation()}
          >
            <header className={panel.head}>
              <div>
                <h2>{t('tr.incomingFrom', { from: viewing.fromLocation.name })}</h2>
                <p>
                  {shortDate(viewing.shippedAt ?? viewing.createdAt)} ·{' '}
                  {t('tr.itemsUnits', {
                    items: count(viewing.items.length),
                    units: count(viewing.items.reduce((sum, item) => sum + item.quantity, 0)),
                  })}
                </p>
              </div>
              <button type="button" onClick={() => setViewing(null)} aria-label={t('common.close')}>
                ✕
              </button>
            </header>
            <div className={panel.body}>
              <ol className={styles.full}>
                {viewing.items.map((item, index) => (
                  <li key={item.id ?? item.product.id}>
                    <span className={styles.n}>{index + 1}</span>
                    <span className={styles.name}>{item.product.name}</span>
                    <strong className="tabular">× {count(item.quantity)}</strong>
                  </li>
                ))}
              </ol>
              <div className={panel.actions}>
                <button type="button" className={panel.cancel} onClick={() => setViewing(null)}>
                  {t('common.close')}
                </button>
                <button
                  type="button"
                  className={panel.submit}
                  onClick={() => void receive(viewing)}
                  disabled={busyId === viewing.id}
                >
                  {t('tr.received')}
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </Card>
  )
}
