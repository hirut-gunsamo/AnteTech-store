import styles from './SearchBox.module.css'

/**
 * The list pages' search box, as on Sales: it filters what the page already
 * shows as you type and never asks the server.
 */
export function SearchBox({
  value,
  onChange,
  placeholder,
  label,
  alone = false,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label?: string
  /** True when it stands above a list rather than in a filter bar. */
  alone?: boolean
}) {
  return (
    <label className={`${styles.search} ${alone ? styles.alone : ''}`}>
      <span className={styles.icon} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
          <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <input
        type="search"
        className={styles.input}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
      />
    </label>
  )
}
