export const QUESTION_PAGE_SWIPE_MIN = 72;
export const QUESTION_PAGE_SWIPE_RATIO = 1.35;

export function questionPageDirection(dx, dy, { cancelled = false, axis = 'x' } = {}) {
  if (cancelled || axis !== 'x' || Math.abs(dx) < QUESTION_PAGE_SWIPE_MIN) return 0;
  if (Math.abs(dx) <= Math.abs(dy) * QUESTION_PAGE_SWIPE_RATIO) return 0;
  return dx < 0 ? 1 : -1;
}
