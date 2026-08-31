import assert from 'node:assert/strict';
import { createShortsWheelGesture, normalizeWheelDelta } from '../ready/shorts-navigation.js';

assert.equal(normalizeWheelDelta({ deltaY: 2, deltaMode: 1 }, 800), 32, 'line wheel delta should normalize to pixels');
assert.equal(normalizeWheelDelta({ deltaY: 1, deltaMode: 2 }, 700), 700, 'page wheel delta should normalize to viewport pixels');

const safariTrackpad = createShortsWheelGesture({ threshold: 72, releaseGapMs: 320 });
assert.equal(safariTrackpad.push({ delta: 9, atBoundary: true, now: 0 }), 0);
assert.equal(safariTrackpad.push({ delta: 14, atBoundary: true, now: 16 }), 0);
assert.equal(safariTrackpad.push({ delta: 24, atBoundary: true, now: 32 }), 0);
assert.equal(safariTrackpad.push({ delta: 28, atBoundary: true, now: 48 }), 1, 'small Safari deltas should become one next intent');
assert.equal(safariTrackpad.push({ delta: 35, atBoundary: true, now: 64 }), 0, 'momentum must not skip another question');
assert.equal(safariTrackpad.push({ delta: 35, atBoundary: true, now: 120 }), 0, 'momentum remains locked');
assert.equal(safariTrackpad.push({ delta: 80, atBoundary: true, now: 500 }), 1, 'a new gesture after a quiet gap may navigate');

const internalScroll = createShortsWheelGesture();
assert.equal(internalScroll.push({ delta: 100, atBoundary: false, now: 0 }), 0, 'long passage must scroll before navigation');
assert.equal(internalScroll.push({ delta: 40, atBoundary: true, now: 30 }), 0);
assert.equal(internalScroll.push({ delta: 40, atBoundary: true, now: 50 }), 1, 'an additional boundary gesture navigates');

console.log('READY Shorts navigation state machine verified');
