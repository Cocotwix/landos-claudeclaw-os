/**
 * Compact a county APN to a comparable identifier: drop surrounding whitespace,
 * every separator a county may use for display (dashes, spaces, dots and the
 * like), and case. Leading zeros are part of the identifier here and are kept.
 *
 * Returns null when there is nothing left to compare on, so an unusable APN can
 * never read as an empty-but-present identifier.
 */
export function normalizeApn(raw) {
  if (typeof raw !== 'string') return null;
  const compacted = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return compacted === '' ? null : compacted;
}
