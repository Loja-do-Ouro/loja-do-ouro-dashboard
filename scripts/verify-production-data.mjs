// Read-only release gate. Log counts/configuration only, never URLs or secrets.
// Login is Google through Supabase Auth: it needs the project URL and its publishable key.
const loginConfigured = Boolean(
  (process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL) &&
  (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.BI_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY),
);
if (process.env.VERCEL_ENV !== "production") {
  console.info("[release-check] Production data gate only runs on production builds.");
} else if (process.env.RELEASE_SKIP_DATA_CHECK === "1") {
  // Emergency override for a code fix while a source is down. Login is still required.
  if (!loginConfigured) throw new Error("Release blocked: dashboard login is not configured.");
  console.warn("[release-check] Data source check skipped by RELEASE_SKIP_DATA_CHECK=1.");
} else {
  if (!loginConfigured) throw new Error("Release blocked: dashboard login is not configured.");
  const key=process.env.WINDSOR_API_KEY || process.env.WINDSORAI_API_KEY;
  const biUrl=process.env.BI_SUPABASE_URL || process.env.SUPABASE_URL;
  const biToken=process.env.BI_SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key && !(biUrl && biToken)) throw new Error("Release blocked: no private data source is configured.");
  if (key && !(biUrl && biToken)) {
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Lisbon",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const d=new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate()-1); const yesterday=d.toISOString().slice(0,10);
    const jobs=[
      ["facebook",process.env.WINDSOR_META_ACCOUNT_ID || "189245068300417","date,spend,account_currency,account_timezone"],
      ["google_ads",process.env.WINDSOR_GOOGLE_ACCOUNT_ID || "266-236-4039","date,spend,account_currency_code,account_time_zone"],
      ["googleanalytics4",process.env.WINDSOR_GA4_ACCOUNT_ID || "292767515","sessions,totalusers,property_currency,property_timezone"],
      ["shopify",process.env.WINDSOR_SHOPIFY_ACCOUNT_ID || "lojadoouro-online.myshopify.com","order_id,order_count,order_currency,order_created_at,order_current_total_price"],
    ];
    const results=await Promise.all(jobs.map(async([connector,account,fields])=>{
      const params=new URLSearchParams({api_key:key,select_accounts:account,date_from:yesterday,date_to:yesterday,fields,_renderer:"json"});
      if(connector==="shopify") params.set("report_timezone","Europe/Lisbon");
      try {
        const response=await fetch(`https://connectors.windsor.ai/${connector}?${params}`,{signal:AbortSignal.timeout(30000)});
        if(!response.ok) return {connector,ok:false,status:response.status};
        const json=await response.json(); const rows=Array.isArray(json)?json:json.data ?? json.result;
        const cf={facebook:"account_currency",google_ads:"account_currency_code",googleanalytics4:"property_currency"}[connector];
        const tf={facebook:"account_timezone",google_ads:"account_time_zone",googleanalytics4:"property_timezone"}[connector];
        const ok=Array.isArray(rows) && (connector==="shopify" || rows.length>0 && rows.every(r=>r[cf]==="EUR" && r[tf]==="Europe/Lisbon"));
        return {connector,ok,rows:Array.isArray(rows)?rows.length:null};
      } catch { return {connector,ok:false,error:"Request unavailable"}; }
    }));
    console.info("[release-check]",JSON.stringify({login:true,mode:"direct",checks:results}));
    if(results.some(r=>!r.ok)) throw new Error("Release blocked: data source check failed; previous production remains active.");
  } else {
    try {
      const url=new URL("/rest/v1/ldo_bi_daily?select=metric_date&limit=1",biUrl);
      const r=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY || process.env.BI_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || biToken,Authorization:`Bearer ${biToken}`}});
      if(!r.ok || !(await r.json()).length) throw new Error("No readable data");
      console.info("[release-check]",JSON.stringify({login:true,mode:"stored",readable:true}));
    } catch { throw new Error("Release blocked: private BI data could not be read."); }
  }
}
