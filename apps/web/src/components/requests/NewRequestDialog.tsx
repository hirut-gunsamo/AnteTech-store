import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { sendOrQueue } from '../../lib/sync'
import { useT } from '../../lib/i18n'
import { count } from '../../lib/format'
import type { BranchRow, CatalogueProduct, InventorySummary } from '../../lib/types'
import styles from '../inventory/Panel.module.css'


/**
 * A seller asking the Owner to restock their store.
 *
 * Each line shows what the store already has, so the request is a decision
 * rather than a guess. The Owner answers by sending goods from the main store
 * or another store.
 *
 * With `asBranch` it is the Owner's "Send to store": they pick the store and
 * the items, and the goods go out at once from the Main Store. A seller
 * there presses Received.
 */
export function NewRequestDialog({
  onClose,
  onDone,
  asBranch = false,
}: {
  onClose: () => void
  onDone: (message: string) => void
  asBranch?: boolean
}) {
  const [products, setProducts] = useState<CatalogueProduct[]>([])
  const t = useT()
  const [stores, setStores] = useState<BranchRow[]>([])
  const [storeId, setStoreId] = useState('')
  const [allStores, setAllStores] = useState<BranchRow[]>([])
  const [onHand, setOnHand] = useState<Map<string, number>>(new Map())
  // As on the SIM app: every product with a box against it, grouped by
  // category. Only the boxes typed into are sent.
  const [grid, setGrid] = useState<Record<string, string>>({})
  // The list is long: typing narrows it to the matching products.
  const [search, setSearch] = useState('')
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

        setAllStores((storeRes.branches ?? []).filter((row) => row.isActive))

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

  // Every active product, grouped by its category (Phones, Accessories ...),
  // A to Z by type and then name inside each.
  const groups = useMemo(() => {
    const byCategory = new Map<string, { name: string; products: CatalogueProduct[] }>()
    const term = search.trim().toLowerCase()
    for (const product of products) {
      if (
        term &&
        !`${product.name} ${product.sku} ${product.type?.name ?? ''} ${product.type?.parent?.name ?? ''} ${product.productCategory?.name ?? ''}`
          .toLowerCase()
          .includes(term)
      ) {
        continue
      }
      const key = product.productCategory?.id ?? product.category
      const name = product.productCategory?.name ?? product.category
      const group = byCategory.get(key) ?? { name, products: [] }
      group.products.push(product)
      byCategory.set(key, group)
    }
    const typeOf = (product: CatalogueProduct) => product.type?.parent?.name ?? product.type?.name ?? ''
    for (const group of byCategory.values()) {
      group.products.sort(
        (a, b) =>
          typeOf(a).localeCompare(typeOf(b)) ||
          a.name.localeCompare(b.name, undefined, { numeric: true }),
      )
    }
    return [...byCategory.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [products, search])

  const typeLabel = (product: CatalogueProduct) =>
    product.type?.parent?.name ?? product.type?.name ?? ''

  // What was typed: a whole number, 0 or more. Blank counts as 0.
  const priced = products.map((product) => {
    const raw = grid[product.id] ?? ''
    const qty = raw.trim() === '' ? 0 : Number(raw)
    return {
      product,
      productId: product.id,
      raw,
      qty,
      valid: raw.trim() === '' || (Number.isInteger(qty) && qty >= 0),
    }
  })
  const chosenLines = priced.filter((line) => line.valid && line.qty > 0)
  const allValid = priced.every((line) => line.valid)

  const totalUnits = chosenLines.reduce((sum, line) => sum + line.qty, 0)

  // Everything goes out from the Main Store.
  const sendFrom = allStores.find((row) => row.isMainStock)?.id || ''

  const canSubmit =
    !busy &&
    (!asBranch || (sendFrom !== '' && sendFrom !== storeId)) &&
    (!asBranch || storeId !== '') &&
    chosenLines.length > 0 &&
    allValid

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    const items = chosenLines.map((line) => ({
      productId: line.productId,
      quantity: line.qty,
    }))

    // The Owner's send goes out at once; a seller there presses Received.
    if (asBranch) {
      try {
        await api('/api/requests', {
          method: 'POST',
          body: {
            branchId: storeId,
            sourceBranchId: sendFrom,
            items,
            ...(note.trim() ? { notes: note.trim() } : {}),
          },
        })
        const store = stores.find((row) => row.id === storeId)?.name ?? ''
        onDone(t('req.sentAsBranch', { store }))
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
          : chosenLines.length === 1
            ? t('done.requestedOne', {
                units: t('dlg.units', { n: count(totalUnits) }),
              })
            : t('done.requested', {
                units: t('dlg.units', { n: count(totalUnits) }),
                n: chosenLines.length,
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


          <input
            type="search"
            className={styles.gridSearch}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('req.searchItems')}
            aria-label={t('common.search')}
          />

          {products.length === 0 ? <p className={styles.none}>{t('common.loading')}</p> : null}
          {products.length > 0 && groups.length === 0 ? <p className={styles.none}>{t('common.noMatch')}</p> : null}

          {groups.map(([key, group]) => (
            // Each category folds open and shut, so a long list stays short.
            <details key={key} className={styles.gridGroup} open>
              <summary className={styles.gridHead}>{group.name}</summary>

              {group.products.map((product) => {
                const line = priced.find((entry) => entry.productId === product.id)
                return (
                  <label key={product.id} className={styles.gridRow}>
                    <span className={styles.gridName}>
                      {product.name}
                      <em className={styles.sub}>
                        {[typeLabel(product), t('dlg.onHand', { n: count(onHand.get(product.id) ?? 0) })]
                          .filter(Boolean)
                          .join(' · ')}
                      </em>
                    </span>

                    <input
                      type="number"
                      inputMode="numeric"
                      min="0"
                      step="1"
                      value={line?.raw ?? ''}
                      onChange={(event) =>
                        setGrid((current) => ({ ...current, [product.id]: event.target.value }))
                      }
                      placeholder="0"
                      aria-label={product.name}
                      data-bad={line && !line.valid ? '' : undefined}
                    />
                  </label>
                )
              })}
            </details>
          ))}

          <div className={styles.saleTotal}>
            <span>{t('dlg.totalRequested')}</span>
            <strong className="tabular">{t('dlg.units', { n: count(totalUnits) })}</strong>
          </div>

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
              {busy ? t('dlg.sending') : asBranch ? t('appr.send') : t('dlg.sendRequest')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
