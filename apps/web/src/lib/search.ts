/**
 * Whether a row matches what was typed: every word of the search must
 * appear in one of the fields, ignoring case. An empty search matches all.
 */
export function matches(term: string, ...fields: (string | number | null | undefined)[]): boolean {
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = fields
    .filter((field) => field !== null && field !== undefined)
    .join(' ')
    .toLowerCase()
  return words.every((word) => text.includes(word))
}
