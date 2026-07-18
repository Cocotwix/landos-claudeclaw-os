// Shared recorded-lien review contract.
//
// A county/state lien index is screening evidence, not a title opinion.  This
// contract keeps the owner UI from turning an owner-name hit (or an empty name
// search) into a property-level or clear-title conclusion.

export const RECORDED_LIEN_STATUSES = [
  'index_hit',
  'parcel_confirmed',
  'released_or_satisfied',
  'no_matching_index_entry',
] as const;

export type RecordedLienStatus = (typeof RECORDED_LIEN_STATUSES)[number];

export interface RecordedLienReviewInput {
  status: RecordedLienStatus;
  sourceLabel: string;
  sourceUrl: string;
  searchedNameOrReference: string;
  recordingReference?: string | null;
  lienType?: string | null;
  propertyMatch?: string | null;
  notes?: string | null;
  confirmedOfficialSource: boolean;
}

const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();

function requireText(value: unknown, label: string): string {
  const result = text(value);
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function officialUrl(value: unknown): string {
  const result = requireText(value, 'Official source URL');
  try {
    const url = new URL(result);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    if (url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    throw new Error('Official source URL must be a valid http(s) URL without embedded credentials.');
  }
}

function statusText(status: RecordedLienStatus): string {
  return {
    index_hit: 'Index hit — owner/debtor match only; property match and release status still require review.',
    parcel_confirmed: 'Potential recorded lien — the supplied recorder entry is matched to this parcel; title review is still required.',
    released_or_satisfied: 'Recorded lien appears released or satisfied in the supplied official record; title review is still required.',
    no_matching_index_entry: 'No matching liens found in the official index search for the searched name/reference. This is not a clear-title or no-lien conclusion.',
  }[status];
}

/** Validate and render the concise owner-facing evidence note saved on every
 * property card.  It deliberately carries no credential, cookie, or raw page
 * image path. */
export function validateRecordedLienReview(input: RecordedLienReviewInput): {
  status: RecordedLienStatus;
  sourceLabel: string;
  sourceUrl: string;
  note: string;
} {
  if (!RECORDED_LIEN_STATUSES.includes(input.status)) throw new Error('Choose a valid recorded-lien review result.');
  if (!input.confirmedOfficialSource) throw new Error('Confirm that the result was displayed by the official recorder or government source.');
  const sourceLabel = requireText(input.sourceLabel, 'Official source label');
  const sourceUrl = officialUrl(input.sourceUrl);
  const searched = requireText(input.searchedNameOrReference, 'Searched owner/debtor name or reference');
  const reference = text(input.recordingReference);
  const lienType = text(input.lienType);
  const propertyMatch = text(input.propertyMatch);
  const notes = text(input.notes);

  if (input.status !== 'no_matching_index_entry' && !reference) {
    throw new Error('Recording reference is required for an index hit, parcel-confirmed lien, or release result.');
  }
  if (input.status === 'parcel_confirmed' && !propertyMatch) {
    throw new Error('Describe the parcel/legal-description match before recording a parcel-confirmed lien.');
  }

  const fields = [
    `Result: ${statusText(input.status)}`,
    `Searched: ${searched}`,
    reference ? `Recording: ${reference}` : '',
    lienType ? `Instrument type: ${lienType}` : '',
    propertyMatch ? `Parcel match: ${propertyMatch}` : '',
    notes ? `Notes: ${notes}` : '',
  ].filter(Boolean);
  return { status: input.status, sourceLabel, sourceUrl, note: fields.join(' ') };
}
