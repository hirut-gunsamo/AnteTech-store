import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { Card, Empty } from '../Card'
import { useAuth } from '../../auth/context'
import { api } from '../../lib/api'
import { useBranchList } from '../../lib/branches'
import { count, currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { groupByDay, type SalesDay } from '../../lib/salesDays'
import type { Deduction, ExpenseReport, Sale } from '../../lib/types'
import styles from './SalesDays.module.css'
import panel from '../inventory/Panel.module.css'
import { useSavedState } from '../../lib/savedState'

/** Every month from one day to another, as YYYY-MM, for the deductions API. */
function monthsBetween(from: string, to: string) {
  const months: string[] = []
  let [year, month] = from.slice(0, 7).split('-').map(Number)
  const [endYear, endMonth] = to.slice(0, 7).split('-').map(Number)
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(`${year}-${`${month}`.padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return months
}

/**
 * The sales report as the business reads it: one line per salesperson per
 * day with the phones and accessories sold, the day's total and how it was
 * paid, what was taken off (deductions and expenses) and what is left. A
 * seller sees only their own days; the Owner every store's.
 */
export function SalesDaysReport({
  from: pageFrom,
  to: pageTo,
  branch: pageBranch,
  reload,
}: {
  from: string
  to: string
  branch: string
  reload: number
}) {
  const t = useT()
  const { user } = useAuth()
  const branchList = useBranchList()
  const isOwner = user?.role === 'OWNER'

  // As on the SIM app: the table's own day (today first; cleared, the whole
  // period shows) and, for the Owner, its own store, taken on Apply.
  const [tableDay, setTableDay] = useSavedState('salesDays.day', () => {
    const now = new Date()
    return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, '0')}-${`${now.getDate()}`.padStart(2, '0')}`
  })
  const [storeDraft, setStoreDraft] = useState(pageBranch)
  const [tableStore, setTableStore] = useSavedState('salesDays.store', pageBranch)

  // Dates picked at the top of the page win: the table shows that range
  // instead of staying on one day. Skipped on first load, so a kept day stays.
  const lastDates = useRef(`${pageFrom}|${pageTo}`)
  useEffect(() => {
    const now = `${pageFrom}|${pageTo}`
    if (lastDates.current === now) return
    lastDates.current = now
    setTableDay('')
  }, [pageFrom, pageTo, setTableDay])

  // The page's store, when changed there, is the table's too.
  const lastBranch = useRef(pageBranch)
  useEffect(() => {
    if (lastBranch.current === pageBranch) return
    lastBranch.current = pageBranch
    setStoreDraft(pageBranch)
    setTableStore(pageBranch)
  }, [pageBranch, setTableStore])
  useEffect(() => setStoreDraft(tableStore), [tableStore])

  const from = tableDay || pageFrom
  const to = tableDay || pageTo
  const branch = isOwner ? tableStore : pageBranch

  const [sales, setSales] = useState<Sale[] | null>(null)
  const [deductions, setDeductions] = useState<Deduction[]>([])
  const [expenses, setExpenses] = useState<ExpenseReport['expenses']>([])
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    if (!from || !to) return
    const controller = new AbortController()
    const signal = controller.signal
    const scope = branch !== 'ALL' ? `&branchId=${branch}` : ''
    // The sales list takes exact times: the whole of both days, local time.
    const salesQuery = new URLSearchParams({
      from: new Date(`${from}T00:00:00`).toISOString(),
      to: new Date(`${to}T23:59:59.999`).toISOString(),
      status: 'APPROVED',
    })
    if (branch !== 'ALL') salesQuery.set('branchId', branch)
    Promise.all([
      api<{ sales: Sale[] }>(`/api/sales?${salesQuery}`, { signal }),
      Promise.all(
        monthsBetween(from, to).map((month) =>
          api<{ deductions: Deduction[] }>(`/api/deductions?month=${month}${scope}`, { signal })
            .then((res) => res.deductions)
            .catch(() => [] as Deduction[]),
        ),
      ).then((months) => months.flat().filter((row) => row.day >= from && row.day <= to)),
      api<ExpenseReport>(`/api/expenses?from=${from}&to=${to}${scope}`, { signal })
        .then((res) => res.expenses)
        .catch(() => [] as ExpenseReport['expenses']),
    ])
      .then(([salesRes, deductionRows, expenseRows]) => {
        setSales(salesRes.sales.filter((sale) => sale.status === 'APPROVED'))
        setDeductions(deductionRows)
        setExpenses(expenseRows)
      })
      .catch(() => {
        if (!signal.aborted) setSales([])
      })
    return () => controller.abort()
  }, [from, to, branch, reload])

  const days = useMemo(() => (sales ? groupByDay(sales, deductions, expenses) : []), [sales, deductions, expenses])

  // As on the SIM app: dates chosen across more than one day show each
  // seller's total for the whole period, not a line per day; then each
  // store's total and the grand total.
  const isRange = from !== to
  const periodLabel = isRange
    ? `${shortDate(`${from}T12:00:00`)} – ${shortDate(`${to}T12:00:00`)}`
    : shortDate(`${from}T12:00:00`)

  const rows = useMemo(() => {
    if (!isRange) return days
    const byPerson = new Map<string, SalesDay>()
    for (const day of days) {
      const key = `period|${day.salesperson.id}`
      byPerson.set(key, addDays(byPerson.get(key), day, key))
    }
    return [...byPerson.values()].sort(
      (a, b) => a.store.localeCompare(b.store) || a.salesperson.name.localeCompare(b.salesperson.name),
    )
  }, [days, isRange])

  // Each store's own total line, after its sellers.
  const storeGroups = useMemo(() => {
    const groups = new Map<string, SalesDay[]>()
    for (const row of rows) groups.set(row.store, [...(groups.get(row.store) ?? []), row])
    return [...groups.entries()].map(([store, list]) => ({
      store,
      list,
      total: list.reduce<SalesDay | undefined>((acc, row) => addDays(acc, row, `store|${store}`), undefined)!,
    }))
  }, [rows])

  const grandTotal = useMemo(
    () => rows.reduce<SalesDay | undefined>((acc, row) => addDays(acc, row, 'total'), undefined),
    [rows],
  )

  const openDay = rows.find((day) => day.key === open) ?? null
  const sum = useMemo(
    () =>
      days.reduce(
        (acc, day) => ({
          phones: acc.phones + day.phones.quantity,
          accessories: acc.accessories + day.accessories.quantity,
          total: acc.total + day.total,
          deductions: acc.deductions + day.deductions,
          expenses: acc.expenses + day.expenses,
          net: acc.net + day.net,
        }),
        { phones: 0, accessories: 0, total: 0, deductions: 0, expenses: 0, net: 0 },
      ),
    [days],
  )

  // Goods show how many, with the money underneath. A zero stays quiet.
  const goods = (label: string, quantity: number, amount: number, first = false) => (
    <td
      data-label={label}
      className={`tabular ${first ? styles.groupStart : ''}`}
      data-zero={quantity === 0 ? '' : undefined}
    >
      <strong>{count(quantity)}</strong>
      <em>{currency(amount)}</em>
    </td>
  )
  const money = (label: string, amount: number, className = '') => (
    <td data-label={label} className={`${className} tabular`} data-zero={amount === 0 ? '' : undefined}>
      <strong>{currency(amount)}</strong>
    </td>
  )

  const figureCells = (day: SalesDay) => (
    <>
      {goods(t('ds.phones'), day.phones.quantity, day.phones.amount, true)}
      {goods(t('ds.accessories'), day.accessories.quantity, day.accessories.amount)}
      {money(t('ds.dayTotal'), day.total, `${styles.total} ${styles.groupStart}`)}
      {money(t('ds.transfer'), day.transfer)}
      {money(t('ds.cash'), day.cash)}
      {money(t('ds.deductions'), day.deductions, `${styles.minus} ${styles.groupStart}`)}
      {money(t('ds.expenses'), day.expenses, styles.minus)}
      {money(t('ds.net'), day.net, `${styles.net} ${styles.groupStart}`)}
    </>
  )

  return (
    <Card
      title={t('ds.title')}
      subtitle={
        days.length > 0
          ? t('ds.summary', {
              phones: count(sum.phones),
              accessories: count(sum.accessories),
              total: currency(sum.total),
              net: currency(sum.net),
            })
          : t('ds.note')
      }
    >
      <div className={styles.branchBar}>
        <input
          type="date"
          className={styles.branchSelect}
          value={tableDay}
          onChange={(event) => setTableDay(event.target.value)}
          aria-label={t('req.date')}
        />
        {tableDay ? (
          <button type="button" className={styles.apply} onClick={() => setTableDay('')}>
            {t('ds.allDates')}
          </button>
        ) : null}
        {isOwner ? (
          <>
            <select
              className={styles.branchSelect}
              value={storeDraft}
              onChange={(event) => setStoreDraft(event.target.value)}
              aria-label={t('inv.branchLabel')}
            >
              <option value="ALL">{t('inv.allBranches')}</option>
              {branchList.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.apply}
              onClick={() => setTableStore(storeDraft)}
              disabled={tableStore === storeDraft}
            >
              {t('rep.apply')}
            </button>
          </>
        ) : null}
      </div>

      {sales === null ? (
        <Empty>{t('common.loading')}</Empty>
      ) : days.length === 0 ? (
        <Empty>{t('rep.noSalesPeriod')}</Empty>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('req.date')}</th>
                <th scope="col">{t('sales.employee')}</th>
                <th scope="col" className={styles.groupStart}>{t('ds.phones')}</th>
                <th scope="col">{t('ds.accessories')}</th>
                <th scope="col" className={styles.groupStart}>{t('ds.dayTotal')}</th>
                <th scope="col">{t('ds.transfer')}</th>
                <th scope="col">{t('ds.cash')}</th>
                <th scope="col" className={styles.groupStart}>{t('ds.deductions')}</th>
                <th scope="col">{t('ds.expenses')}</th>
                <th scope="col" className={styles.groupStart}>{t('ds.net')}</th>
              </tr>
            </thead>
            <tbody>
              {storeGroups.map((group) => (
                <Fragment key={group.store}>
                  {group.list.map((day) => (
                    <tr
                      key={day.key}
                      className={styles.clickable}
                      tabIndex={0}
                      aria-haspopup="dialog"
                      data-open={open === day.key ? '' : undefined}
                      onClick={() => setOpen(day.key)}
                      onKeyDown={(event) => event.key === 'Enter' && setOpen(day.key)}
                    >
                      <td data-label={t('req.date')} className={styles.when}>
                        {isRange ? periodLabel : shortDate(`${day.date}T12:00:00`)}
                      </td>
                      <td data-label={t('sales.employee')} className={styles.who}>
                        <strong>{day.salesperson.name}</strong>
                        <em>{day.store}</em>
                      </td>
                      {figureCells(day)}
                    </tr>
                  ))}

                  {/* The store's total, when more than one store is shown. */}
                  {isOwner && storeGroups.length > 1 ? (
                    <tr className={styles.totalRow}>
                      <td data-label={t('req.date')} className={styles.when}>
                        {periodLabel}
                      </td>
                      <td data-label={t('sales.employee')} className={styles.who}>
                        <strong>{t('ds.storeTotal')}</strong>
                        <em>{group.store}</em>
                      </td>
                      {figureCells(group.total)}
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
            {grandTotal ? (
              <tfoot>
                <tr className={styles.grandRow}>
                  <td data-label={t('req.date')} className={styles.when}>
                    {periodLabel}
                  </td>
                  <td data-label={t('sales.employee')} className={styles.who}>
                    <strong>{t('ds.grandTotal')}</strong>
                  </td>
                  {figureCells(grandTotal)}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      {/* Tapping a day opens it on the right, as the SIM app does. */}
      {openDay ? (
        <DayDetails
          day={openDay}
          when={isRange ? periodLabel : shortDate(`${openDay.date}T12:00:00`)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </Card>
  )
}

/** One seller's day on the right: the money first, then what was sold. */
function DayDetails({ day, when, onClose }: { day: SalesDay; when: string; onClose: () => void }) {
  const t = useT()

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const figures: [string, number, string?][] = [
    [t('ds.dayTotal'), day.total],
    [t('ds.transfer'), day.transfer],
    [t('ds.cash'), day.cash],
    [t('ds.deductions'), day.deductions, styles.minus],
    [t('ds.expenses'), day.expenses, styles.minus],
  ]

  return (
    <div className={panel.scrim} onClick={onClose}>
      <aside
        className={panel.panel}
        role="dialog"
        aria-modal="true"
        aria-label={day.salesperson.name}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={panel.head}>
          <div>
            <h2>{day.salesperson.name}</h2>
            <p>
              {when} · {day.store}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <div className={`${panel.body} ${styles.dayPanel}`}>
          <dl className={styles.dayFigures}>
            <div>
              <dt>{t('ds.phones')}</dt>
              <dd className="tabular">
                {count(day.phones.quantity)} · {currency(day.phones.amount)}
              </dd>
            </div>
            <div>
              <dt>{t('ds.accessories')}</dt>
              <dd className="tabular">
                {count(day.accessories.quantity)} · {currency(day.accessories.amount)}
              </dd>
            </div>
            {figures.map(([label, amount, className]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className={`tabular ${amount > 0 ? (className ?? '') : ''}`}>{currency(amount)}</dd>
              </div>
            ))}
            <div className={styles.dayNet}>
              <dt>{t('ds.net')}</dt>
              <dd className="tabular">{currency(day.net)}</dd>
            </div>
          </dl>

          <h3 className={styles.dayItemsTitle}>{t('ds.itemsSold')}</h3>
          {day.items.length === 0 ? (
            <Empty>{t('rep.noSalesPeriod')}</Empty>
          ) : (
            <ul className={styles.dayItems}>
              {[...day.items]
                .sort((a, b) => b.amount - a.amount)
                .map((item) => (
                  <li key={item.name}>
                    <span>{item.name}</span>
                    <span className="tabular">
                      {count(item.quantity)} × {currency(item.amount / item.quantity)}
                    </span>
                    <strong className="tabular">{currency(item.amount)}</strong>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  )
}

/** Two lines added together: a seller's days into a period, or a store's. */
function addDays(into: SalesDay | undefined, day: SalesDay, key: string): SalesDay {
  const base: SalesDay = into ?? {
    key,
    date: day.date,
    salesperson: day.salesperson,
    store: day.store,
    phones: { quantity: 0, amount: 0 },
    accessories: { quantity: 0, amount: 0 },
    total: 0,
    transfer: 0,
    cash: 0,
    deductions: 0,
    expenses: 0,
    net: 0,
    items: [],
  }
  const items = [...base.items]
  for (const item of day.items) {
    const found = items.find((entry) => entry.name === item.name)
    if (found) {
      found.quantity += item.quantity
      found.amount += item.amount
    } else items.push({ ...item })
  }
  return {
    ...base,
    phones: { quantity: base.phones.quantity + day.phones.quantity, amount: base.phones.amount + day.phones.amount },
    accessories: {
      quantity: base.accessories.quantity + day.accessories.quantity,
      amount: base.accessories.amount + day.accessories.amount,
    },
    total: base.total + day.total,
    transfer: base.transfer + day.transfer,
    cash: base.cash + day.cash,
    deductions: base.deductions + day.deductions,
    expenses: base.expenses + day.expenses,
    net: base.net + day.net,
    items: items.map((item) => ({ ...item })),
  }
}
