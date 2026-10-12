import { AD_SOURCES } from "./channels";

// Stored datasets each dashboard section reads, so the closes read (ldo_bi_read and ldo_bi_read_detail) brings only
// those. Reading every dataset of the interval was ~9 MB: over the anon role's 3 s statement timeout with a few views
// at once, and over the 2 MB limit of Next's data cache, so it was never cached.
//   interval: any period inside the whole interval read ("*/x" is dataset x of every source);
//   exact: only the selected period, as detail() in model.ts;
//   daily: the selected period or, without a usable one, its days, as detail(..., allowDaily = true).
// Keep in line with the detail() calls in components/dashboard/*.tsx (tests/read-plan.cjs checks them).
export type Needs = { interval: string[]; exact: string[]; daily: string[] };

// Period totals feed every card, comparison and the daily trend, whatever the section.
export const PERIOD_TOTALS = "*/period_totals";
// Campaign detail split into online and physical-store spend (onlineInvestment) and reconciled (calculatedChecks).
export const AD_DATASETS = AD_SOURCES.map((a) => `${a.source}/${a.dataset}`);

const needs = (n: Partial<Needs>): Needs => ({ interval: [PERIOD_TOTALS, ...(n.interval || [])], exact: n.exact || [], daily: n.daily || [] });
export const SECTION_NEEDS: Record<string, Needs> = {
  overview: needs({ daily: AD_DATASETS }),
  // financialEvents() takes every transactions window that touches the period (old September collections).
  sales: needs({ interval: ["shopify/transactions"], exact: ["shopify/products"], daily: ["shopify/orders", "shopify/abandoned"] }),
  marketing: needs({
    exact: ["ga4/channels", "klaviyo/campaigns", "klaviyo/flows", "google_merchant/status"],
    daily: [...AD_DATASETS, "google_ads/conversion_actions"],
  }),
  social: needs({ exact: ["instagram/posts", "facebook_page/posts"] }),
  audience: needs({ exact: ["ga4/geography", "ga4/demographics", "meta/geography", "meta/demographics"] }),
  quality: needs({ exact: ["ga4/transactions"], daily: ["shopify/orders", ...AD_DATASETS] }),
};

export function sectionNeeds(section: string): Needs {
  return SECTION_NEEDS[section] || SECTION_NEEDS.overview;
}
