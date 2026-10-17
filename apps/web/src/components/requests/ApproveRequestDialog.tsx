import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { count } from '../../lib/format'
import { requestRef, requestUnitCount } from '../../lib/requests'
import type { BranchRow, InventoryBalance, StockRequest } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Approving is not a single click: the reviewer decides how much of each line
 * to send (50 requested, 40 approved), and the API also needs
 * `sourceBranchId`: the main store, or another selling store with stock to
 * spare. Approval creates the transfer, so neither choice can be deferred.
 *
 * Every request is a seller's restock for their store, so every approval
 * ships: there is always a source to pick. The stores are close together,
 * so no driver or vehicle is named.
 */
export function ApproveRequestDialog({
  request: opened,
  waiting = [],
  onClose,
  onDone,
}: {
  request: StockRequest
  /** Every request waiting on the Owner, to offer the same store's others. */
  waiting?: StockRequest[]
  onClose: () => void
  onDone: (message: string) => void
}) {
  const t = useT()

  // One lot for a store, as on the SIM app: the request the Owner opened, and
  // any of the same store's other waiting requests added to it.
  const [included, setIncluded] = useState<StockRequest[]>([opened])
  const request = opened
  const storeId = opened.requestedBy.branch?.id
  const others = waiting.filter(
    (entry) =>
      entry.status === 'PENDING' &&
      entry.requestedBy.branch?.id === storeId &&
      !included.some((chosen) => chosen.id === entry.id) &&
      // Half-decided requests are finished on their own first.
      (entry.items.every((item) => item.approvedQuantity === null) ||
        entry.items.every((item) => item.approvedQuantity !== null)),
  )

  // Items already approved or rejected one by one: only the approved ones are
  // sent, and each can still be lowered here (the store may have fewer).
  const decided = included.some((entry) => entry.items.some((item) => item.approvedQuantity !== null))
  const items = included.flatMap((entry) =>
    entry.items.filter((item) => item.approvedQuantity === null || item.approvedQuantity > 0),
  )
  // The most a line can send: what was approved, or else what was asked for.
  const maxOf = (item: (typeof items)[number]) => item.approvedQuantity ?? item.quantity

  const [branches, setBranches] = useState<BranchRow[] | null>(null)
  const [pickedSource, setSourceBranchId] = useState('')
  // Restock from the main warehouse, or transfer from another branch.
  const [sourceMode, setSourceMode] = useState<'MAIN' | 'BRANCH'>('MAIN')
  const [note, setNote] = useState('')

  // Who is driving it over. Asked for here because the branch waiting for the
  // goods is told before the van leaves, not after it arrives.

  // Only what the Owner changed. An untouched line starts at what was asked
  // for, or at what the store holds when that is less, so Approve as it is
  // is one tap.
  const [quantities, setQuantities] = useState<Record<string, string>>({})

  // Tagged with the branch it belongs to, so a slow answer for a branch the
  // Owner has since moved away from is never shown against the new one.
  const [stockOf, setStockOf] = useState<{
    branchId: string
    byProduct: Map<string, number>
  } | null>(null)

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
        const payload = await api<{ branches: BranchRow[] }>('/api/branches', {
          signal: controller.signal,
        })

        setBranches(payload.branches ?? [])
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : 'Could not load branches.',
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [])

  // Restock ships from an active main warehouse; a transfer from any other
  // active branch. Never from the branch that raised the request.
  const sources = useMemo(
    () =>
      (branches ?? []).filter(
        (entry) =>
          entry.isActive &&
          entry.id !== request.requestedBy.branch?.id &&
          (sourceMode === 'MAIN' ? entry.isMainStock : !entry.isMainStock),
      ),
    [branches, request.requestedBy.branch?.id, sourceMode],
  )

  // Starts on the first store that can send it (the main store), so the
  // Owner can approve at once; another can still be picked.
  const sourceBranchId = sources.some((entry) => entry.id === pickedSource)
    ? pickedSource
    : (sources[0]?.id ?? '')

  // What the chosen branch holds, so the Owner can see why they might
  // approve less before the API refuses a shipment it cannot cover.
  useEffect(() => {
    if (sourceBranchId === '') return

    const controller = new AbortController()

    async function load() {
      try {
        const payload = await api<{ inventory: InventoryBalance[] }>(
          `/api/inventory?locationId=${encodeURIComponent(sourceBranchId)}`,
          { signal: controller.signal },
        )

        setStockOf({
          branchId: sourceBranchId,
          byProduct: new Map(
            (payload.inventory ?? []).map((row) => [row.productId, row.quantity]),
          ),
        })
      } catch {
        // Stock figures are a guide only; the API still checks on submit.
      }
    }

    void load()

    return () => controller.abort()
  }, [sourceBranchId])


  const sourceName = sources.find((entry) => entry.id === sourceBranchId)?.name
  const stock =
    stockOf !== null && stockOf.branchId === sourceBranchId
      ? stockOf.byProduct
      : null

  const lines = items.map((item) => {
    const inStock = stock ? (stock.get(item.product.id) ?? 0) : null
    const raw =
      quantities[item.id] ?? String(inStock === null ? maxOf(item) : Math.min(maxOf(item), inStock))
    const qty = Number(raw)
    const valid =
      raw.trim() !== '' && Number.isInteger(qty) && qty >= 0 && qty <= maxOf(item)

    return {
      item,
      raw,
      qty: valid ? qty : 0,
      valid,
      inStock,
      overStock: valid && inStock !== null && qty > inStock,
    }
  })

  const requested = included.reduce((sum, entry) => sum + requestUnitCount(entry), 0)
  const approving = lines.reduce((sum, line) => sum + line.qty, 0)
  const allValid = lines.every((line) => line.valid)
  const anyOverStock = lines.some((line) => line.overStock)
  // A line asking for more than the store holds sends what it holds, so the
  // Owner can always approve; the rest stays unsent.
  const sendOf = (line: (typeof lines)[number]) =>
    line.inStock !== null ? Math.min(line.qty, line.inStock) : line.qty
  const sending = lines.reduce((sum, line) => sum + sendOf(line), 0)

  const canSubmit =
    !busy &&
    allValid &&
    approving > 0 &&
    sending > 0 &&
    sourceBranchId !== ''

  function setQuantity(itemId: string, value: string) {
    setQuantities((current) => ({ ...current, [itemId]: value }))
  }

  function fillFromStock() {
    if (!stock) return

    setQuantities(
      Object.fromEntries(
        items.map((item) => [
          item.id,
          String(Math.min(maxOf(item), stock.get(item.product.id) ?? 0)),
        ]),
      ),
    )
  }

  function approveAll() {
    setQuantities(
      Object.fromEntries(
        items.map((item) => [item.id, String(maxOf(item))]),
      ),
    )
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    // Send asks first, as on the SIM app.
    if (
      !window.confirm(
        t('dlg.sendLotConfirm', {
          units: count(sending),
          n: included.length,
          from: sourceName ?? '',
          store: request.requestedBy.branch?.name ?? '',
        }),
      )
    ) {
      return
    }

    setBusy(true)
    setError(null)

    try {
      await api('/api/requests/ship', {
        method: 'POST',
        body: {
          requestIds: included.map((entry) => entry.id),
          sourceBranchId,
          ...(note.trim() ? { notes: note.trim() } : {}),
          // Every line as chosen here; a decided line can only go down.
          items: lines.map((line) => ({
            itemId: line.item.id,
            approvedQuantity: sendOf(line),
          })),
        },
      })

      const vars = {
        ref: requestRef(request),
        from: sourceName ?? t('done.sourceBranch'),
        approved: count(approving),
        requested: count(requested),
      }

      const partial = approving < requested

      onDone(t(partial ? 'done.requestApprovedPartial' : 'done.requestApproved', vars))
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not approve the request.',
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
        aria-label={t('a11y.approveRef', { ref: requestRef(request) })}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t(decided ? 'dlg.sendApproved' : 'dlg.approveRequest')}</h2>
            <p className="tabular">{requestRef(request)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <p className={styles.warn}>
            {t(decided ? 'dlg.sendIntro' : 'dlg.approveIntro', {
              store: request.requestedBy.branch?.name ?? t('req.unknownBranch'),
              units: count(decided ? lines.reduce((sum, line) => sum + line.qty, 0) : requested),
            })}
          </p>

          <label className={styles.field}>
            <span>{t('dlg.sendHow')}</span>
            <select
              value={sourceMode}
              onChange={(event) => {
                setSourceMode(event.target.value as 'MAIN' | 'BRANCH')
                setSourceBranchId('')
              }}
            >
              <option value="MAIN">{t('dlg.fromMain')}</option>
              <option value="BRANCH">{t('dlg.fromBranch')}</option>
            </select>
          </label>

          <label className={styles.field}>
            <span>
              {t('dlg.shipFrom')}<em>{t('common.required')}</em>
            </span>
            <select
              value={sourceBranchId}
              onChange={(event) => setSourceBranchId(event.target.value)}
              required
            >
              <option value="">{t('dlg.selectSource')}</option>
              {sources.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>

          {branches !== null && sources.length === 0 ? (
            <p className={styles.blocked}>{t('dlg.noSource')}</p>
          ) : null}

          {/* The same store's other waiting requests can join this lot. */}
          {included.length > 1 || others.length > 0 ? (
            <div className={styles.lot}>
              <span className={styles.lotHead}>{t('dlg.lotTitle', { n: included.length })}</span>
              {included.map((entry) => (
                <span key={entry.id} className={styles.lotChip}>
                  {requestRef(entry)}
                  {entry.id !== opened.id ? (
                    <button
                      type="button"
                      aria-label={t('a11y.removeItem', { n: requestRef(entry) })}
                      onClick={() => setIncluded((current) => current.filter((row) => row.id !== entry.id))}
                    >
                      ✕
                    </button>
                  ) : null}
                </span>
              ))}
              {others.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={styles.lotAdd}
                  onClick={() => setIncluded((current) => [...current, entry])}
                >
                  + {requestRef(entry)} · {t('dlg.units', { n: count(requestUnitCount(entry)) })}
                </button>
              ))}
            </div>
          ) : null}

          {lines.map((line) => (
            <div key={line.item.id} className={styles.approveLine}>
              {/* Decided item by item: the amount is fixed. */}
              <div className={styles.approveProduct}>
                <strong>{line.item.product.name}</strong>
                <em className={styles.sub}>
                  {line.item.product.sku} ·{' '}
                  {t('dlg.requestedN', { n: count(line.item.quantity) })}
                </em>
              </div>

              <label className={styles.qtyField}>
                <span>{t('dlg.approveQty')}</span>
                {/* A number box with up and down arrows: approve as it is,
                    or step it down, never above what was asked for. */}
                <div className={styles.stepper}>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max={maxOf(line.item)}
                    step="1"
                    value={line.raw}
                    onChange={(event) => setQuantity(line.item.id, event.target.value)}
                    aria-label={t('dlg.approveQtyFor', {
                      product: line.item.product.name,
                    })}
                    required
                  />
                  <div className={styles.stepButtons}>
                    <button
                      type="button"
                      aria-label="+1"
                      disabled={line.qty >= maxOf(line.item)}
                      onClick={() => setQuantity(line.item.id, String(Math.min(maxOf(line.item), line.qty + 1)))}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label="-1"
                      disabled={line.qty <= 0}
                      onClick={() => setQuantity(line.item.id, String(Math.max(0, line.qty - 1)))}
                    >
                      ▼
                    </button>
                  </div>
                </div>
              </label>

              {!line.valid ? (
                <p className={styles.lineWarn}>
                  {t('dlg.approveRange', { n: count(line.item.quantity) })}
                </p>
              ) : line.overStock ? (
                <p className={styles.lineWarn}>
                  {t('dlg.onlyInStockAt', {
                    n: count(line.inStock ?? 0),
                    store: sourceName ?? '',
                  })}
                </p>
              ) : line.inStock !== null ? (
                <p className={styles.lineNote}>
                  {t('dlg.inStockAt', {
                    n: count(line.inStock),
                    store: sourceName ?? '',
                  })}
                </p>
              ) : null}
            </div>
          ))}

          {!decided ? (
            <div className={styles.approveShortcuts}>
              {stock ? (
                <button type="button" className={styles.addLine} onClick={fillFromStock}>
                  {t('dlg.matchStock')}
                </button>
              ) : null}
              {approving !== requested ? (
                <button type="button" className={styles.addLine} onClick={approveAll}>
                  {t('dlg.approveAll')}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className={styles.saleTotal}>
            <span>{t('dlg.approvingLabel')}</span>
            <strong className="tabular">
              {t('dlg.approvingOf', {
                approved: count(approving),
                requested: count(requested),
              })}
            </strong>
          </div>

          {allValid && approving === 0 ? (
            <p className={styles.blocked}>{t('dlg.nothingApproved')}</p>
          ) : null}

          <label className={styles.field}>
            <span>{t('dlg.note')}</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
              placeholder={
                approving < requested
                  ? t('dlg.phPartialNote')
                  : t('dlg.phApproveNote')
              }
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}
          {/* Why the button is off, next to it rather than up in the list. */}
          {anyOverStock ? (
            <p className={styles.blocked}>{t('dlg.overStockAll', { store: sourceName ?? '', n: sending })}</p>
          ) : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!canSubmit}>
              {busy ? t('dlg.sending') : t('appr.send')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
