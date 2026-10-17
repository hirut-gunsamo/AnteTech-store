import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { sendOrQueue } from '../../lib/sync'
import { useT } from '../../lib/i18n'
import { count } from '../../lib/format'
import type { BranchRow, CatalogueProduct, InventorySummary, StockRequest } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

// The type (Charger), then the models of that type.
type Line = { typeId: string; productId: string; quantity: string }

/**
 * A seller asking the Owner to restock their store.
 *
 * Each line shows what the store already has, so the request is a decision
 * rather than a guess. The Owner answers by sending goods from the main store
 * or another store.
 *
 * With `asBranch` it is the Owner sending to a store that did not ask: they
 * pick the store, the request is filed for it, and `onSent` hands it back so
 * the Owner goes straight on to sending it.
 */
export function NewRequestDialog({
  onClose,
  onDone,
  asBranch = false,
  onSent,
}: {
  onClose: () => void
  onDone: (message: string) => void
  asBranch?: boolean
  onSent?: (request: StockRequest) => void
}) {
  const [products, setProducts] = useState<CatalogueProduct[]>([])
  const t = useT()
  const [stores, setStores] = useState<BranchRow[]>([])
  const [storeId, setStoreId] = useState('')
  const [onHand, setOnHand] = useState<Map<string, number>>(new Map())
  const [lines, setLines] = useState<Line[]>([{ typeId: '', productId: '', quantity: '' }])
  const [note, setNote] = useState('')

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

    async function load() {
      try {
        const [productRes, storeRes] = await Promise.all([
          api<{ products: CatalogueProduct[] }>('/api/products', {
            signal: controller.signal,
          }),
          asBranch
            ? api<{ branches: BranchRow[] }>('/api/branches', {
                signal: controller.signal,
              })
            : Promise.resolve({ branches: [] as BranchRow[] }),
        ])

        setProducts(
          (productRes.products ?? []).filter(
            (entry) => entry.status === 'ACTIVE',
          ),
        )

        // Only selling stores: the main store is where the goods come from.
        setStores(
          (storeRes.branches ?? []).filter(
            (row) => row.isActive && !row.isMainStock,
          ),
        )
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : 'Could not load products.',
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [asBranch])

  // What the store already has: the seller's own, or the store the Owner picked.
  useEffect(() => {
    if (asBranch && !storeId) {
      setOnHand(new Map())
      return
    }

    const controller = new AbortController()
    const query = asBranch ? `?locationId=${encodeURIComponent(storeId)}` : ''

    api<{ summary: InventorySummary }>(`/api/inventory/summary${query}`, {
      signal: controller.signal,
    })
      .then((stockRes) => {
        const held = new Map<string, number>()
        for (const row of stockRes.summary.items) {
          held.set(row.productId, (held.get(row.productId) ?? 0) + row.quantity)
        }
        setOnHand(held)
      })
      .catch(() => {
        // The on-hand hint is a help, not a requirement.
      })

    return () => controller.abort()
  }, [asBranch, storeId])

  // Each product with its type, and the ids a type
  // pick matches on (an older phone filed under a model still shows under
  // its brand).
  const entries = useMemo(
    () =>
      products
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          typeId: entry.type?.parent?.id ?? entry.type?.id ?? '',
          typeName: entry.type?.parent?.name ?? entry.type?.name ?? '',
          typeIds: [entry.type?.id, entry.type?.parent?.id].filter((id): id is string => Boolean(id)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [products],
  )

  // Every type, A to Z: Charger, Cover, Glass, Infinix, Speaker ...
  const typeOptions = [
    ...new Map(entries.filter((entry) => entry.typeId).map((entry) => [entry.typeId, entry.typeName] as const)),
  ].sort((a, b) => a[1].localeCompare(b[1]))

  const priced = lines.map((line) => {
    const product = products.find((entry) => entry.id === line.productId)
    const qty = Number(line.quantity)

    return {
      ...line,
      product,
      qty,
      valid: product != null && Number.isInteger(qty) && qty > 0,
    }
  })

  const totalUnits = priced.reduce(
    (sum, line) => sum + (line.valid ? line.qty : 0),
    0,
  )

  // The same product twice would be two lines the Owner has to reconcile.
  const chosen = new Set<string>()
  const duplicated = priced.some((line) => {
    if (line.productId === '') return false
    if (chosen.has(line.productId)) return true
    chosen.add(line.productId)
    return false
  })

  const canSubmit =
    !busy &&
    (!asBranch || storeId !== '') &&
    priced.length > 0 &&
    priced.every((l) => l.valid) &&
    !duplicated

  function setLine(index: number, patch: Partial<Line>) {
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    const items = priced.map((line) => ({
      productId: line.productId,
      quantity: line.qty,
    }))

    // The Owner sends online: the request comes back to be sent at once.
    if (asBranch) {
      try {
        const payload = await api<{ request: StockRequest }>('/api/requests', {
          method: 'POST',
          body: {
            branchId: storeId,
            items,
            ...(note.trim() ? { notes: note.trim() } : {}),
          },
        })
        onSent?.(payload.request)
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Could not send.',
        )
      } finally {
        setBusy(false)
      }
      return
    }

    try {
      // Same reasoning as a sale: a store that has run out should be able to
      // ask for stock whether or not the link is up at that moment.
      const sent = await sendOrQueue({
        method: 'POST',
        path: '/api/requests',
        labelKey: 'sync.requestOffline',
        entity: 'requests',
        body: {
          items,
          ...(note.trim() ? { notes: note.trim() } : {}),
        },
      })

      onDone(
        sent === null
          ? t('sync.savedOffline')
          : priced.length === 1
            ? t('done.requestedOne', {
                units: t('dlg.units', { n: count(totalUnits) }),
              })
            : t('done.requested', {
                units: t('dlg.units', { n: count(totalUnits) }),
                n: priced.length,
              }),
      )
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not send the request.',
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
        aria-label={asBranch ? t('req.sendAsBranch') : t('dlg.newRequest')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{asBranch ? t('req.sendAsBranch') : t('dlg.newRequest')}</h2>
            <p>{asBranch ? t('req.sendAsBranchNote') : t('dlg.newRequestNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {asBranch ? (
            <label className={styles.field}>
              <span>{t('req.sendToStore')}</span>
              <select
                value={storeId}
                onChange={(event) => setStoreId(event.target.value)}
                required
              >
                <option value="">{t('req.chooseStore')}</option>
                {stores.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {priced.map((line, index) => (
            <div key={index} className={styles.saleLine}>
              <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                <span>
                  {t('dlg.item', { n: index + 1 })} · {t('prod.typeName')}
                </span>
                <select
                  value={line.typeId}
                  onChange={(event) => setLine(index, { typeId: event.target.value, productId: '' })}
                  required
                >
                  <option value="">{t('req.chooseType')}</option>
                  {typeOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>{t('prod.model')}</span>
                <select
                  value={line.productId}
                  onChange={(event) => setLine(index, { productId: event.target.value })}
                  disabled={!line.typeId}
                  required
                >
                  <option value="">{line.typeId ? t('sale.chooseModel') : t('req.typeFirst')}</option>
                  {line.typeId
                    ? entries
                        .filter((entry) => entry.typeIds.includes(line.typeId))
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name} · {t('dlg.onHand', { n: count(onHand.get(entry.id) ?? 0) })}
                          </option>
                        ))
                    : null}
                </select>
              </label>

              <label className={styles.qtyField}>
                <span>{t('dlg.qty')}</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantity}
                  onChange={(event) =>
                    setLine(index, { quantity: event.target.value })
                  }
                  required
                />
              </label>

              {lines.length > 1 ? (
                <button
                  type="button"
                  className={styles.removeLine}
                  onClick={() =>
                    setLines((current) => current.filter((_, i) => i !== index))
                  }
                  aria-label={t('a11y.removeItem', { n: index + 1 })}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}

          <button
            type="button"
            className={styles.addLine}
            onClick={() =>
              setLines((current) => [
                ...current,
                { typeId: '', productId: '', quantity: '' },
              ])
            }
          >
            {t('dlg.addAnother')}
          </button>

          {duplicated ? (
            <p className={styles.tally} data-bad="">
              {t('dlg.duplicateProduct')}
            </p>
          ) : totalUnits > 0 ? (
            <div className={styles.saleTotal}>
              <span>{t('dlg.totalRequested')}</span>
              <strong className="tabular">{t('dlg.units', { n: count(totalUnits) })}</strong>
            </div>
          ) : null}

          <label className={styles.field}>
            <span>{t('dlg.note')}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder={t('dlg.phRequestNote')}
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!canSubmit}
            >
              {busy ? t('dlg.sending') : asBranch ? t('req.nextChooseCar') : t('dlg.sendRequest')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
