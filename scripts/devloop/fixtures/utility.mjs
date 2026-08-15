// Utility presence display. See utility.test.mjs for the contract.
// A researched utility record reads as the utilities that are present, in a
// fixed order: 'Power', 'Water', or 'Power, Water'. A record that was researched
// and found nothing reads as 'None at road'.
//
// No record at all reads as 'Not researched': absent evidence is not evidence of
// absence, so a property nobody has checked can never be presented to an
// operator as one that was checked and has no utilities.
const UTILITIES = [
  ['power', 'Power'],
  ['water', 'Water'],
];

export function utilityLabel(utilities) {
  // typeof null is 'object', so the absent record has to be rejected explicitly
  // or it would fall through and read as 'None at road'.
  if (utilities === null || typeof utilities !== 'object') return 'Not researched';

  const present = UTILITIES.filter(([key]) => utilities[key]).map(([, label]) => label);
  if (present.length === 0) return 'None at road';
  return present.join(', ');
}
