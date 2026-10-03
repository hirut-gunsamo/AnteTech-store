import { useT } from '../../lib/i18n'
import type { Dashboard } from '../../lib/types'
import { Donut } from '../charts/Donut'

/** Stock on hand split by category: the donut from the design. */
export function InventoryByCategory({ data }: { data: Dashboard }) {
  const t = useT()

  const slices = [
    {
      key: 'SERIALIZED',
      label: t('kind.SERIALIZED'),
      value: data.inventoryByCategory.SERIALIZED,
      color: 'var(--series-1)',
    },
    {
      key: 'QUANTITY',
      label: t('kind.QUANTITY'),
      value: data.inventoryByCategory.QUANTITY,
      color: 'var(--series-2)',
    },
  ]

  return <Donut slices={slices} size={150} />
}
