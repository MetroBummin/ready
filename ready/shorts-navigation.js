const PIXELS_PER_LINE = 16;

export function normalizeWheelDelta(event, viewportHeight = 800) {
  const raw = Number(event?.deltaY) || 0;
  const mode = Number(event?.deltaMode) || 0;
  const scaled = mode === 1 ? raw * PIXELS_PER_LINE : mode === 2 ? raw * viewportHeight : raw;
  return Math.max(-viewportHeight, Math.min(viewportHeight, scaled));
}

// One physical wheel/trackpad gesture may contain many small momentum events,
// especially in Safari. Accumulate them into one navigation intent, then stay
// locked until the event stream has been quiet long enough to be a new gesture.
export function createShortsWheelGesture({ threshold = 72, releaseGapMs = 320 } = {}) {
  let direction = 0;
  let accumulated = 0;
  let lastAt = 0;
  let locked = false;

  function reset() {
    direction = 0;
    accumulated = 0;
    lastAt = 0;
    locked = false;
  }

  function push({ delta, atBoundary, now = Date.now() }) {
    if (!Number.isFinite(delta) || delta === 0) return 0;

    if (locked) {
      if (now - lastAt <= releaseGapMs) {
        lastAt = now;
        return 0;
      }
      direction = 0;
      accumulated = 0;
      locked = false;
    }

    if (!atBoundary) {
      direction = 0;
      accumulated = 0;
      lastAt = now;
      return 0;
    }

    const nextDirection = delta > 0 ? 1 : -1;
    if (direction !== nextDirection || (lastAt && now - lastAt > releaseGapMs)) {
      direction = nextDirection;
      accumulated = 0;
    }
    accumulated += Math.abs(delta);
    lastAt = now;
    if (accumulated < threshold) return 0;

    locked = true;
    accumulated = 0;
    direction = 0;
    return nextDirection;
  }

  return { push, reset };
}
