import "server-only";
import { normalizeOrders } from "./live-model";
import { dates, shift, type Period } from "./periods";
import { number, type Store, type Dataset } from "./model";
import { accountFields, accounts, gaFields as ga, googleFields as google, metaFields as meta } from "./accounts";
import { readWindsor, windsorConfigured, type WindsorResult } from "./windsor";

const orderFields = ["order_id", "order_name", "order_count", "order_created_at", "order_updated_at", "order_cancelled_at", "order_financial_status", "order_fulfillment_status", "order_current_total_price", "order_net_payment", "order_currency", "order_shipping_address_city", "order_shipping_address_country", "order_source_name", "order_customer_last_visit_utm_campaign", "order_customer_last_visit_utm_source", "order_customer_last_visit_utm_medium"];

// Detail datasets per dashboard section. The nightly ingestion stores the same set.
export const DETAILS: { connector: string; source: string; dataset: string; fields: string[]; sections: string[] }[] = [
  { connector: "facebook", source: "meta", dataset: "ads", fields: ["date", "campaign", "campaign_id", "ad_id", "ad_name", ...meta], sections: ["marketing", "quality"] },
  { connector: "google_ads", source: "google_ads", dataset: "campaigns", fields: ["date", "campaign", "campaign_id", "campaign_type", ...google], sections: ["marketing", "quality"] },
  { connector: "google_ads", source: "google_ads", dataset: "conversion_actions", fields: ["date", "conversion_action_name", "conversion_action_category", "conversions", "conversions_value"], sections: ["marketing", "quality"] },
  { connector: "googleanalytics4", source: "ga4", dataset: "channels", fields: ["session_source_medium", "sessions", "ecommerce_purchases", "purchase_revenue"], sections: ["marketing", "quality"] },
  { connector: "klaviyo", source: "klaviyo", dataset: "campaigns", fields: ["campaign", "sent_at", "campaign_report_recipients", "campaign_report_conversions"], sections: ["marketing"] },
  { connector: "klaviyo", source: "klaviyo", dataset: "flows", fields: ["flow_name", "flow_recipients", "flow_conversions"], sections: ["marketing"] },
  { connector: "searchconsole", source: "searchconsole", dataset: "period_totals", fields: ["clicks", "impressions", "ctr", "position"], sections: ["marketing"] },
  { connector: "google_merchant", source: "google_merchant", dataset: "status", fields: ["product_status_country", "product_status_reporting_context", "product_status_active_count", "product_status_disapproved_count", "product_status_pending_count"], sections: ["marketing"] },
  { connector: "googleanalytics4", source: "ga4", dataset: "geography", fields: ["country", "city", "totalusers", "sessions", "ecommerce_purchases", "purchase_revenue"], sections: ["audience"] },
  { connector: "googleanalytics4", source: "ga4", dataset: "demographics", fields: ["age", "gender", "active_users"], sections: ["audience"] },
  { connector: "facebook", source: "meta", dataset: "demographics", fields: ["age", "gender", "spend", "impressions", "actions_offsite_conversion_fb_pixel_purchase"], sections: ["audience"] },
  { connector: "facebook", source: "meta", dataset: "geography", fields: ["country", "spend", "impressions", "actions_offsite_conversion_fb_pixel_purchase"], sections: ["audience"] },
  { connector: "googleanalytics4", source: "ga4", dataset: "transactions", fields: ["transactionid", "ecommerce_purchases", "purchase_revenue"], sections: ["quality"] },
];

export const DAILY_SOURCES = [
  { connector: "facebook", source: "meta", fields: meta },
  { connector: "google_ads", source: "google_ads", fields: google },
  { connector: "googleanalytics4", source: "ga4", fields: ga },
];

export function liveConfigured() {
  return windsorConfigured();
}

export function sourceMetadata(connector: string, fields: string[]) {
  return {
    fields, account_id: accounts()[connector], timezone: connector === "shopify" || accountFields[connector].length ? "Europe/Lisbon" : undefined, currency: accountFields[connector].length ? "EUR" : undefined,
    transport: "Windsor", cache: "Cache upstream possível; refresh não comprovado.",
  };
}

