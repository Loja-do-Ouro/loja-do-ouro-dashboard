const {test}=require("node:test");
const assert=require("node:assert/strict");
const {normalizeOrders,liveCommerce}=require("../.test-build/bi/live-model.js");
const {overview}=require("../.test-build/bi/model.js");
const period={from:"2026-09-16",to:"2026-09-16"};
const base={order_id:"gid://shopify/Order/10",order_name:"#10online",order_count:1,order_created_at:"2026-09-15T23:12:36Z",order_updated_at:"2026-09-16T09:00:00Z",order_current_total_price:"120.54",order_net_payment:"120.54",order_currency:"EUR",order_financial_status:"PAID",order_fulfillment_status:"FULFILLED",order_cancelled_at:null};
const store=(rows,conflicts=0)=>({daily:[],datasets:[{source:"shopify_live",dataset:"orders",period_start:period.from,period_end:period.to,rows,metadata:{complete:false,conflicts},fetched_at:"2026-09-17T01:00:00Z",status:"provisional",run_id:"live"}],quality:[],reports:[],runs:[],errors:[],mode:"live"});
test("Connector reversal rows cannot duplicate or replace an order",()=>{
 const result=normalizeOrders([base,{...base,order_count:0,order_current_total_price:-120.54,order_net_payment:-120.54}]);
 assert.equal(result.rows.length,1); assert.equal(result.excluded,1);
 assert.equal(result.rows[0].id,"10"); assert.equal(result.rows[0].current_total,120.54);
 assert.equal(result.rows[0].created_date,"2026-09-16");
 assert.equal(liveCommerce(store(result.rows),period).paidValue,120.54);
});
test("Observed cohort never supplies Shopify sales, official AOV or MER",()=>{
 const s=store(normalizeOrders([base]).rows);
 assert.equal(liveCommerce(s,period).complete,false);
 assert.equal(overview(s,period).sales.value,null);
 assert.equal(overview(s,period).aov.value,null);
 assert.equal(overview(s,period).mer,null);
});
test("Missing orders and conflicting or foreign-currency rows cannot produce financial totals",()=>{
 assert.equal(liveCommerce(store([]),period).paidValue,null);
 assert.equal(liveCommerce(store([]),period).count,null);
 const result=normalizeOrders([base,{...base,order_current_total_price:140}]);
 assert.equal(result.conflicts,1);
 assert.equal(liveCommerce(store(result.rows,result.conflicts),period).paidValue,null);
 assert.equal(liveCommerce(store(normalizeOrders([{...base,order_currency:"USD"}]).rows),period).paidValue,null);
});
test("Pending and cancelled orders are excluded from paid observed value",()=>{
 const s=store(normalizeOrders([base,{...base,order_id:"11",order_financial_status:"PENDING",order_net_payment:0},{...base,order_id:"12",order_cancelled_at:"2026-09-16T10:00:00Z"}]).rows);
 const c=liveCommerce(s,period);assert.equal(c.count,3);assert.equal(c.paidCount,1);assert.equal(c.pendingCount,1);assert.equal(c.paidValue,120.54);
});
