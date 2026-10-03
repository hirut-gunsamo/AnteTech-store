import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { useCategories } from '../../lib/categories'
import { currency } from '../../lib/format'
import { useT } from '../../lib/i18n'
import type { CatalogueProduct } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

type Employee = {
  id: string
  name: string
  role: string
  isActive: boolean
  branch: { id: string; name: string } | null
}

type Line = {
  key: number
  categoryId: string
  typeId: string
  productId: string
  quantity: string
  /** Blank means "price × quantity"; typed, it replaces that. */
  amount: string
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`
}

const NO_BRANCH = '__none__'

/**
 * Records one day's deduction: the date and each item short or lost
 * (category, type, product, how many). An item's amount fills in as its
 * selling price times the quantity and can be changed. Sellers record their
 * own; the Owner first picks the store and seller.
 */
export function DeductionDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: (total: number) => void
}) {
  const t = useT()
  const { user } = useAuth()
  const isOwner = user?.role === 'OWNER'
  const { categories } = useCategories()

  const [products, setProducts] = useState<CatalogueProduct[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [branchId, setBranchId] = useState('')
  const [userId, setUserId] = useState('')
  const [day, setDay] = useState(today())
  const [lines, setLines] = useState<Line[]>([
    { key: 1, categoryId: '', typeId: '', productId: '', quantity: '1', amount: '' },
  ])
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
    api<{ products: CatalogueProduct[] }>('/api/products', { signal: controller.signal })
      .then((payload) => setProducts((payload.products ?? []).filter((row) => row.status === 'ACTIVE')))
      .catch(() => undefined)
    if (isOwner) {
      api<{ employees: Employee[] }>('/api/payroll/employees', { signal: controller.signal })
        .then((payload) => setEmployees((payload.employees ?? []).filter((row) => row.isActive)))
        .catch(() => undefined)
    }
    return () => controller.abort()
  }, [isOwner])

  // The Owner picks the store, then one of its sellers.
  const branchOptions = [
    ...new Map(employees.map((row) => [row.branch?.id ?? NO_BRANCH, row.branch?.name ?? t('dlg.noBranch')] as const)),
  ].sort((a, b) => a[1].localeCompare(b[1]))
  const validBranchId = branchOptions.some(([id]) => id === branchId) ? branchId : (branchOptions[0]?.[0] ?? '')
  const people = employees
    .filter((row) => (row.branch?.id ?? NO_BRANCH) === validBranchId)
    .sort((a, b) => a.name.localeCompare(b.name))
  const validUserId = people.some((row) => row.id === userId) ? userId : (people[0]?.id ?? '')

  // Each product with its top-level type: a phone's brand or an accessory's type.
  const options = useMemo(
    () =>
      products.map((product) => ({
        id: product.id,
        name: product.name,
        price: Number(product.price ?? 0),
        categoryId: product.categoryId ?? '',
        typeId: product.type?.parentId ?? product.type?.id ?? '',
        typeName: product.type?.parent?.name ?? product.type?.name ?? '—',
      })),
    [products],
  )

  const priced = lines.map((line) => {
    const product = options.find((entry) => entry.id === line.productId)
    const qty = Number(line.quantity)
    const qtyValid = Number.isInteger(qty) && qty > 0
    const auto = product && qtyValid ? product.price * qty : 0
    const typed = line.amount.trim() === '' ? null : Number(line.amount)
    const value = typed ?? auto
    return {
      ...line,
      product,
      auto,
      value,
      valid: product != null && qtyValid && Number.isFinite(value) && value >= 0,
    }
  })

  const total = priced.reduce((sum, line) => sum + (line.valid ? line.value : 0), 0)
  const valid =
    day !== '' && priced.length > 0 && priced.every((line) => line.valid) && (!isOwner || validUserId !== '')

  function setLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)

    try {
      await api('/api/deductions', {
        method: 'POST',
        body: {
          day,
          ...(isOwner ? { userId: validUserId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          lines: priced.map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
            ...(line.amount.trim() !== '' ? { amount: Number(line.amount) } : {}),
          })),
        },
      })
      onDone(total)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save it.')
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
        aria-label={t('ded.addTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('ded.addTitle')}</h2>
            <p>{t('ded.addNote')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          {isOwner ? (
            <>
              <label className={styles.field}>
                <span>
                  {t('common.branch')}<em>{t('common.required')}</em>
                </span>
                <select value={validBranchId} onChange={(event) => setBranchId(event.target.value)}>
                  {branchOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>
                  {t('pay.employee')}<em>{t('common.required')}</em>
                </span>
                <select value={validUserId} onChange={(event) => setUserId(event.target.value)}>
                  {people.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}

          <label className={styles.field}>
            <span>
              {t('req.date')}<em>{t('common.required')}</em>
            </span>
            <input type="date" value={day} onChange={(event) => setDay(event.target.value)} required />
          </label>

          {priced.map((line, index) => {
            const types = [
              ...new Map(
                options
                  .filter((entry) => !line.categoryId || entry.categoryId === line.categoryId)
                  .filter((entry) => entry.typeId)
                  .map((entry) => [entry.typeId, entry.typeName] as const),
              ),
            ].sort((a, b) => a[1].localeCompare(b[1]))
            const shown = options
              .filter((entry) => !line.categoryId || entry.categoryId === line.categoryId)
              .filter((entry) => !line.typeId || entry.typeId === line.typeId)
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))

            return (
              <div key={line.key} className={styles.saleLine}>
                <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <span>
                    {t('dlg.item', { n: index + 1 })} · {t('prod.category')}
                  </span>
                  <select
                    value={line.categoryId}
                    onChange={(event) =>
                      setLine(line.key, { categoryId: event.target.value, typeId: '', productId: '', amount: '' })
                    }
                  >
                    <option value="">{t('sale.allCategories')}</option>
                    {categories.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <span>{t('prod.type')}</span>
                  <select
                    value={line.typeId}
                    onChange={(event) => setLine(line.key, { typeId: event.target.value, productId: '', amount: '' })}
                  >
                    <option value="">{t('dlg.allTypes')}</option>
                    {types.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.field}>
                  <span>{t('dlg.product')}</span>
                  <select
                    value={line.productId}
                    onChange={(event) => setLine(line.key, { productId: event.target.value, amount: '' })}
                    required
                  >
                    <option value="">{t('dlg.selectProduct')}</option>
                    {shown.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
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
                    onChange={(event) => setLine(line.key, { quantity: event.target.value, amount: '' })}
                    required
                  />
                </label>

                <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
                  <span>
                    {t('ded.amount')}<em>{t('ded.amountNote')}</em>
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={line.amount}
                    placeholder={line.auto ? String(line.auto) : '0'}
                    onChange={(event) => setLine(line.key, { amount: event.target.value })}
                  />
                </label>

                {lines.length > 1 ? (
                  <button
                    type="button"
                    className={styles.removeLine}
                    onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
                    aria-label={t('a11y.removeItem', { n: index + 1 })}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            )
          })}

          <button
            type="button"
            className={styles.addLine}
            onClick={() =>
              setLines((current) => [
                ...current,
                {
                  key: Math.max(0, ...current.map((line) => line.key)) + 1,
                  categoryId: '',
                  typeId: '',
                  productId: '',
                  quantity: '1',
                  amount: '',
                },
              ])
            }
          >
            {t('dlg.addAnother')}
          </button>

          <label className={styles.field}>
            <span>
              {t('dlg.note')}<em>{t('prod.optional')}</em>
            </span>
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
          </label>

          <dl className={styles.facts}>
            <div>
              <dt>{t('ded.total')}</dt>
              <dd className="tabular">
                <strong>{currency(total)}</strong>
              </dd>
            </div>
          </dl>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" className={styles.submit} disabled={!valid || busy}>
              {busy ? t('prod.saving') : t('ded.add')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
