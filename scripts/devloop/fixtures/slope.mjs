// Slope display. See slope.test.mjs for the contract.
// Percent grade read as operator terrain language: under 5% is 'Flat', under
// 15% is 'Rolling', and anything above that is 'Steep'. Anything that is not a
// real measured grade reads as 'Unknown', so a missing measurement can never be
// presented to an operator as flat, buildable ground.
export function slopeLabel(percent) {
  // Number(null), Number('') and Number(false) are all 0, so an absent grade
  // has to be rejected before the numeric conversion or it would read as Flat.
  const measured =
    typeof percent === 'number' ||
    (typeof percent === 'string' && percent.trim() !== '');
  if (!measured) return 'Unknown';

  const value = Number(percent);
  if (!Number.isFinite(value) || value < 0) return 'Unknown';

  // A measured 0% grade is genuinely flat; only an absent measurement is Unknown.
  if (value < 5) return 'Flat';
  if (value < 15) return 'Rolling';
  return 'Steep';
}
