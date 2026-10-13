import { useEffect, useState } from 'react'

import { Card, Empty } from '../components/Card'
import { SearchBox } from '../components/SearchBox'
import { TypeDialog } from '../components/products/TypeDialog'
import { Toasts } from '../components/Toasts'
import { api } from '../lib/api'
import { useCategories } from '../lib/categories'
import { useT } from '../lib/i18n'
import { matches } from '../lib/search'
import { useToasts } from '../lib/toasts'
import type { TypeNode } from '../lib/types'
import base from './Products.module.css'
import styles from './Ledger.module.css'


/**
 * The types products are filed under: brands and their models for serialized
 * goods (Samsung → Galaxy A15), brands or kinds for counted goods (Oraimo,
 * Chargers). Adding and removing them lives here, one step before the products
 * themselves.
 */
export default function ProductTypes() {
  const t = useT()
  const { toasts, push, dismiss } = useToasts()

  const [types, setTypes] = useState<TypeNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [adding, setAdding] = useState<string | null>(null)
  const { categories } = useCategories()

  useEffect(() => {
    const controller = new AbortController()

    api<{ types: TypeNode[] }>('/api/product-types', { signal: controller.signal })
      .then((payload) => {
        setTypes(payload.types ?? [])
        setError(null)
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Could not load.')
        setTypes([])
      })

    return () => controller.abort()
  }, [reloadKey])

  // Renaming in place: the row turns into a box with Save and Cancel.
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null)
  const [savingName, setSavingName] = useState(false)

  async function rename() {
    if (!editing || savingName) return
    const name = editing.draft.trim()
    if (!name) return
    setSavingName(true)
    try {
      await api(`/api/product-types/${editing.id}`, { method: 'PATCH', body: { name } })
      push('success', t('types.renamed', { name }))
      setEditing(null)
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    } finally {
      setSavingName(false)
    }
  }

  const nameOf = (node: TypeNode) =>
    editing?.id === node.id ? (
      <input
        className={styles.renameInput}
        value={editing.draft}
        onChange={(event) => setEditing({ id: node.id, draft: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void rename()
          if (event.key === 'Escape') setEditing(null)
        }}
        maxLength={80}
        autoFocus
        aria-label={t('prod.typeName')}
      />
    ) : (
      node.name
    )

  const actionsOf = (node: TypeNode) =>
    editing?.id === node.id ? (
      <span className={styles.rowActions}>
        <button type="button" className={styles.edit} onClick={() => void rename()} disabled={savingName}>
          {t('common.save')}
        </button>
        <button type="button" className={styles.edit} onClick={() => setEditing(null)}>
          {t('common.cancel')}
        </button>
      </span>
    ) : (
      <span className={styles.rowActions}>
        <button type="button" className={styles.edit} onClick={() => setEditing({ id: node.id, draft: node.name })}>
          {t('prod.edit')}
        </button>
        <button type="button" className={styles.remove} onClick={() => void remove(node)}>
          {t('prod.delete')}
        </button>
      </span>
    )

  async function remove(node: TypeNode) {
    if (!window.confirm(t('prod.deleteTypeConfirm', { name: node.name }))) return

    try {
      await api(`/api/product-types/${node.id}`, { method: 'DELETE' })
      push('success', t('types.deleted', { name: node.name }))
      setReloadKey((n) => n + 1)
    } catch (caught) {
      push('error', caught instanceof Error ? caught.message : 'Failed.')
    }
  }

  const [search, setSearch] = useState('')
  const active = (list: TypeNode[]) => list.filter((node) => node.isActive)
  // A brand that matches keeps all its models; otherwise only matching models.
  const childrenOf = (root: TypeNode) =>
    matches(search, root.name)
      ? active(root.children)
      : active(root.children).filter((child) => matches(search, root.name, child.name))

  return (
    <div className={base.page}>
      <header className={base.head}>
        <div className={base.mobileHeading}>
          <h1 className={base.title}>{t('types.title')}</h1>
          <p className={base.subtitle}>{t('types.note')}</p>
        </div>
        <div className={base.headActions}>
          <button type="button" className={base.primary} onClick={() => setAdding(categories[0]?.id ?? '')}>
            + {t('prod.addType')}
          </button>
        </div>
      </header>

      <SearchBox alone value={search} onChange={setSearch} placeholder={t('types.searchPlaceholder')} />

      {error ? <Empty>{error}</Empty> : null}

      {categories.map((category) => {
        // Serialized goods go brand -> model; counted goods stay one level.
        const isPhone = category.kind === 'SERIALIZED'
        const roots = active((types ?? []).filter((node) => node.categoryId === category.id)).filter(
          (root) => matches(search, root.name) || childrenOf(root).length > 0,
        )

        return (
          <Card key={category.id}>
            <div className={styles.filters}>
              <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
                {category.name}
              </h2>
              <button
                type="button"
                className={base.secondary}
                style={{ marginLeft: 'auto' }}
                onClick={() => setAdding(category.id)}
              >
                + {t('prod.addType')}
              </button>
            </div>

            {types === null ? (
              <Empty>{t('common.loading')}</Empty>
            ) : roots.length === 0 ? (
              <Empty>{search ? t('common.noMatch') : t('prod.noTypes')}</Empty>
            ) : (
              <div className={base.scroll}>
                <table className={base.table}>
                  <thead>
                    <tr>
                      <th scope="col">
                        {t(isPhone ? 'prod.brand' : 'prod.typeName')}
                      </th>
                      {isPhone ? <th scope="col">{t('prod.typeName')}</th> : null}
                      <th scope="col" className={base.actionsCol}>
                        {t('common.actions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {roots.flatMap((root) => {
                      const children = childrenOf(root)

                      if (!isPhone || children.length === 0) {
                        return [
                          <tr key={root.id}>
                            <td className={base.strong} data-label={t('prod.typeName')}>
                              {nameOf(root)}
                            </td>
                            {isPhone ? <td>—</td> : null}
                            <td className={base.actionsCol}>{actionsOf(root)}</td>
                          </tr>,
                        ]
                      }

                      return children.map((child, index) => (
                        <tr key={child.id}>
                          <td className={base.strong} data-label={t('prod.brand')}>
                            {index === 0 ? nameOf(root) : ''}
                          </td>
                          <td data-label={t('prod.typeName')}>{nameOf(child)}</td>
                          <td className={base.actionsCol}>
                            {index === 0 ? actionsOf(root) : null}
                            {actionsOf(child)}
                          </td>
                        </tr>
                      ))
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )
      })}

      {adding ? (
        <TypeDialog
          categoryId={adding}
          onClose={() => setAdding(null)}
          onDone={(type) => {
            setAdding(null)
            push('success', t('prod.typeSaved', { name: type.name }))
            setReloadKey((n) => n + 1)
          }}
        />
      ) : null}

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
