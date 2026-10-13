import type { Deduction, ExpenseReport, Sale } from './types'

/** How many, and for how much. */
export type Figure = { quantity: number; amount: number }

/** One salesperson's day: what they sold, how it was paid, what came off. */
export type SalesDay = {
  key: string
  date: string
  salesperson: { id: string; name: string }
  store: string
  phones: Figure
  accessories: Figure
  total: number
  /** What of the total came by bank transfer; the rest was cash. */
  transfer: number
  cash: number
  deductions: number
  expenses: number
  /** The day's total less its deductions and expenses. */
  net: number
}

function localDay(value: string) {
  const when = new Date(value)
  return `${when.getFullYear()}-${`${when.getMonth() + 1}`.padStart(2, '0')}-${`${when.getDate()}`.padStart(2, '0')}`
}

/**
 * One row per salesperson per day: the Owner wants "3 phones, 12
 * accessories, 41,000 birr" for the day, not every customer one by one.
 * Phones are the serial-numbered goods; accessories everything counted.
 */
export function groupByDay(
  sales: Sale[],
  deductions: Deduction[] = [],
  expenses: ExpenseReport['expenses'] = [],
): SalesDay[] {
  const days = new Map<string, SalesDay>()
  const dayOf = (date: string, person: { id: string; name: string }, store: string) => {
    const key = `${date}|${person.id}`
    let day = days.get(key)
    if (!day) {
      day = {
        key,
        date,
        salesperson: { id: person.id, name: person.name },
        store,
        phones: { quantity: 0, amount: 0 },
        accessories: { quantity: 0, amount: 0 },
        total: 0,
        transfer: 0,
        cash: 0,
        deductions: 0,
        expenses: 0,
        net: 0,
      }
      days.set(key, day)
    }
    return day
  }

  for (const sale of sales) {
    const day = dayOf(localDay(sale.saleDate), sale.salesperson, sale.location.name)
    const total = Number(sale.totalAmount)
    const transferred = Math.min(Number(sale.transferReceived), total)
    day.total += total
    day.transfer += transferred
    day.cash += total - transferred
    for (const item of sale.items) {
      const figure = item.product.category === 'SERIALIZED' ? day.phones : day.accessories
      figure.quantity += item.quantity
      figure.amount += Number(item.lineTotal)
    }
  }
  // Money taken off a seller is part of their day, even a day with no sale.
  for (const row of deductions) {
    dayOf(row.day, row.user, row.user.branch?.name ?? '—').deductions += Number(row.total)
  }
  for (const row of expenses) {
    dayOf(localDay(row.expenseDate), row.recordedBy, row.branch.name).expenses += Number(row.amount)
  }

  for (const day of days.values()) day.net = day.total - day.deductions - day.expenses

  return [...days.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || a.salesperson.name.localeCompare(b.salesperson.name),
  )
}
