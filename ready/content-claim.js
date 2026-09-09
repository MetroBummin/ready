export function gradeContentClaim(truth, choice) {
  if (choice !== 'O' && choice !== 'X') return { valid: false, correct: false };
  return { valid: true, correct: (choice === 'O') === (truth === true) };
}

export function contentClaimEvidence(item) {
  return Array.isArray(item?.evidence) ? item.evidence.filter(row => row && row.text) : [];
}
