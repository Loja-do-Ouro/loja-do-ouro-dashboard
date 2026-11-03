// Failed-login limiter. State lives in the server instance memory, so it slows
// guessing without an external store; a Vercel WAF rule adds a global limit.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map<string, number[]>();

function recent(key: string, now: number) {
  const list = (failures.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list;
}

export function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function isLocked(key: string, now = Date.now()) {
  return recent(key, now).length >= MAX_FAILURES;
}

export function recordFailure(key: string, now = Date.now()) {
  failures.set(key, [...recent(key, now), now]);
  if (failures.size > 10000) failures.delete(failures.keys().next().value!);
}

export function clearFailures(key: string) {
  failures.delete(key);
}

// Request limiter: true when the key already made max requests within windowMs (the request is not counted then).
// Same in-memory caveat as above; use it on top of a limit in the database.
const hits = new Map<string, number[]>();
export function overLimit(key: string, max: number, windowMs: number, now = Date.now()) {
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  const over = list.length >= max;
  if (!over) list.push(now);
  hits.set(key, list);
  if (hits.size > 10000) hits.delete(hits.keys().next().value!);
  return over;
}
