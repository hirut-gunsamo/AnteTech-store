import { useEffect, useMemo, useRef, useState } from 'react'

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
  const openDay = days.find((day) => day.key === open) ?? null
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
              {days.map((day) => (
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
                    {shortDate(`${day.date}T12:00:00`)}
                  </td>
                  <td data-label={t('sales.employee')} className={styles.who}>
                    <strong>{day.salesperson.name}</strong>
                    <em>{day.store}</em>
                  </td>
                  {goods(t('ds.phones'), day.phones.quantity, day.phones.amount, true)}
                  {goods(t('ds.accessories'), day.accessories.quantity, day.accessories.amount)}
                  {money(t('ds.dayTotal'), day.total, `${styles.total} ${styles.groupStart}`)}
                  {money(t('ds.transfer'), day.transfer)}
                  {money(t('ds.cash'), day.cash)}
                  {money(t('ds.deductions'), day.deductions, `${styles.minus} ${styles.groupStart}`)}
                  {money(t('ds.expenses'), day.expenses, styles.minus)}
                  {money(t('ds.net'), day.net, `${styles.net} ${styles.groupStart}`)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tapping a day opens it on the right, as the SIM app does. */}
      {openDay ? <DayDetails day={openDay} onClose={() => setOpen(null)} /> : null}
    </Card>
  )
}

/** One seller's day on the right: the money first, then what was sold. */
function DayDetails({ day, onClose }: { day: SalesDay; onClose: () => void }) {
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
              {shortDate(`${day.date}T12:00:00`)} · {day.store}
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
