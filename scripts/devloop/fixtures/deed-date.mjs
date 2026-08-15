// Renders a sale date as YYYY-MM. Absent or unparseable input is null, never today.
export function formatSaleDate(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    // An ISO-shaped string already carries its own calendar month; reading it
    // back out avoids a timezone shift for local-time strings like
    // '2024-11-30T20:00:00'.
    const iso = /^(\d{4})-(\d{2})(?:-\d{2})?(?:[T ]|$)/.exec(trimmed);
    if (iso && !Number.isNaN(new Date(trimmed).getTime())) {
      return `${iso[1]}-${iso[2]}`;
    }
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  const year = String(parsed.getUTCFullYear()).padStart(4, '0');
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
