// Source accounts. Environment variables override the defaults rediscovered
// with Windsor on 17 September 2026, so an account change needs no code change.
export function accounts(): Record<string, string> {
  const env = process.env;
  return {
    facebook: env.WINDSOR_META_ACCOUNT_ID || "189245068300417",
    google_ads: env.WINDSOR_GOOGLE_ACCOUNT_ID || "266-236-4039",
    googleanalytics4: env.WINDSOR_GA4_ACCOUNT_ID || "292767515",
    shopify: env.WINDSOR_SHOPIFY_ACCOUNT_ID || "lojadoouro-online.myshopify.com",
    klaviyo: env.WINDSOR_KLAVIYO_ACCOUNT_ID || "SneNCt",
    searchconsole: env.WINDSOR_SEARCHCONSOLE_ACCOUNT_ID || "https://www.lojadoouro.pt/",
    google_merchant: env.WINDSOR_MERCHANT_ACCOUNT_ID || "5678283203",
  };
}

// Currency and timezone fields requested with each connector to confirm EUR / Europe/Lisbon.
export const accountFields: Record<string, string[]> = {
  facebook: ["account_currency", "account_timezone"],
  google_ads: ["account_currency_code", "account_time_zone"],
  googleanalytics4: ["property_currency", "property_timezone"],
  shopify: [],
  klaviyo: [],
  searchconsole: [],
  google_merchant: [],
};

export const metaFields = ["spend", "impressions", "clicks", "actions_offsite_conversion_fb_pixel_purchase", "action_values_offsite_conversion_fb_pixel_purchase"];
export const googleFields = ["spend", "impressions", "clicks", "conversions", "conversions_value"];
export const gaFields = ["totalusers", "active_users", "sessions", "ecommerce_purchases", "purchase_revenue", "item_view_events", "add_to_carts", "checkouts"];
