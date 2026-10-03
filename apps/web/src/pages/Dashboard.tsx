import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { DownloadButton } from '../components/DownloadButton'
import { Toasts } from '../components/Toasts'
import { StatCard } from '../components/StatCard'
import { SalesDashboard } from '../components/dashboard/SalesDashboard'
import { RecentActivities } from '../components/dashboard/RecentActivities'
import { StoreStock } from '../components/StoreStock'
import { icons } from '../components/icons'
import { api, downloadCsv, OfflineError } from '../lib/api'
import { useT, type TranslationKey } from '../lib/i18n'
import { useSync } from '../lib/sync'
import { useToasts } from '../lib/toasts'
import { count, currency } from '../lib/format'
import type { Dashboard as DashboardData } from '../lib/types'
import styles from './Dashboard.module.css'

function isoDate(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

function ActivityIcon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

// The Owner's own jobs. Selling is the stores' work, and sales figures live
// on Reports.
const QUICK_ACTIONS: {
  to: string
  labelKey: TranslationKey
  icon: keyof typeof icons
  tone: string
}[] = [
  { to: '/approvals', labelKey: 'nav.approvals', icon: 'check', tone: 'blue' },
  { to: '/requests', labelKey: 'nav.requests', icon: 'clipboard', tone: 'violet' },
  { to: '/receipts', labelKey: 'nav.receipts', icon: 'receipt', tone: 'green' },
  { to: '/inventory', labelKey: 'nav.inventory', icon: 'box', tone: 'amber' },
  { to: '/reports', labelKey: 'nav.reports', icon: 'chart', tone: 'blue' },
  { to: '/sync', labelKey: 'nav.sync', icon: 'sync', tone: 'grey' },
]

export default function Dashboard() {
  const { user } = useAuth()

  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  const { toasts, push, dismiss } = useToasts()
  const t = useT()
  // Refetch when the connection returns, so a dashboard opened offline fills
  // itself in instead of waiting for a manual reload.
  const { online } = useSync()

  // Downloads whatever the card is currently showing.
  async function download(path: string, filename: string, tag: string) {
    setDownloading(tag)

    try {
      await downloadCsv(path, filename)
      push('success', t('toast.savedToDownloads', { name: filename }))
    } catch {
      push('error', t('dash.downloadFailed'))
    } finally {
      setDownloading(null)
    }
  }

  useEffect(() => {
    const controller = new AbortController()

    api<{ dashboard: DashboardData }>('/api/reports/dashboard', {
      signal: controller.signal,
    })
      .then((payload) => {
        setData(payload.dashboard)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(
          caught instanceof OfflineError
            ? t('pwa.dashOffline')
            : caught instanceof Error
              ? caught.message
              : t('dash.loadFailed'),
        )
      })

    return () => controller.abort()
  }, [t, online])

  if (!user) return null

  // Figures already on screen stay put if a later refresh fails (the offline
  // banner says why); the error only stands in when there is nothing to show.
  if (error && !data) {
    return (
      <Card title={t("dash.title")}>
        <Empty>{error}</Empty>
      </Card>
    )
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <div className={styles.tiles}>
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className={styles.skeletonTile} />
          ))}
        </div>
        <div className={styles.split}>
          <div className={styles.skeletonCard} />
          <div className={styles.skeletonCard} />
        </div>
      </div>
    )
  }

  // One route, two views. A seller's day is about their own work and their
  // store, which is a different shape from the Owner's view of every store.
  if (user.role === 'SALES') {
    return (
      <div className={styles.page}>
        <div className={styles.mobileGreeting}>
          <h2>
            {t('dash.welcome')}, {user.name.split(' ')[0]}!
          </h2>
          <p>{t('dash.todayNote')}</p>
        </div>

        <SalesDashboard data={data} user={user} />

        <Toasts toasts={toasts} onDismiss={dismiss} />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      {/* Mobile-only greeting; on desktop the shell header carries it. */}
      <div className={styles.mobileGreeting}>
        <h2>{t('dash.welcome')}, {user.name.split(' ')[0]}!</h2>
        <p>{t('dash.todayNote')}</p>
      </div>

      {/* What is on the shelves. Sales are on the Reports page. */}
      <div className={styles.tiles}>
        <StatCard
          label={t('kind.SERIALIZED')}
          value={count(data.tiles.devices.value)}
          changePct={data.tiles.devices.changePct}
          icon="phone"
          tone="blue"
          to="/inventory"
        />
        <StatCard
          label={t('kind.QUANTITY')}
          value={count(data.tiles.accessories.value)}
          changePct={data.tiles.accessories.changePct}
          icon="box"
          tone="green"
          to="/inventory"
        />
        <StatCard
          label={t('dash.unitsInStock')}
          value={count(data.stock.totals.totalUnits)}
          icon="branch"
          tone="red"
          to="/inventory"
        />
        <StatCard
          label={t('dash.stockValue')}
          value={currency(data.stock.totals.stockValue)}
          icon="cash"
          tone="emerald"
          to="/inventory"
        />
      </div>

      {/* ---------- Stock by store, full width ---------- */}
      <Card
        title={t('dash.stockByBranch')}
        subtitle={t('dash.stockNote')}
        action={
          <div className={styles.cardActions}>
            <DownloadButton
              filename={`stock-by-store-${isoDate(new Date())}.csv`}
              note={t('dash.stockByBranch')}
              className={styles.iconButton}
              disabled={downloading === 'branches'}
              title={t("dash.downloadBranch")}
              onConfirm={() =>
                download(
                  '/api/reports/inventory?format=csv',
                  `stock-by-store-${isoDate(new Date())}.csv`,
                  'branches',
                )
              }
            >
              <ActivityIcon name="download" />
            </DownloadButton>
          </div>
        }
      >
        <StoreStock data={data} />
      </Card>

      <div className={styles.split}>
        <Card
          title={t('dash.lowStock')}
          action={
            <Link className={styles.viewAll} to="/inventory">
              {t('common.viewAll')}
            </Link>
          }
        >
          {data.lowStock.length === 0 ? (
            <Empty>{t('dash.allAboveReorder')}</Empty>
          ) : (
            <ul className={styles.lowList}>
              {data.lowStock.map((row) => (
                <li key={`${row.id}-${row.branch}`}>
                  <span>
                    {row.name}
                    <em>{row.branch}</em>
                  </span>
                  <strong className="tabular" data-out={row.quantity === 0}>
                    {count(row.quantity)}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Deliveries, requests and stock changes; sales are left to Reports. */}
        <Card title={t('dash.recentActivity')} subtitle={t('dash.recentActivityNote')}>
          <RecentActivities
            items={data.recentActivity.filter((item) => item.kind !== 'SALE')}
            limit={5}
          />
        </Card>
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {/* ---------- Quick actions (phones) ---------- */}
      <section className={styles.quick}>
        <h2 className={styles.quickTitle}>{t('dash.quickActions')}</h2>
        <div className={styles.quickGrid}>
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.to} to={action.to} className={styles.quickItem}>
              <span
                className={`${styles.quickIcon} ${styles[action.tone]}`}
                aria-hidden="true"
              >
                <ActivityIcon name={action.icon} />
              </span>
              {t(action.labelKey)}
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
