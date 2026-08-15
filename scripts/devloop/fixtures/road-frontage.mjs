// Road frontage display. See road-frontage.test.mjs for the contract.
// Whole feet with a thousands separator. Anything that is not a real measured
// frontage reads as 'Unknown', so a missing measurement can never be presented
// to an operator as a parcel with zero feet of road frontage.
export function frontageLabel(feet) {
  const value = Number(feet);
  if (!Number.isFinite(value) || value <= 0) return 'Unknown';

  const whole = Math.round(value);
  // A frontage that rounds away to nothing is still an absent measurement.
  if (whole <= 0) return 'Unknown';

  const grouped = String(whole).replace(/\B(?=(\d{3})+$)/g, ',');
  return `${grouped} ft`;
}
