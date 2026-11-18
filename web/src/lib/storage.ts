// Small wrappers around localStorage that never throw (private mode, blocked storage).
import type { Variant } from '@mbq/shared';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function stable(key: string, make: () => string): string {
  try {
    let v = localStorage.getItem(key);
    if (!v) { v = make(); localStorage.setItem(key, v); }
    return v;
  } catch {
    return make();
  }
}

/** Anonymous id for this browser. Lets the API tie a student's own saves together without an account. */
export const clientId = stable('mbq-client', () => crypto.randomUUID());

/** A/B variant for the quiz (A = one question per page, B = chat). Assigned once per browser; ?v=A or ?v=B overrides. */
export const variant: Variant = (() => {
  const forced = new URLSearchParams(location.search).get('v');
  if (forced === 'A' || forced === 'B') { try { localStorage.setItem('mbq-variant', forced); } catch { /* ignore */ } return forced; }
  return stable('mbq-variant', () => (Math.random() < 0.5 ? 'A' : 'B')) as Variant;
})();
