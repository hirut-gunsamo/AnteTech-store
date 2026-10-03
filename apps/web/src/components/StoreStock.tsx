import { Empty } from './Card'
import { CATEGORY_KEY, count, currency } from '../lib/format'
import { useT } from '../lib/i18n'
import type { Dashboard } from '../lib/types'
import styles from './StoreStock.module.css'

// The order the kinds read across the table: devices, then accessories.
const KINDS = ['SERIALIZED', 'QUANTITY'] as const

/**
 * Every store in one row: who works there and what is on its shelves now.
 *
 * Stock only. Sales, customers and revenue are the Reports page's business;
 * the Owner's dashboard is about what is where.
 */
export function StoreStock({ data }: { data: Dashboard }) {
  const t = useT()

  // Staff counts ride along with the stores' trading figures.
  const staff = new Map(data.branchActivity.map((row) => [row.id, row.staff]))

  const rows = data.stock.branches
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      staff: staff.get(branch.id) ?? 0,
      byKind: KINDS.map((kind) => branch.byCategory?.[kind]?.quantity ?? 0),
      units: branch.totalUnits,
      value: branch.stockValue,
    }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name))

  if (rows.length === 0) {
    return <Empty>{t('dash.noBranchData')}</Empty>
  }

  const totals = rows.reduce(
    (sum, row) => ({
      staff: sum.staff + row.staff,
      byKind: sum.byKind.map((n, i) => n + row.byKind[i]),
      units: sum.units + row.units,
      value: sum.value + row.value,
    }),
    { staff: 0, byKind: KINDS.map(() => 0), units: 0, value: 0 },
  )

  const kindName = (kind: (typeof KINDS)[number]) =>
    CATEGORY_KEY[kind] ? t(CATEGORY_KEY[kind]) : kind

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">{t('dash.branch')}</th>
            <th className={styles.num} scope="col">
              {t('dash.salesStaff')}
            </th>
            {KINDS.map((kind) => (
              <th key={kind} className={styles.num} scope="col">
                {kindName(kind)}
              </th>
            ))}
            <th className={styles.num} scope="col">
              {t('dash.stockLeft')}
            </th>
            <th className={styles.num} scope="col">
              {t('dash.stockValue')}
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td data-label={t('dash.branch')} className={styles.nameCell}>
                <span className={styles.name}>
                  {row.name}
                  {row.units === 0 ? (
                    <i className={styles.badgeWarn}>{t('dash.noStock')}</i>
                  ) : null}
                </span>
              </td>
              <td
                data-label={t('dash.salesStaff')}
                className={`${styles.num} tabular ${styles.dim}`}
              >
                {count(row.staff)}
              </td>
              {KINDS.map((kind, i) => (
                <td
                  key={kind}
                  data-label={kindName(kind)}
                  className={`${styles.num} tabular ${styles.dim}`}
                >
                  {count(row.byKind[i])}
                </td>
              ))}
              <td
                data-label={t('dash.stockLeft')}
                className={`${styles.num} tabular ${styles.strong}`}
              >
                {count(row.units)}
              </td>
              <td
                data-label={t('dash.stockValue')}
                className={`${styles.num} tabular ${styles.strong}`}
              >
                {currency(row.value)}
              </td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr>
            <td data-label={t('dash.branch')} className={styles.nameCell}>
              {t('dash.allBranchesRow')}
            </td>
            <td data-label={t('dash.salesStaff')} className={`${styles.num} tabular`}>
              {count(totals.staff)}
            </td>
            {KINDS.map((kind, i) => (
              <td key={kind} data-label={kindName(kind)} className={`${styles.num} tabular`}>
                {count(totals.byKind[i])}
              </td>
            ))}
            <td data-label={t('dash.stockLeft')} className={`${styles.num} tabular`}>
              {count(totals.units)}
            </td>
            <td data-label={t('dash.stockValue')} className={`${styles.num} tabular`}>
              {currency(totals.value)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
