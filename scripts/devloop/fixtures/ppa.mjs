export function pricePerAcre(price, acres) {
  if (!price || !acres) return null;
  return Math.round(price / acres);
}