export async function loadLivePeriods(periods: Period[], selected: Period, section: string): Promise<Store> {
  const unique = [...new Map(periods.map(p => [`${p.from}:${p.to}`, p])).values()];
  const broad = {from:unique.map(p=>p.from).sort()[0], to:unique.map(p=>p.to).sort().at(-1)!};
  const store: Store = {daily:[], datasets:[], quality:[], reports:[], runs:[], errors:[], mode:"live"};
  const errors: string[] = [];
  const metadata = (connector: string, fields: string[]) => ({
    ...sourceMetadata(connector, fields),
    query:"Consulta direta; dados não certificados nem guardados como fecho.",
  });
  const dataset = (connector:string, source:string, kind:string, p:Period, r:WindsorResult, extra:Record<string, unknown> = {}): Dataset => ({
    source, dataset:kind, period_start:p.from, period_end:p.to, rows:r.rows,
    metadata:{...metadata(connector,r.fields),...extra}, fetched_at:r.fetched_at, status:"provisional", run_id:"live",
  });
  const job = async (label:string, action:()=>Promise<void>) => {
    try { await action(); } catch(e) { errors.push(`${label}: ${e instanceof Error ? e.message : "Indisponível"}`); }
  };
  const daily = async (connector:string, source:string, fields:string[]) => {
    const r = await readWindsor(connector,broad,["date",...fields]);
    store.daily.push(...r.rows.filter(x=>typeof x.date === "string" && x.date >= broad.from && x.date <= broad.to)
      .map(x=>({source,metric_date:String(x.date),metrics:x,fetched_at:r.fetched_at,status:"provisional",run_id:"live"})));
    const found = new Set(r.rows.map(x=>x.date));
    for(const p of unique) if(dates(p).some(d=>!found.has(d))) errors.push(`${source}: cobertura diária incompleta em ${p.from} a ${p.to}.`);
  };
  const jobs: Promise<void>[] = [
    ...DAILY_SOURCES.map(d => job(d.source === "meta" ? "Meta" : d.source === "google_ads" ? "Google Ads" : "GA4", () => daily(d.connector, d.source, d.fields))),
    job("Shopify",async()=>{
      // Add boundary days, then filter the actual creation instant in Lisbon.
      // This also protects against connectors filtering on a UTC boundary.
      const r = await readWindsor("shopify",{from:shift(broad.from,-1),to:shift(broad.to,1)},orderFields);
      const normalized = normalizeOrders(r.rows);
      for(const p of unique) store.datasets.push(dataset("shopify","shopify_live","orders",p,
        {...r,rows:normalized.rows.filter(x=>String(x.date)>=p.from && String(x.date)<=p.to)},
        {complete:false,conflicts:normalized.conflicts,pagination:"Não exposta pelo conector; sem certificação de cobertura.",excluded_reversal_rows:normalized.excluded}));
    }),
    ...unique.map(p=>job(`GA4 ${p.from} a ${p.to}`,async()=>{
      const r=await readWindsor("googleanalytics4",p,ga);
      if(r.rows.length!==1) throw new Error("Total de período ausente ou com granularidade inesperada.");
      store.datasets.push(dataset("googleanalytics4","ga4","period_totals",p,r));
      if((number(r.rows[0].purchase_revenue) ?? 0)<0) store.quality.push({metric_date:p.to,code:"negative_ga4_revenue",severity:"warning",message:"A receita GA4 é negativa neste período; requer diagnóstico. Não é usada como receita Shopify.",evidence:{period:p},created_at:r.fetched_at,run_id:"live"});
    })),
  ];
  for (const d of DETAILS.filter(d => d.sections.includes(section)))
    jobs.push(job(`${d.source} · ${d.dataset}`,async()=>{const r=await readWindsor(d.connector,selected,d.fields);store.datasets.push(dataset(d.connector,d.source,d.dataset,selected,r,{privacy:d.source==="ga4"?"Podem existir thresholds e categorias unknown.":undefined}));}));
  await Promise.all(jobs);
  store.errors = [...new Set(errors)];
  if(!store.daily.length && !store.datasets.some(d=>d.rows.length)) store.mode="unavailable";
  return store;
}
