import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import type { ProductRow } from '../../lib/types'
import styles from '../inventory/Panel.module.css'

/**
 * Changes what describes a product: its name, price and details.
 *
 * The category, type and code are not offered. Stock, requests and sales are
 * all counted against them, so a product that is really something else is
 * deleted and added again instead.
 */
export function EditProductDialog({
  product,
  onClose,
  onDone,
}: {
  product: ProductRow
  onClose: () => void
  onDone: (product: ProductRow) => void
}) {
  const t = useT()

  const isPhone = product.category === 'SERIALIZED'

  const [name, setName] = useState(product.name)
  const [price, setPrice] = useState(product.price == null ? '' : String(Number(product.price)))
  const [costPrice, setCostPrice] = useState(
    product.costPrice == null ? '' : String(Number(product.costPrice)),
  )
  const [phoneModel, setPhoneModel] = useState(product.phoneDetails?.model ?? '')
  const [storage, setStorage] = useState(product.phoneDetails?.storage ?? '')
  const [color, setColor] = useState(product.phoneDetails?.color ?? '')
  const [description, setDescription] = useState(product.description ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const priceValue = Number(price)

  const valid =
    name.trim().length >= 2 &&
    (price.trim() === '' || (Number.isFinite(priceValue) && priceValue >= 0)) &&
    (costPrice.trim() === '' || (Number.isFinite(Number(costPrice)) && Number(costPrice) >= 0))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid || busy) return

    setBusy(true)
    setError(null)

    // Blank optional fields are sent as null so a value can be cleared.
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      // Blank clears the suggested price: sellers enter the real one.
      price: price.trim() === '' ? null : priceValue,
      // Blank clears a buying price typed by mistake.
      costPrice: costPrice.trim() === '' ? null : Number(costPrice),
      ...(isPhone
        ? {
            model: phoneModel.trim() || undefined,
            storage: storage.trim() || null,
            color: color.trim() || null,
          }
        : {}),
    }

    try {
      const payload = await api<{ product: ProductRow }>(
        `/api/products/${product.id}`,
        { method: 'PATCH', body },
      )

      onDone(payload.product)
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
        aria-label={t('prod.editTitle')}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2>{t('prod.editTitle')}</h2>
            <p className="tabular">
              {product.sku}
              {product.type ? ` · ${product.type.name}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit}>
          <p className={styles.warn}>{t('prod.editNote')}</p>

          <label className={styles.field}>
            <span>
              {t('prod.name')}<em>{t('common.required')}</em>
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={150}
              required
              autoFocus
            />
          </label>

          <label className={styles.field}>
            <span>
              {t('prod.price')}
              <em>{t('prod.optional')}</em>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>
              {t('prod.costPrice')}<em>{t('prod.optional')}</em>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={costPrice}
              onChange={(event) => setCostPrice(event.target.value)}
            />
            <small className={styles.hint}>{t('prod.costPriceNote')}</small>
          </label>


          {isPhone ? (
            <>
              <label className={styles.field}>
                <span>
                  {t('prod.model')}<em>{t('prod.optional')}</em>
                </span>
                <input
                  value={phoneModel}
                  onChange={(event) => setPhoneModel(event.target.value)}
                  maxLength={80}
                />
              </label>

              <label className={styles.field}>
                <span>
                  {t('prod.storage')}<em>{t('prod.optional')}</em>
                </span>
                <input
                  value={storage}
                  onChange={(event) => setStorage(event.target.value)}
                  maxLength={40}
                />
              </label>

              <label className={styles.field}>
                <span>
                  {t('prod.color')}<em>{t('prod.optional')}</em>
                </span>
                <input
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  maxLength={40}
                />
              </label>
            </>
          ) : null}

          <label className={styles.field}>
            <span>
              {t('prod.description')}<em>{t('prod.descriptionNote')}</em>
            </span>
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
            />
          </label>

          {error ? <p className={styles.error}>{error}</p> : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancel} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className={styles.submit}
              disabled={!valid || busy}
            >
              {busy ? t('prod.saving') : t('prod.saveChanges')}
            </button>
          </div>
        </form>
      </aside>
    </div>
  )
}
