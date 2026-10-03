/**
 * Names and codes are built from the parts rather than typed.
 *
 * There is no reason for a person to invent a code for every storage and
 * colour variant, and hand-typed ones drift: "15 Pro Max" one month,
 * "15 pro max" the next.
 */
export type NameParts = {
  /** The Owner's category name, e.g. "Phones"; its initials start the code. */
  categoryName?: string | null;
  /** Root first: ["iPhone", "15 Pro Max"] or ["Anker"]. */
  typePath: string[];
  /** Typed when the product is created, e.g. "A16" or "20W charger". */
  model?: string | null;
  storage?: string | null;
  color?: string | null;
};

export function buildName(parts: NameParts): string {
  return [...parts.typePath, parts.model, parts.storage, parts.color]
    .filter(Boolean)
    .join(" ");
}

/** Initials of each word, so "15 Pro Max" becomes "15PM". */
function slug(value: string): string {
  const words = value.trim().split(/\s+/);

  if (words.length === 1) {
    return words[0].replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
  }

  return words
    .map((word) => word.replace(/[^A-Za-z0-9]/g, ""))
    .map((word) => (/^\d/.test(word) ? word : word.slice(0, 1)))
    .join("")
    .toUpperCase()
    .slice(0, 8);
}

/** "Phones" -> "PHO", "Smart Watches" -> "SW"; "PR" when there is none. */
function prefixOf(categoryName?: string | null): string {
  const letters = (categoryName ?? "").replace(/[^A-Za-z0-9\s]/g, "").trim();
  if (!letters) return "PR";

  const words = letters.split(/\s+/);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : words[0].slice(0, 3))
    .toUpperCase()
    .slice(0, 4);
}

export function buildSku(parts: NameParts): string {
  const pieces = [
    prefixOf(parts.categoryName),
    ...parts.typePath.map(slug),
    parts.model ? slug(parts.model) : null,
    parts.storage ? slug(parts.storage) : null,
    parts.color ? slug(parts.color) : null,
  ].filter(Boolean);

  return pieces.join("-");
}
