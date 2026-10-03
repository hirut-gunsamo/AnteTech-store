import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { sendOrQueue } from '../../lib/sync'
import { useT } from '../../lib/i18n'
import { count } from '../../lib/format'
import type { CatalogueProduct, InventorySummary } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

type Line = { productId: string; quantity: string }

/**
 * A seller asking the Owner to restock their store.
 *
 * Each line shows what the store already has, so the request is a decision
 * rather than a guess. The Owner answers by sending goods from the main store
 * or another store.
 */
export function NewRequestDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [products, setProducts] = useState<CatalogueProduct[]>([])
  const t = useT()
  const [onHand, setOnHand] = useState<Map<string, number>>(new Map())
  const [lines, setLines] = useState<Line[]>([{ productId: '', quantity: '' }])
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
        const [productRes, stockRes] = await Promise.all([
          api<{ products: CatalogueProduct[] }>('/api/products', {
            signal: controller.signal,
          }),
          api<{ summary: InventorySummary }>('/api/inventory/summary', {
            signal: controller.signal,
          }),
        ])

        setProducts(
          (productRes.products ?? []).filter(
            (entry) => entry.status === 'ACTIVE',
          ),
        )

        const held = new Map<string, number>()
        for (const row of stockRes.summary.items) {
          held.set(row.productId, (held.get(row.productId) ?? 0) + row.quantity)
        }
        setOnHand(held)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : 'Could not load products.',
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [])

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
    !busy && priced.length > 0 && priced.every((l) => l.valid) && !duplicated

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

    try {
      // Same reasoning as a sale: a store that has run out should be able to
      // ask for stock whether or not the link is up at that moment.
      const sent = await sendOrQueue({
        method: 'POST',
        path: '/api/requests',
        labelKey: 'sync.requestOffline',
        entity: 'requests',
        body: {
          items: priced.map((line) => ({
            productId: line.productId,
            quantity: line.qty,
          })),
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
        aria-label={t('dlg.newRequest')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('dlg.newRequest')}</h2>
            <p>{t('dlg.newRequestNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {priced.map((line, index) => (
            <div key={index} className={styles.saleLine}>
              <label className={styles.field}>
                <span>{t('dlg.item', { n: index + 1 })}</span>
                <select
                  value={line.productId}
                  onChange={(event) =>
                    setLine(index, { productId: event.target.value })
                  }
                  required
                >
                  <option value="">{t('dlg.selectProduct')}</option>
                  {products.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} ·{' '}
                      {t('dlg.onHand', {
                        n: count(onHand.get(entry.id) ?? 0),
                      })}
                    </option>
                  ))}
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
                { productId: '', quantity: '' },
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
              {busy ? t('dlg.sending') : t('dlg.sendRequest')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
