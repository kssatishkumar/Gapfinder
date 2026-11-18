// Small wrappers around localStorage that never throw (private mode, blocked storage).

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
