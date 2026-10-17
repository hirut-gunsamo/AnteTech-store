import { useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '../auth/context'
import { Card, Empty } from '../components/Card'
import { SearchBox } from '../components/SearchBox'
import { icons } from '../components/icons'
import { DeleteProductDialog } from '../components/products/DeleteProductDialog'
import { EditProductDialog } from '../components/products/EditProductDialog'
import { ProductDialog } from '../components/products/ProductDialog'
import { TypeDialog } from '../components/products/TypeDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { count, currency } from '../lib/format'
import { useCategories } from '../lib/categories'
import { useT } from '../lib/i18n'
import { matches } from '../lib/search'
import { useToasts } from '../lib/toasts'
import type { ProductRow } from '../lib/types'
import styles from './Products.module.css'

/**
 * The catalogue: what the business sells.
 *
 * Distinct from Inventory, which counts how many of each of these a branch is
 * holding. Nothing can be taken into stock until it exists here, so on a new
 * installation this is the first page the Owner needs.
 *
 * Deleting one that past sales point at only takes it out of the catalogue;
 * the API keeps the row so that history stays readable.
 */
export default function Products() {
  const { user } = useAuth()
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const isOwner = user?.role === 'OWNER'

  const [products, setProducts] = useState<ProductRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [addingType, setAddingType] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [editOf, setEditOf] = useState<ProductRow | null>(null)
  const [deleteOf, setDeleteOf] = useState<ProductRow | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const [category, setCategory] = useState('ALL')
  const [search, setSearch] = useState('')
  // One tab per category the Owner has, after All.
  const { categories } = useCategories()
  const tabs = [{ value: 'ALL', label: t('inv.tabAll') }, ...categories.map((entry) => ({ value: entry.id, label: entry.name }))]

  useEffect(() => {
    const controller = new AbortController()

    api<{ products: ProductRow[] }>('/api/products', {
      signal: controller.signal,
    })
      .then((payload) => {
        setProducts(payload.products ?? [])
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load.')
        setProducts([])
      })

    return () => controller.abort()
  }, [reloadKey])

  // Close the row menu on an outside click.
  useEffect(() => {
    if (!openMenu) return

    function onDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }

    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openMenu])

  const rows = useMemo(
    () =>
      (products ?? []).filter(
        (product) =>
          (category === 'ALL' || product.categoryId === category) &&
          matches(search, product.name, product.sku, product.productCategory?.name, product.type?.name),
      ),
    [products, category, search],
  )

  // Only phones have a brand; for an accessory it would repeat the name.
  const showBrand = rows.some((product) => product.category === 'SERIALIZED')

  const heldOf = (product: ProductRow) =>
    product.inventoryBalances.reduce((sum, balance) => sum + balance.quantity, 0)

  const priceOf = (product: ProductRow) => (product.price == null ? null : Number(product.price))
  const costOf = (product: ProductRow) => (product.costPrice == null ? null : Number(product.costPrice))

  const totals = {
    all: (products ?? []).length,
    units: (products ?? []).reduce((sum, product) => sum + heldOf(product), 0),
    value: (products ?? []).reduce((sum, product) => sum + heldOf(product) * (priceOf(product) ?? 0), 0),
  }

  // How many products each tab holds, so a tab says what is behind it.
  const tabCount = (value: string) =>
    (products ?? []).filter((product) => value === 'ALL' || product.categoryId === value).length

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div className={styles.mobileHeading}>
          <h1 className={styles.title}>{t('prod.title')}</h1>
          <p className={styles.subtitle}>{t('prod.note')}</p>
        </div>

        {isOwner ? (
          <div className={styles.headActions}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => setAdding(true)}
            >
              + {t('prod.add')}
            </button>
          </div>
        ) : null}
      </header>

      <div className={styles.totals}>
        <div data-tone="blue">
          <span>{t('prod.totalProducts')}</span>
          <strong className="tabular">{count(totals.all)}</strong>
        </div>
        <div data-tone="green">
          <span>{t('prod.totalUnits')}</span>
          <strong className="tabular">{count(totals.units)}</strong>
        </div>
        <div data-tone="amber">
          <span>{t('inv.stockValue')}</span>
          <strong className="tabular">{currency(totals.value)}</strong>
        </div>
      </div>

      <Card>
        <div className={styles.tabs} role="tablist">
          <div className={styles.tabList}>
            {tabs.map((option) => (
              <button
                key={option.value}
                className={
                  category === option.value
                    ? `${styles.tab} ${styles.tabActive}`
                    : styles.tab
                }
                type="button"
                role="tab"
                aria-selected={category === option.value}
                onClick={() => setCategory(option.value)}
              >
                {option.label}
                <span className={styles.tabCount}>{count(tabCount(option.value))}</span>
              </button>
            ))}
          </div>
        </div>

        <SearchBox alone value={search} onChange={setSearch} placeholder={t('prod.searchPlaceholder')} />

        {error ? <Empty>{error}</Empty> : null}

        {products === null ? (
          <Empty>{t('common.loading')}</Empty>
        ) : rows.length === 0 ? (
          <Empty>{search ? t('common.noMatch') : t('prod.none')}</Empty>
        ) : (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{t('inv.product')}</th>
                  <th scope="col" data-col="category">{t('prod.category')}</th>
                  {showBrand ? <th scope="col" data-col="brand">{t('prod.brand')}</th> : null}
                  <th scope="col" data-col="price" className={styles.num}>{t('prod.priceShort')}</th>
                  <th scope="col" data-col="cost" className={styles.num}>{t('prod.costPrice')}</th>
                  <th scope="col" data-col="margin" className={styles.num}>{t('prod.margin')}</th>
                  <th scope="col" data-col="stock" className={styles.num}>{t('prod.inStock')}</th>
                  {isOwner ? (
                    <th scope="col" className={styles.actionsCol}>
                      {t('common.actions')}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((product) => {
                  const held = heldOf(product)
                  const price = priceOf(product)
                  const cost = costOf(product)
                  const margin = price != null && cost != null ? price - cost : null

                  return (
                    <tr key={product.id}>
                      <td data-col="product" data-label={t('inv.product')}>
                        <span className={styles.nameLine}>
                          <strong>{product.name}</strong>
                          {product.type?.name ? <em>{product.type.name}</em> : null}
                        </span>
                      </td>
                      <td data-col="category" data-label={t('prod.category')}>
                        <span className={styles.pill} data-kind={product.category}>
                          {product.productCategory?.name ?? '—'}
                        </span>
                      </td>
                      {showBrand ? (
                        <td data-col="brand" data-label={t('prod.brand')}>
                          {product.category === 'SERIALIZED' ? product.phoneDetails?.brand || '—' : '—'}
                        </td>
                      ) : null}
                      <td data-col="price" data-label={t('prod.priceShort')} className={`${styles.num} ${styles.price} tabular`}>
                        {price == null ? '—' : currency(price)}
                      </td>
                      <td data-col="cost" data-label={t('prod.costPrice')} className={`${styles.num} tabular`}>
                        {cost == null ? '—' : currency(cost)}
                      </td>
                      <td data-col="margin" data-label={t('prod.margin')} className={`${styles.num} tabular`}>
                        {margin == null ? (
                          '—'
                        ) : (
                          <span className={styles.margin} data-bad={margin < 0 ? '' : undefined}>
                            {margin > 0 ? '+' : ''}
                            {currency(margin)}
                          </span>
                        )}
                      </td>
                      <td data-col="stock" data-label={t('prod.inStock')} className={styles.num}>
                        <span className={`${styles.stock} tabular`} data-empty={held === 0 ? '' : undefined}>
                          {count(held)}
                        </span>
                      </td>
                      {isOwner ? (
                        <td className={styles.actionsCol}>
                          <div className={styles.menuWrap}>
                            <button
                              className={styles.iconButton}
                              type="button"
                              aria-label={t('a11y.actionsFor', { name: product.name })}
                              aria-haspopup="menu"
                              aria-expanded={openMenu === product.id}
                              onClick={() =>
                                setOpenMenu(
                                  openMenu === product.id ? null : product.id,
                                )
                              }
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width={16}
                                height={16}
                                fill="none"
                                stroke="currentColor"
                                strokeLinecap="round"
                                aria-hidden="true"
                              >
                                {icons.more.map((d, index) => (
                                  <path key={index} d={d} />
                                ))}
                              </svg>
                            </button>

                            {openMenu === product.id ? (
                              <div
                                className={styles.menu}
                                role="menu"
                                ref={menuRef}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setEditOf(product)
                                    setOpenMenu(null)
                                  }}
                                >
                                  {t('prod.edit')}
                                </button>

                                <button
                                  type="button"
                                  role="menuitem"
                                  className={styles.menuDanger}
                                  onClick={() => {
                                    setDeleteOf(product)
                                    setOpenMenu(null)
                                  }}
                                >
                                  {t('prod.delete')}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adding ? (
        <ProductDialog
          onClose={() => setAdding(false)}
          onDone={(product) => {
            setAdding(false)
            push('success', t('prod.saved', { name: product.name }))
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {editOf ? (
        <EditProductDialog
          product={editOf}
          onClose={() => setEditOf(null)}
          onDone={(product) => {
            setEditOf(null)
            push('success', t('prod.updated', { name: product.name }))
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {deleteOf ? (
        <DeleteProductDialog
          product={deleteOf}
          onClose={() => setDeleteOf(null)}
          onDone={() => {
            push('success', t('prod.deleted', { name: deleteOf.name }))
            setDeleteOf(null)
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      {addingType ? (
        <TypeDialog
          categoryId={category === 'ALL' ? (categories[0]?.id ?? '') : category}
          onClose={() => setAddingType(false)}
          onDone={(type) => {
            setAddingType(false)
            push('success', t('prod.typeSaved', { name: type.name }))
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
