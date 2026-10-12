// Fast-track: each insurer sets a limit, and a claim at or under it is paid without waiting for an
// adjuster, but only when every check has run and passed. Code decides, never the AI alone: the AI's
// findings are inputs, and a single warning or a missing check sends the claim to a human.
// Everything above the limit, or with any doubt, goes to the adjuster queue as before.

// Starting rules for the demo insurers, until an insurer signs its own (recorded on Solana)
export const DEFAULT_POLICIES = {
  liffey: { fastTrackLimit: 500 },
  harbour: { fastTrackLimit: 250 },
};

export const MAX_FAST_TRACK_LIMIT = 2000;

// Checks that must be present and pass. Together they mean: captured live in a three-shot set by the
// claimant's own device, unedited, never claimed before at any insurer, a real scene, the same object
// in every shot, the photos show what is described, the amount fits the visible damage, and the
// claimant has no recent claims on the registry.
export const FAST_TRACK_REQUIRED = {
  capture: 'Capture record on Solana',
  integrity: 'Unedited since capture',
  fresh: 'Live capture',
  owner: 'Claimant took the photo',
  set: 'Three-shot capture',
  reuse: 'Not claimed before',
  content: 'Photo matches description',
  amount: 'Amount plausible for visible damage',
  medium: 'Real scene, not a screen or print',
  same: 'Same object in every shot',
  history: 'No recent claims from this claimant',
};

const money = (n) => `€${Number(n).toLocaleString('en-IE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

// → { eligible, limit, missing: [reasons it was not fast-tracked] }
export function fastTrack({ amount, tier, checks = [], assessment }, policy) {
  const limit = Number(policy?.fastTrackLimit) || 0;
  const missing = [];
  if (!(limit > 0)) missing.push('Fast-track is switched off for this insurer');
  else if (!(amount <= limit)) missing.push(`${money(amount)} is above the ${money(limit)} fast-track limit`);
  if (tier !== 'verified') missing.push('Photo was not captured live in FraudBusters');

  const byId = new Map(checks.map((c) => [c.id, c]));
  for (const [id, label] of Object.entries(FAST_TRACK_REQUIRED)) {
    const c = byId.get(id);
    if (!c || c.status === 'info') missing.push(`${label}: not checked`);
    else if (c.status !== 'pass') missing.push(`${label}: ${c.status === 'fail' ? 'failed' : 'warning'}`);
  }
  // Any other warning or failure (e.g. AI-generation labels) also needs a human
  for (const c of checks) {
    if (!FAST_TRACK_REQUIRED[c.id] && (c.status === 'fail' || c.status === 'warn')) {
      missing.push(`${c.label}: ${c.status === 'fail' ? 'failed' : 'warning'}`);
    }
  }
  if (!assessment || assessment.severity === 'none') missing.push('No damage confirmed by the photo assessment');

  return { eligible: missing.length === 0, limit, missing };
}

export function validLimit(n) {
  const v = Math.round(Number(n) * 100) / 100;
  return Number.isFinite(v) && v >= 0 && v <= MAX_FAST_TRACK_LIMIT ? v : null;
}
