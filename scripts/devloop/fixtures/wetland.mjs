// Wetland coverage display. See wetland.test.mjs for the contract.
// Coverage arrives as a fraction of the parcel and reads back as a whole
// percent. A mapped parcel with no wetland is 'None mapped'; a parcel that was
// never mapped is 'Not mapped', so an absent survey can never be presented to
// an operator as clean, dry ground.
export function wetlandLabel(fraction) {
  // Number(null), Number('') and Number(false) are all 0, so an absent coverage
  // has to be rejected before the numeric conversion or it would read as
  // 'None mapped'.
  const mapped =
    typeof fraction === 'number' ||
    (typeof fraction === 'string' && fraction.trim() !== '');
  if (!mapped) return 'Not mapped';

  const value = Number(fraction);
  if (!Number.isFinite(value) || value < 0) return 'Not mapped';

  // A mapped 0 is genuinely dry; only an absent survey is 'Not mapped'.
  if (value === 0) return 'None mapped';
  return `${Math.round(value * 100)}% wetland`;
}
