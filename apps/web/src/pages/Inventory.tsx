import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { DownloadButton } from '../components/DownloadButton'
import { icons } from '../components/icons'
import { DeleteRowDialog } from '../components/inventory/DeleteRowDialog'
import { EditRowDialog } from '../components/inventory/EditRowDialog'
import { StockInDialog } from '../components/inventory/StockInDialog'
import { Toasts } from '../components/Toasts'
import { UnitDetails } from '../components/inventory/UnitDetails'
import { api } from '../lib/api'
import { useBranchList } from '../lib/branches'
import { useT, type TranslationKey } from '../lib/i18n'
import { usePageSize } from '../lib/prefs'
import { useToasts } from '../lib/toasts'
import { currency, count, shortDate } from '../lib/format'
import {
  LOW_STOCK_THRESHOLD,
  stockStatus,
  type StockStatus,
} from '../lib/stock'
import type {
  InventoryBalance,
  InventorySummary,
  InventoryUnit,
  StockMovement,
} from '../lib/types'
import styles from './Inventory.module.css'

const TABS = [
  { value: 'ALL', labelKey: 'inv.tabAll' },
  { value: 'SERIALIZED', labelKey: 'kind.SERIALIZED' },
  { value: 'QUANTITY', labelKey: 'kind.QUANTITY' },
] as const satisfies readonly { value: string; labelKey: TranslationKey }[]

type TabValue = (typeof TABS)[number]['value']

const CATEGORY_PILL: Record<string, TranslationKey> = {
  SERIALIZED: 'kind.SERIALIZED',
  QUANTITY: 'kind.QUANTITY',
}

const STATUS_FILTERS: {
  value: StockStatus | 'ALL'
  labelKey: TranslationKey
}[] = [
  { value: 'ALL', labelKey: 'inv.allStatus' },
  { value: 'IN_STOCK', labelKey: 'inv.inStock' },
  { value: 'LOW_STOCK', labelKey: 'inv.lowStock' },
  { value: 'OUT_OF_STOCK', labelKey: 'inv.outOfStock' },
]

