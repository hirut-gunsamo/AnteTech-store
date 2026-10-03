import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../../lib/api'
import { count, currency, shortDate } from '../../lib/format'
import { useT } from '../../lib/i18n'
import { saleRef, STATUS_KEY } from '../../lib/sales'
import type {
  CurrentUser,
  Dashboard,
  InventorySummary,
  Sale,
} from '../../lib/types'
import { Card, Empty } from '../Card'
import { StatCard } from '../StatCard'
import { RecentActivities } from './RecentActivities'
import styles from './SalesDashboard.module.css'

/**
 * The seller's dashboard: their own day and their store's stock.
 *
 * Sales and cash are this person's own — the API already scopes them to the
 * signed-in user, so "Today's Sales" means theirs. Stock and the activity
 * feed are the store's, and are labelled so; nothing from another store
 * reaches this view.
 */
export function SalesDashboard({
  data,
  user,
}: {
  data: Dashboard
  user: CurrentUser
}) {
  const t = useT()

  const [mySales, setMySales] = useState<Sale[] | null>(null)
  const [stock, setStock] = useState<InventorySummary | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    // Both already scoped by the API: own sales, own store's stock.
    Promise.all([
      api<{ sales: Sale[] }>('/api/sales', { signal: controller.signal }).catch(
        () => ({ sales: [] as Sale[] }),
      ),
      api<{ summary: InventorySummary }>('/api/inventory/summary', {
        signal: controller.signal,
      }).catch(() => ({ summary: null as InventorySummary | null })),
    ]).then(([sales, summary]) => {
      if (controller.signal.aborted) return
      setMySales(sales.sales ?? [])
      setStock(summary.summary)
    })

    return () => controller.abort()
  }, [])

  // Cash taken over the counter and not yet banked.
  const inHand = data.cashPosition.totals.inHand

  const itemsToday = Object.values(data.today.byCategory).reduce(
    (sum, entry) => sum + entry.quantity,
    0,
  )

  const recent = (mySales ?? []).slice(0, 6)
  const lowStock = data.lowStock.slice(0, 5)

  return (
    <>
      <div className={styles.tiles}>
        <StatCard
          label={t('dash.todaysSales')}
          value={currency(data.today.revenue)}
          icon="cart"
          tone="green"
          to="/sales"
        />
        <StatCard
          label={t('sales.itemsSold')}
          value={count(itemsToday)}
          icon="box"
          tone="blue"
          to="/sales"
        />
        <StatCard
          label={t('rep.stillInHand')}
          value={currency(inHand)}
          icon="cash"
          tone="emerald"
          to="/receipts"
        />
        <StatCard
          label={t('dash.storeStock')}
          value={count(stock?.totalUnits ?? 0)}
          icon="box"
          tone="blue"
          to="/inventory"
        />
      </div>

      <div className={styles.split}>
        <Card
          title={t('dash.myRecentSales')}
          subtitle={t('dash.myRecentNote')}
          action={
            <Link className={styles.viewAll} to="/sales">
              {t('common.viewAll')}
            </Link>
          }
        >
          {!mySales ? (
            <Empty>{t('common.loading')}</Empty>
          ) : recent.length === 0 ? (
            <Empty>{t('dash.noSalesYet')}</Empty>
          ) : (
            <ul className={styles.saleList}>
              {recent.map((sale) => (
                <li key={sale.id}>
                  <span className={styles.saleMain}>
                    <strong className="tabular">{saleRef(sale)}</strong>
                    <em>{shortDate(sale.saleDate)}</em>
                  </span>
                  <span
                    className={styles.saleState}
                    data-state={sale.status}
                  >
                    {t(STATUS_KEY[sale.status])}
                  </span>
                  <strong className={`${styles.saleTotal} tabular`}>
                    {currency(Number(sale.totalAmount))}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className={styles.side}>
          {/* Stock is the branch's, not this person's — labelled so. */}
          <Card
            title={t('dash.lowStock')}
            subtitle={
              user.branch ? user.branch.name : t('dash.yourBranch')
            }
            action={
              <Link className={styles.viewAll} to="/inventory">
                {t('common.viewAll')}
              </Link>
            }
          >
            {lowStock.length === 0 ? (
              <Empty>{t('dash.allAboveReorder')}</Empty>
            ) : (
              <ul className={styles.lowList}>
                {lowStock.map((row) => (
                  <li key={row.id}>
                    <span>{row.name}</span>
                    <strong className="tabular" data-out={row.quantity === 0}>
                      {count(row.quantity)}
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Deliveries, requests and corrections at this store, plus this
              person's own sales. */}
          <Card
            title={t('dash.storeActivity')}
            subtitle={
              user.branch ? user.branch.name : t('dash.yourBranch')
            }
          >
            <RecentActivities items={data.recentActivity} limit={5} />
          </Card>
        </div>
      </div>
    </>
  )
}
