import "server-only";
import { dates, type Period } from "./periods";
import { number, type Row } from "./model";

// Metricool API (https://app.metricool.com/api), read-only. The token goes in the
// X-Mc-Auth header; userId and blogId (the "Loja do Ouro" brand) in the query.
const BASE = "https://app.metricool.com/api";
const TZ = "Europe/Lisbon";

export function metricoolConfigured() {
  return Boolean(process.env.METRICOOL_USER_TOKEN);
}

export function metricoolAccount() {
  return { userId: process.env.METRICOOL_USER_ID || "2334170", blogId: process.env.METRICOOL_BLOG_ID || "2912472" };
}

async function api<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = process.env.METRICOOL_USER_TOKEN;
  if (!token) throw new Error("Ligação Metricool por configurar.");
  const url = new URL(`${BASE}${path}`);
  url.search = new URLSearchParams({ ...params, ...metricoolAccount() }).toString();
  let r: Response;
  try {
    r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30000), headers: { "X-Mc-Auth": token, Accept: "application/json" } });
  } catch { throw new Error("Consulta Metricool interrompida."); }
  if (!r.ok) throw new Error(`Metricool recusou a consulta (HTTP ${r.status}).`);
  return r.json() as Promise<T>;
}

// Dates come as "2026-09-01T00:00:00+02:00", "20260901" or epoch milliseconds.
export function metricoolDay(v: unknown): string | null {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{12,13}$/.test(s)) return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(Number(s)));
  return null;
}

const window = (p: Period) => ({ from: `${p.from}T00:00:00`, to: `${p.to}T23:59:59`, timezone: TZ });

// One value per day for a metric of the v2 timelines endpoint.
async function timeline(network: string, metric: string, subject: string | null, p: Period) {
  const r = await api<{ data?: { metric: string; values?: { dateTime: string; value: number }[] }[] }>("/v2/analytics/timelines", {
    network, metric, ...(subject ? { subject } : {}), ...window(p),
  });
  const out = new Map<string, number>();
  for (const v of r.data?.[0]?.values || []) {
    const day = metricoolDay(v.dateTime), value = number(v.value);
    if (day && value !== null) out.set(day, (out.get(day) || 0) + value);
  }
  return out;
}

// Followers count per day (the classic stats endpoint returns [[date, value], ...]).
async function followers(metric: string, p: Period) {
  const rows = await api<unknown[][]>(`/stats/timeline/${metric}`, { start: p.from.replaceAll("-", ""), end: p.to.replaceAll("-", "") });
  const out = new Map<string, number>();
  for (const [d, v] of Array.isArray(rows) ? rows : []) {
    const day = metricoolDay(d), value = number(v);
    if (day && value !== null) out.set(day, value);
  }
  return out;
}

type Series = [field: string, load: (p: Period) => Promise<Map<string, number>>];
const INSTAGRAM: Series[] = [
  ["followers", (p) => followers("igFollowers", p)],
  ["followers_gained", (p) => timeline("instagram", "followers_gained", "account", p)],
  ["followers_lost", (p) => timeline("instagram", "followers_lost", "account", p)],
  ["posts", (p) => timeline("instagram", "count", "posts", p)],
  ["posts_reach", (p) => timeline("instagram", "reach", "posts", p)],
  ["posts_interactions", (p) => timeline("instagram", "interactions", "posts", p)],
  ["reels", (p) => timeline("instagram", "count", "reels", p)],
  ["reels_views", (p) => timeline("instagram", "videoviews", "reels", p)],
  ["reels_interactions", (p) => timeline("instagram", "interactions", "reels", p)],
];
const FACEBOOK: Series[] = [
  ["followers", (p) => timeline("facebook", "pageFollows", null, p)],
  ["impressions", (p) => timeline("facebook", "pageImpressions", null, p)],
  ["posts", (p) => timeline("facebook", "postsCount", null, p)],
  ["interactions", (p) => timeline("facebook", "postsInteractions", null, p)],
];

// Daily rows for one network: { date, field: value, ... }. A series that fails is
// reported, the others are kept.
export async function metricoolDaily(network: "instagram" | "facebook", p: Period) {
  const series = network === "instagram" ? INSTAGRAM : FACEBOOK;
  const errors: string[] = [];
  const byDay = new Map<string, Row>(dates(p).map((d) => [d, { date: d }]));
  for (const [field, load] of series) {
    try {
      for (const [day, value] of await load(p)) {
        const row = byDay.get(day);
        if (row) row[field] = value;
      }
    } catch (e) {
      errors.push(`${network} ${field}: ${e instanceof Error ? e.message : "indisponível"}`);
    }
  }
  const rows = [...byDay.values()].filter((r) => Object.keys(r).length > 1);
  return { rows, errors };
}

const text = (v: unknown, max = 140) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const n = (v: unknown) => number(v) ?? 0;

// Publications of the period, best first by interactions.
export async function metricoolPosts(network: "instagram" | "facebook", p: Period): Promise<Row[]> {
  if (network === "facebook") {
    const r = await api<{ data?: Row[] }>("/v2/analytics/posts/facebook", window(p));
    return (r.data || []).map((x) => ({
      type: x.type, published_at: x.created ?? x.timestamp, url: x.link, text: text(x.text),
      reactions: n(x.reactions), comments: n(x.comments), shares: n(x.shares), clicks: n(x.clicks),
      interactions: n(x.reactions) + n(x.comments) + n(x.shares), impressions: n(x.impressionsUnique ?? x.impressions), engagement: number(x.engagement),
    })).sort((a, b) => b.interactions - a.interactions).slice(0, 30);
  }
  const [posts, reels] = await Promise.all([
    api<{ data?: Row[] }>("/v2/analytics/posts/instagram", window(p)),
    api<{ data?: Row[] }>("/v2/analytics/reels/instagram", window(p)),
  ]);
  const map = (x: Row, kind: string) => ({
    type: kind === "reel" ? "Reel" : String(x.type || "Post"), published_at: x.publishedAt, url: x.url, text: text(x.content),
    likes: n(x.likes), comments: n(x.comments), shares: n(x.shares), saved: n(x.saved),
    interactions: n(x.interactions), reach: n(x.reach), views: n(x.views ?? x.videoViews ?? x.impressions), engagement: number(x.engagement),
  });
  return [...(posts.data || []).map((x) => map(x, "post")), ...(reels.data || []).map((x) => map(x, "reel"))]
    .sort((a, b) => b.interactions - a.interactions).slice(0, 30);
}