function Icon({
  name,
  size = 16,
}: {
  name: keyof typeof icons
  size?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
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

type SortKey = 'name' | 'qty' | 'price' | 'value'

function movementTag(move: StockMovement): 'ITEMS_OUT' | 'DAMAGED' | 'LOST' | null {
  const text = move.notes ?? ''
  const match = text.match(/^\[(ITEMS_OUT|DAMAGED|LOST|CORRECTION)\]/)
  if (!match) return null
  if (match[1] === 'ITEMS_OUT' || match[1] === 'DAMAGED' || match[1] === 'LOST') {
    return match[1]
  }
  return null
}

function movementReasonText(move: StockMovement): string {
  return (move.notes ?? '').replace(/^\[[A-Z_]+\]\s*/, '')
}

export default function Inventory() {
  const { user } = useAuth()
  const isSales = user?.role === 'SALES'

  const [summary, setSummary] = useState<InventorySummary | null>(null)
  const [units, setUnits] = useState<InventoryUnit[]>([])
  const [movements, setMovements] = useState<StockMovement[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // Filters
  const [tab, setTab] = useState<TabValue>('ALL')
  const [search, setSearch] = useState('')
  // The Owner looks at one store at a time, the Main Store first; '' means
  // "not picked yet", which falls back to the Main Store below.
  const [branch, setBranch] = useState('')
  const [mainId, setMainId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    api<{ branches: { id: string; isMainStock: boolean }[] }>('/api/branches', { signal: controller.signal })
      .then((payload) => setMainId(payload.branches?.find((row) => row.isMainStock)?.id ?? null))
      .catch(() => {})
    return () => controller.abort()
  }, [])
  const [status, setStatus] = useState<StockStatus | 'ALL'>('ALL')
  const [page, setPage] = useState(1)
  // Click a column head to sort by it; click again to turn it round.
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })

  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [detailsOf, setDetailsOf] = useState<InventoryBalance | null>(null)
  const [editOf, setEditOf] = useState<InventoryBalance | null>(null)
  const [deleteOf, setDeleteOf] = useState<InventoryBalance | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const menuRef = useRef<HTMLDivElement | null>(null)

  const { toasts, push, dismiss } = useToasts()
  const PAGE_SIZE = usePageSize()
  const t = useT()

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const [summaryRes, unitsRes, movementsRes] = await Promise.all([
          // Scoped by the API: a seller sees their own store.
          api<{ summary: InventorySummary }>('/api/inventory/summary', {
            signal: controller.signal,
          }),
          api<{ units: InventoryUnit[] }>('/api/inventory/units', {
            signal: controller.signal,
          }),
          api<{ movements: StockMovement[] }>('/api/inventory/movements', {
            signal: controller.signal,
          }),
        ])

        setSummary(summaryRes.summary)
        setUnits(unitsRes.units ?? [])
        setMovements(movementsRes.movements ?? [])
        setError(null)
      } catch (caught) {
        if (controller.signal.aborted) return
        setError(
          caught instanceof Error ? caught.message : t('inv.loadFailed'),
        )
      }
    }

    void load()

    return () => controller.abort()
  }, [reloadKey, t, isSales])

  // Close the row menu on an outside click.
  useEffect(() => {
    if (!openMenu) return

    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }

    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openMenu])

  // Memoised so the filter/branch derivations below are not recomputed on
  // every render by a fresh empty array.
  const items = useMemo(() => summary?.items ?? [], [summary])

  // Branch list comes from the rows themselves, so it can never offer a branch
  // this viewer is not allowed to see.
  const branchList = useBranchList()
  const branches = useMemo(() => {
    const seen = new Map<string, string>(branchList)
    for (const item of items) seen.set(item.location.id, item.location.name)
    // The Main Store first, then the selling stores A to Z.
    return [...seen.entries()].sort(
      (a, b) => Number(b[0] === mainId) - Number(a[0] === mainId) || a[1].localeCompare(b[1]),
    )
  }, [items, branchList, mainId])

  // IMEI / serial search resolves to the products carrying that unit.
  const serialMatches = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (term.length < 3) return null

    const hits = new Set<string>()

    for (const unit of units) {
      if (unit.serial.toLowerCase().includes(term)) {
        hits.add(`${unit.productId}:${unit.locationId}`)
      }
    }

    return hits
  }, [search, units])

  const isOwner = user?.role === 'OWNER'
  // Never all stores together: the Owner's picked store, else the Main Store.
  // A seller's summary holds only their own store already.
  const store = !isOwner
    ? 'ALL'
    : branches.some(([id]) => id === branch)
      ? branch
      : mainId && branches.some(([id]) => id === mainId)
        ? mainId
        : (branches[0]?.[0] ?? 'ALL')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()

    return items.filter((item) => {
      if (tab !== 'ALL' && item.product.category !== tab) return false
      if (store !== 'ALL' && item.location.id !== store) return false

      if (status !== 'ALL') {
        if (stockStatus(item.product.category, item.quantity) !== status) {
          return false
        }
      }

      if (term) {
        const textHit =
          item.product.name.toLowerCase().includes(term) ||
          item.product.sku.toLowerCase().includes(term)

        const serialHit =
          serialMatches?.has(`${item.productId}:${item.locationId}`) ?? false

        if (!textHit && !serialHit) return false
      }

      return true
    })
  }, [items, tab, store, status, search, serialMatches])

  const sorted = useMemo(() => {
    const valueOf = (item: InventoryBalance) => {
      switch (sort.key) {
        case 'qty':
          return item.quantity
        case 'price':
          return Number(item.product.price ?? 0)
        case 'value':
          return item.quantity * Number(item.product.price ?? 0)
        default:
          return 0
      }
    }

    return [...filtered].sort((a, b) =>
      sort.key === 'name'
        ? sort.dir * a.product.name.localeCompare(b.product.name, undefined, { numeric: true })
        : sort.dir * (valueOf(a) - valueOf(b)) ||
          a.product.name.localeCompare(b.product.name, undefined, { numeric: true }),
    )
  }, [filtered, sort])

  function sortBy(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 1 ? -1 : 1 }
        // Numbers start biggest first; names start A to Z.
        : { key, dir: key === 'name' ? 1 : -1 },
    )
    setPage(1)
  }

  // Each store with what it holds, for the store cards: the Main Store
  // first, then the selling stores in order.
  const storeCards = useMemo(
    () =>
      branches.map(([id, name]) => {
        const rows = items.filter((item) => item.location.id === id)
        return {
          id,
          name,
          isMain: id === mainId,
          units: rows.reduce((sum, item) => sum + item.quantity, 0),
          products: rows.length,
          low: rows.filter((item) => stockStatus(item.product.category, item.quantity) !== 'IN_STOCK').length,
        }
      }),
    [branches, items, mainId],
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = sorted.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  )

  const filtersOn =
    tab !== 'ALL' || status !== 'ALL' || search !== ''

  // Changing any filter returns you to page one, otherwise a narrower result
  // set would leave you stranded on a page that no longer exists.
  function applyTab(value: TabValue) {
    setTab(value)
    setPage(1)
  }

  function applySearch(value: string) {
    setSearch(value)
    setPage(1)
  }

  function applyBranch(value: string) {
    setBranch(value)
    setPage(1)
  }

  function applyStatus(value: StockStatus | 'ALL') {
    setStatus(value)
    setPage(1)
  }

  function resetFilters() {
    setTab('ALL')
    setSearch('')
    setStatus('ALL')
    setPage(1)
  }

  // Export what is on screen.
  const exportName = `inventory-${new Date().toISOString().slice(0, 10)}.csv`
  const exportRows = sorted.length

  function exportCsv() {
    const rows = sorted

    const header = [
      'Product',
      'Category',
      'Store',
      'In stock',
      'Status',
      `Price (ETB)`,
    ]

    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

    const lines = [
      header.join(','),
      ...rows.map((row) =>
        [
          row.product.name,
          row.product.productCategory?.name ??
            (CATEGORY_PILL[row.product.category]
              ? t(CATEGORY_PILL[row.product.category])
              : row.product.category),
          row.location.name,
          String(row.quantity),
          t(
            STATUS_FILTERS.find(
              (s) =>
                s.value === stockStatus(row.product.category, row.quantity),
            )?.labelKey ?? 'inv.inStock',
          ),
          String(Number(row.product.price ?? 0)),
        ]
          .map(escape)
          .join(','),
      ),
    ]

    const blob = new Blob([lines.join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = exportName
    link.click()
    URL.revokeObjectURL(url)

    push('success', t('toast.savedToDownloads', { name: exportName }))
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Card title={t("inv.title")}>
          <Empty>{error}</Empty>
        </Card>
      </div>
    )
  }

  if (!summary) {
    return (
      <div className={styles.page}>
        <div className={styles.tiles}>
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className={styles.skeletonTile} />
          ))}
        </div>
        <div className={styles.skeletonCard} />
      </div>
    )
  }

  // The tiles count the store on screen only, never stores added together.
  const shown = store === 'ALL' ? summary.items : summary.items.filter((item) => item.location.id === store)
  const unitsOf = (kind?: string) =>
    shown.filter((item) => !kind || item.product.category === kind).reduce((sum, item) => sum + item.quantity, 0)

  const stat = [
    {
      key: 'total',
      tone: 'green',
      icon: 'box' as const,
      label: t('inv.onShelf'),
      value: unitsOf(),
    },
    {
      key: 'serialized',
      tone: 'blue',
      icon: 'phone' as const,
      label: t('kind.SERIALIZED'),
      value: unitsOf('SERIALIZED'),
    },
    {
      key: 'quantity',
      tone: 'amber',
      icon: 'box' as const,
      label: t('kind.QUANTITY'),
      value: unitsOf('QUANTITY'),
    },
    {
      key: 'low',
      tone: 'red',
      icon: 'warning' as const,
      label: t('inv.lowStock'),
      value: shown.filter(
        (item) => stockStatus(item.product.category, item.quantity) !== 'IN_STOCK',
      ).length,
    },
  ]

  // The biggest shelf on screen sets the length of every stock bar.
  const maxQty = Math.max(1, ...filtered.map((item) => item.quantity))
  const stockValue = filtered.reduce(
    (sum, item) => sum + item.quantity * Number(item.product.price ?? 0),
    0,
  )

  // A column head that sorts: an arrow shows which way, only on the active one.
  const sortHead = (key: SortKey, label: string, numeric = false) => (
    <th
      scope="col"
      className={numeric ? styles.num : undefined}
      aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className={styles.sortBtn} data-on={sort.key === key ? '' : undefined} onClick={() => sortBy(key)}>
        {label}
        <span className={styles.sortArrow} aria-hidden="true">
          {sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )

  const scopedMovements = movements.filter((move) => {
    if (store === 'ALL') return true
    return move.fromLocation?.id === store || move.toLocation?.id === store
  })

  const itemsOutRows = scopedMovements
    .filter((move) => move.type === 'ADJUSTMENT' && movementTag(move) === 'ITEMS_OUT')
    .slice(0, 40)

  const damageLossRows = scopedMovements
    .filter(
      (move) =>
        move.type === 'ADJUSTMENT' &&
        (movementTag(move) === 'DAMAGED' || movementTag(move) === 'LOST'),
    )
    .slice(0, 40)

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        {/* The shell's header carries the title on desktop, so this only
            appears where that header is hidden. */}
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('inv.title')}</h1>
          <p className={styles.subtitle}>
            {isOwner ? t('inv.noteAll') : t('inv.noteBranch')}
          </p>
        </div>

        <div className={styles.headActions}>
          {isOwner ? (
            <button
              className={styles.primary}
              type="button"
              onClick={() => setAddOpen(true)}
            >
              <Icon name="plus" size={15} />
              {t('inv.add')}
            </button>
          ) : null}
        </div>
      </header>

      {/* One store at a time: the Main Store first, then Store 1, Store 2.
          A seller only ever sees their own store, so no cards for them. */}
      {isOwner && storeCards.length > 0 ? (
        <div className={styles.stores} role="tablist" aria-label={t('inv.branchLabel')}>
          {storeCards.map((card) => (
            <button
              key={card.id}
              type="button"
              role="tab"
              aria-selected={store === card.id}
              className={styles.storeCard}
              data-active={store === card.id ? '' : undefined}
              data-main={card.isMain ? '' : undefined}
              onClick={() => applyBranch(card.id)}
            >
              <span className={styles.storeIcon}>
                <Icon name={card.isMain ? 'box' : 'branch'} size={18} />
              </span>
              <span className={styles.storeText}>
                <span className={styles.storeName}>
                  {card.name}
                  {card.isMain ? <em className={styles.mainBadge}>{t('inv.mainBadge')}</em> : null}
                </span>
                <span className={styles.storeMeta}>
                  <strong className="tabular">{count(card.units)}</strong> {t('inv.unitsWord')}
                  {' · '}
                  {t('inv.nProducts', { n: count(card.products) })}
                </span>
              </span>
              {card.low > 0 ? (
                <span className={styles.storeLow} title={t('inv.lowStock')}>
                  {count(card.low)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.tiles}>
        {stat.map((tile) => (
          <div
            key={tile.key}
            className={styles.tile}
            data-tone={tile.tone}
          >
            <span className={styles.tileIcon}>
              <Icon name={tile.icon} size={19} />
            </span>
            <div>
              <span className={styles.tileLabel}>{tile.label}</span>
              <strong className={`${styles.tileValue} tabular`}>
                {count(tile.value)}
              </strong>
            </div>
          </div>
        ))}
      </div>

      <Card>
        <div className={styles.tabs} role="tablist">
          <div className={styles.tabList}>
            {TABS.map((option) => (
              <button
                key={option.value}
                className={
                  tab === option.value
                    ? `${styles.tab} ${styles.tabActive}`
                    : styles.tab
                }
                type="button"
                role="tab"
                aria-selected={tab === option.value}
                onClick={() => applyTab(option.value)}
              >
                {t(option.labelKey)}
                <span className={styles.tabCount}>
                  {count(
                    shown.filter((item) => option.value === 'ALL' || item.product.category === option.value).length,
                  )}
                </span>
              </button>
            ))}
          </div>

          <DownloadButton
            filename={exportName}
            note={`${exportRows} row${exportRows === 1 ? '' : 's'}`}
            onConfirm={exportCsv}
            className={styles.ghost}
            title="Export what is on screen"
          >
            <Icon name="download" size={15} />
            Export
          </DownloadButton>
        </div>

        <div className={styles.filters}>
          <label className={styles.search}>
            <span className={styles.searchIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
                <circle
                  cx="11"
                  cy="11"
                  r="7"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="m20 20-3.2-3.2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              value={search}
              onChange={(event) => applySearch(event.target.value)}
              placeholder={t("inv.searchPlaceholder")}
              aria-label={t("inv.searchLabel")}
            />
          </label>

          <select
            className={styles.select}
            value={tab}
            onChange={(event) => applyTab(event.target.value as TabValue)}
            aria-label={t("inv.categoryLabel")}
          >
            <option value="ALL">{t("inv.allCategories")}</option>
            <option value="SERIALIZED">{t('kind.SERIALIZED')}</option>
            <option value="QUANTITY">{t('kind.QUANTITY')}</option>
          </select>

          <select
            className={styles.select}
            value={status}
            onChange={(event) =>
              applyStatus(event.target.value as StockStatus | 'ALL')
            }
            aria-label={t("inv.statusFilter")}
          >
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>

          <button
            className={styles.reset}
            type="button"
            onClick={resetFilters}
            disabled={!filtersOn}
          >
            {t('common.reset')}
          </button>
        </div>

        {filtered.length === 0 ? (
          <Empty>
            {items.length === 0
              ? t('inv.noneYet')
              : t('inv.noMatch')}
          </Empty>
        ) : (
          <>
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {sortHead('name', t('inv.product'))}
                    <th scope="col">{t('inv.category')}</th>
                    {sortHead('qty', t('inv.onShelf'))}
                    <th scope="col">{t('common.status')}</th>
                    {sortHead('price', t('inv.price'), true)}
                    {sortHead('value', t('inv.stockValue'), true)}
                    <th scope="col" className={styles.actionsCol}>
                      {t('common.actions')}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((row) => {
                    const state = stockStatus(
                      row.product.category,
                      row.quantity,
                    )
                    const unitCount = units.filter(
                      (unit) =>
                        unit.productId === row.productId &&
                        unit.locationId === row.locationId,
                    ).length

                    return (
                      <tr
                        key={row.id}
                        // Read by the phone layout's ::after to rebuild the
                        // "Store · N in stock" line without extra markup.
                        data-meta={`${row.product.sku} · ${t('inv.nInStock', { n: count(row.quantity) })}`}
                        data-state={state}
                        className={styles.clickableRow}
                        onClick={() => setDetailsOf(row)}
                      >
                        <td data-col="product" data-label={t('inv.product')}>
                          <span className={styles.productCell}>
                            <span className={styles.skuIcon} data-category={row.product.category} aria-hidden="true">
                              <Icon name={row.product.category === 'SERIALIZED' ? 'phone' : 'box'} size={13} />
                            </span>
                            <span className={styles.productText}>
                              <strong>{row.product.name}</strong>
                              <em>{row.product.sku}</em>
                            </span>
                          </span>
                        </td>

                        <td data-col="category" data-label={t('inv.category')}>
                          <span
                            className={styles.pill}
                            data-category={row.product.category}
                          >
                            {row.product.productCategory?.name ??
                              (CATEGORY_PILL[row.product.category]
                                ? t(CATEGORY_PILL[row.product.category])
                                : row.product.category)}
                          </span>
                        </td>

                        <td data-col="qty" data-label={t('inv.onShelf')}>
                          <span className={styles.qtyCell}>
                            <strong className="tabular">{count(row.quantity)}</strong>
                            <span className={styles.bar} data-state={state} aria-hidden="true">
                              <span style={{ width: `${Math.max(4, (row.quantity / maxQty) * 100)}%` }} />
                            </span>
                          </span>
                        </td>

                        <td data-col="status" data-label={t('common.status')}>
                          <span className={styles.status} data-state={state}>
                            {t(
                              STATUS_FILTERS.find((s) => s.value === state)
                                ?.labelKey ?? 'inv.inStock',
                            )}
                          </span>
                        </td>

                        <td data-col="price" data-label={t('inv.price')} className={`${styles.num} tabular`}>
                          {currency(Number(row.product.price ?? 0))}
                        </td>

                        <td data-col="value" data-label={t('inv.stockValue')} className={`${styles.num} ${styles.valueCell} tabular`}>
                          {currency(row.quantity * Number(row.product.price ?? 0))}
                        </td>

                        <td
                          className={styles.actionsCol}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className={styles.menuWrap}>
                            <button
                              className={styles.iconButton}
                              type="button"
                              aria-label={t('a11y.actionsFor', { name: row.product.name })}
                              aria-haspopup="menu"
                              aria-expanded={openMenu === row.id}
                              onClick={() =>
                                setOpenMenu(
                                  openMenu === row.id ? null : row.id,
                                )
                              }
                            >
                              <Icon name="more" size={16} />
                            </button>

                            {openMenu === row.id ? (
                              <div
                                className={styles.menu}
                                role="menu"
                                ref={menuRef}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setDetailsOf(row)
                                    setOpenMenu(null)
                                  }}
                                >
                                  {t('inv.viewDetails')}
                                  {unitCount > 0 ? (
                                    <em>{t('inv.nSerialised', { n: unitCount })}</em>
                                  ) : null}
                                </button>

                                {isOwner ? (
                                  <>
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => {
                                        setEditOf(row)
                                        setOpenMenu(null)
                                      }}
                                    >
                                      {t('inv.editItem')}
                                    </button>

                                    <button
                                      type="button"
                                      role="menuitem"
                                      className={styles.menuDanger}
                                      onClick={() => {
                                        setDeleteOf(row)
                                        setOpenMenu(null)
                                      }}
                                    >
                                      {t('inv.deleteRow')}
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.foot}>
              <span className={styles.showing}>
                Showing {(safePage - 1) * PAGE_SIZE + 1}–
                {Math.min(safePage * PAGE_SIZE, filtered.length)} of{' '}
                {count(filtered.length)} items
              </span>

              <span className={styles.footValue}>
                {t('inv.stockValue')}: <strong className="tabular">{currency(stockValue)}</strong>
              </span>

              {totalPages > 1 ? (
                <nav className={styles.pager} aria-label={t("common.pagination")}>
                  <button
                    type="button"
                    disabled={safePage === 1}
                    onClick={() => setPage(safePage - 1)}
                    aria-label={t("common.prevPage")}
                  >
                    ‹
                  </button>

                  {pageNumbers(safePage, totalPages).map((entry, index) =>
                    entry === '…' ? (
                      <span key={`gap-${index}`} className={styles.gap}>
                        …
                      </span>
                    ) : (
                      <button
                        key={entry}
                        type="button"
                        className={entry === safePage ? styles.pageOn : ''}
                        aria-current={entry === safePage ? 'page' : undefined}
                        onClick={() => setPage(entry)}
                      >
                        {entry}
                      </button>
                    ),
                  )}

                  <button
                    type="button"
                    disabled={safePage === totalPages}
                    onClick={() => setPage(safePage + 1)}
                    aria-label={t("common.nextPage")}
                  >
                    ›
                  </button>
                </nav>
              ) : null}
            </div>
          </>
        )}
      </Card>

      {isOwner ? (
        <div className={styles.auditGrid}>
          <Card>
            <div className={styles.auditHead}>
              <h3>{t('inv.itemsOutTitle')}</h3>
              <span>{count(itemsOutRows.length)}</span>
            </div>
            {itemsOutRows.length === 0 ? (
              <Empty>{t('inv.itemsOutEmpty')}</Empty>
            ) : (
              <div className={styles.scroll}>
                <table className={styles.auditTable}>
                  <thead>
                    <tr>
                      <th scope="col">{t('inv.product')}</th>
                      <th scope="col">{t('common.branch')}</th>
                      <th scope="col">{t('dlg.qty')}</th>
                      <th scope="col">{t('dlg.reason')}</th>
                      <th scope="col">{t('req.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsOutRows.map((move) => (
                      <tr key={move.id}>
                        <td>{move.product.name}</td>
                        <td>{move.fromLocation?.name ?? '—'}</td>
                        <td className="tabular">{count(move.quantity)}</td>
                        <td>{movementReasonText(move) || '—'}</td>
                        <td>{shortDate(move.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <div className={styles.auditHead}>
              <h3>{t('inv.damageLossTitle')}</h3>
              <span>{count(damageLossRows.length)}</span>
            </div>
            {damageLossRows.length === 0 ? (
              <Empty>{t('inv.damageLossEmpty')}</Empty>
            ) : (
              <div className={styles.scroll}>
                <table className={styles.auditTable}>
                  <thead>
                    <tr>
                      <th scope="col">{t('inv.product')}</th>
                      <th scope="col">{t('common.branch')}</th>
                      <th scope="col">{t('dlg.adjustmentKind')}</th>
                      <th scope="col">{t('dlg.qty')}</th>
                      <th scope="col">{t('dlg.reason')}</th>
                      <th scope="col">{t('req.date')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {damageLossRows.map((move) => {
                      const tag = movementTag(move)
                      return (
                        <tr key={move.id}>
                          <td>{move.product.name}</td>
                          <td>{move.fromLocation?.name ?? '—'}</td>
                          <td>
                            {tag === 'DAMAGED'
                              ? t('dlg.adjustmentDamaged')
                              : t('dlg.adjustmentLost')}
                          </td>
                          <td className="tabular">{count(move.quantity)}</td>
                          <td>{movementReasonText(move) || '—'}</td>
                          <td>{shortDate(move.createdAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {detailsOf ? (
        <UnitDetails
          balance={detailsOf}
          units={units.filter(
            (unit) =>
              unit.productId === detailsOf.productId &&
              unit.locationId === detailsOf.locationId,
          )}
          movements={movements.filter(
            (move) => move.productId === detailsOf.productId,
          )}
          threshold={LOW_STOCK_THRESHOLD[detailsOf.product.category] ?? 0}
          onClose={() => setDetailsOf(null)}
        />
      ) : null}

      {editOf ? (
        <EditRowDialog
          balance={editOf}
          onClose={() => setEditOf(null)}
          onDone={(message) => {
            setEditOf(null)
            setReloadKey((n) => n + 1)
            push('success', message)
          }}
        />
      ) : null}

      {deleteOf ? (
        <DeleteRowDialog
          balance={deleteOf}
          onClose={() => setDeleteOf(null)}
          onDone={(message) => {
            setDeleteOf(null)
            setReloadKey((n) => n + 1)
            push('success', message)
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {addOpen ? (
        <StockInDialog
          onClose={() => setAddOpen(false)}
          onDone={(message) => {
            setAddOpen(false)
            setReloadKey((n) => n + 1)
            push('success', message)
          }}
        />
      ) : null}
    </div>
  )
}

// 1 … 4 5 [6] 7 8 … 207
function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }

  const out: (number | '…')[] = [1]
  const from = Math.max(2, current - 1)
  const to = Math.min(total - 1, current + 1)

  if (from > 2) out.push('…')
  for (let n = from; n <= to; n += 1) out.push(n)
  if (to < total - 1) out.push('…')

  out.push(total)
  return out
}
