import { useEffect, useMemo, useState } from 'react'

import { Card, Empty } from '../Card'
import { api } from '../../lib/api'
import { count, currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { groupByDay } from '../../lib/salesDays'
import type { Deduction, ExpenseReport, Sale } from '../../lib/types'
import styles from './SalesDays.module.css'

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
export function SalesDaysReport({ from, to, branch, reload }: { from: string; to: string; branch: string; reload: number }) {
  const t = useT()
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
              {days.map((day) => [
                <tr
                  key={day.key}
                  className={styles.clickable}
                  tabIndex={0}
                  aria-expanded={open === day.key}
                  onClick={() => setOpen(open === day.key ? null : day.key)}
                  onKeyDown={(event) => event.key === 'Enter' && setOpen(open === day.key ? null : day.key)}
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
                </tr>,
                // Tapping a day lists what was sold, product by product.
                open === day.key ? (
                  <tr key={`${day.key}-items`} className={styles.detail}>
                    <td colSpan={10}>
                      {day.items.length === 0 ? (
                        <em>{t('rep.noSalesPeriod')}</em>
                      ) : (
                        <ul>
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
                    </td>
                  </tr>
                ) : null,
              ])}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
