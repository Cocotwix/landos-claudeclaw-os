/** Conservative phone extraction for unstructured lead material.
 *
 * Parcel/APN strings regularly contain a 3-3-4 digit sequence. A telephone
 * number is accepted only when it is explicitly labeled or on a standalone
 * line; a candidate embedded in an APN is always rejected.
 */
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const digits = (value: string): string => value.replace(/\D/g, '');

function apnDigitRuns(raw: string): string[] {
  const labelled = raw.matchAll(/\b(?:apn|parcel[ \t]*(?:id|number)|tax[ \t]*map)\b[ \t]*[:#=-]?[ \t]*([\d .-]{7,80})/gi);
  return [...labelled].map((match) => digits(match[1] ?? '')).filter((value) => value.length >= 7);
}

function safeCandidate(candidate: string, raw: string): string | null {
  const candidateDigits = digits(candidate);
  if (candidateDigits.length !== 10) return null;
  if (apnDigitRuns(raw).some((apn) => apn.includes(candidateDigits))) return null;
  return candidate.trim();
}

export function extractSafePhone(raw: string): string | null {
  const labelled = /\b(?:phone|cell(?:[ \t]*phone)?|mobile|tel(?:ephone)?)\b[ \t]*(?:[:=-][ \t]*)?([^\n,;]+)/ig;
  for (const match of raw.matchAll(labelled)) {
    const candidate = match[1]?.match(PHONE)?.[0];
    const accepted = candidate ? safeCandidate(candidate, raw) : null;
    if (accepted) return accepted;
  }
  for (const line of raw.split(/\r?\n/)) {
    const candidate = line.trim().match(new RegExp(`^${PHONE.source}$`, 'i'))?.[0];
    const accepted = candidate ? safeCandidate(candidate, raw) : null;
    if (accepted) return accepted;
  }
  return null;
}
