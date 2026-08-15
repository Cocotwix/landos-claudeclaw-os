// Acreage display rounding. See acre-round.test.mjs for the contract.
// Two decimals of precision, trailing zeros dropped, so two sources that agree
// to within a hundredth of an acre render as the same string.
export function roundAcres(acres) {
  const value = Number(acres);
  if (!Number.isFinite(value)) {
    throw new TypeError(`roundAcres expects a finite number, received ${acres}`);
  }
  const fixed = value.toFixed(2);
  const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}
