import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fastTrack, validLimit, FAST_TRACK_REQUIRED } from '../src/policies.js';

const passing = () => Object.keys(FAST_TRACK_REQUIRED).map((id) => ({ id, label: FAST_TRACK_REQUIRED[id], status: 'pass' }));
const clean = (over = {}) => ({
  amount: 300,
  tier: 'verified',
  checks: [...passing(), { id: 'ai_label', label: 'AI-generation labels', status: 'pass' }, { id: 'web', label: 'Reverse image search', status: 'info' }],
  assessment: { severity: 'minor', low: 200, high: 350 },
  ...over,
});
const policy = { fastTrackLimit: 500 };

test('clean claim under the limit is fast-tracked', () => {
  const r = fastTrack(clean(), policy);
  assert.equal(r.eligible, true);
  assert.deepEqual(r.missing, []);
});

test('amount above the limit goes to an adjuster', () => {
  const r = fastTrack(clean({ amount: 700 }), policy);
  assert.equal(r.eligible, false);
  assert.match(r.missing[0], /above the €500 fast-track limit/);
});

test('limit is inclusive', () => {
  assert.equal(fastTrack(clean({ amount: 500 }), policy).eligible, true);
});

test('fast-track off when the insurer sets no limit', () => {
  assert.equal(fastTrack(clean(), { fastTrackLimit: 0 }).eligible, false);
  assert.equal(fastTrack(clean(), undefined).eligible, false);
});

test('a real selfie (photo does not match the description) is never paid automatically', () => {
  const checks = clean().checks.map((c) => (c.id === 'content' ? { ...c, status: 'fail' } : c));
  const r = fastTrack(clean({ checks, assessment: { severity: 'none', low: 0, high: 0 } }), policy);
  assert.equal(r.eligible, false);
  assert.ok(r.missing.some((m) => m.startsWith('Photo matches description')));
  assert.ok(r.missing.some((m) => m.startsWith('No damage confirmed')));
});

test('a single warning is enough to need a human', () => {
  const checks = clean().checks.map((c) => (c.id === 'amount' ? { ...c, status: 'warn' } : c));
  assert.equal(fastTrack(clean({ checks }), policy).eligible, false);
});

test('checks that did not run count as not passed', () => {
  const checks = clean().checks.map((c) => (c.id === 'content' ? { ...c, status: 'info' } : c));
  assert.match(fastTrack(clean({ checks }), policy).missing.join(), /Photo matches description: not checked/);
  const without = clean().checks.filter((c) => c.id !== 'set');
  assert.match(fastTrack(clean({ checks: without }), policy).missing.join(), /Three-shot capture: not checked/);
});

test('reused photo or uploaded photo is not fast-tracked', () => {
  const checks = clean().checks.map((c) => (c.id === 'reuse' ? { ...c, status: 'fail' } : c));
  assert.equal(fastTrack(clean({ checks }), policy).eligible, false);
  assert.equal(fastTrack(clean({ tier: 'upload' }), policy).eligible, false);
});

test('other failed signals (e.g. AI-generation labels) block fast-track', () => {
  const checks = clean().checks.map((c) => (c.id === 'ai_label' ? { ...c, status: 'fail' } : c));
  assert.match(fastTrack(clean({ checks }), policy).missing.join(), /AI-generation labels: failed/);
});

test('missing AI assessment blocks fast-track', () => {
  assert.equal(fastTrack(clean({ assessment: null }), policy).eligible, false);
});

test('limits are validated', () => {
  assert.equal(validLimit('500'), 500);
  assert.equal(validLimit(0), 0);
  assert.equal(validLimit(-1), null);
  assert.equal(validLimit(5000), null);
  assert.equal(validLimit('abc'), null);
});
