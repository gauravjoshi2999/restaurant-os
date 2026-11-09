const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto}=require('node:crypto');
const source=stripTypeScriptTypes(fs.readFileSync('supabase/functions/cashfree-webhook/index.ts','utf8').replace(/^import .*;\n/gm,''),{mode:'strip'});
async function invoke(options={}){
 let handler,activations=0,writes=0,providerReads=0;
 const cfId=(options.legacy?'bite_':'bite_live_')+'11111111111141118111111111111111';
 const intent={id:'11111111-1111-4111-8111-111111111111',status:options.activated?'activated':'awaiting_payment',amount:100,currency:'INR',provider_order_id:cfId};
 const chain={select(){return this},eq(){return this},neq(){return this},maybeSingle:async()=>({data:chain.table==='orders'?{id:intent.id,is_demo:false,status:'Received'}:chain.table==='order_financials'?{id:'qa-financial',customer_payable_amount:100,currency:'INR',is_demo:false,payment_status:'pending'}:intent}),update(){writes++;return this},then(resolve){resolve({})}};
 const context={Deno:{env:{get:k=>({CASHFREE_APP_ID:'qa-app',CASHFREE_SECRET_KEY:'qa-secret',SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'qa-service'})[k]},serve:fn=>handler=fn},createClient:()=>({from:table=>{chain.table=table;return chain},rpc:async()=>{activations++;return{data:'qa-order'}}}),fetch:async()=>{providerReads++;return new Response(JSON.stringify({order_id:cfId,order_status:options.unpaid?'ACTIVE':'PAID',order_currency:'INR',...(options.noAmount?{}:{order_amount:options.amount??100})}),{status:200})},Response,AbortSignal,TextEncoder,crypto:webcrypto,btoa,Date,JSON,Math,Number,String,Uint8Array};
 vm.createContext(context);vm.runInContext(source,context);
 const raw=JSON.stringify({type:'PAYMENT_SUCCESS_WEBHOOK',data:{order:{order_id:cfId}}});
 const stamp=String(Date.now()-(options.expired?700000:0));
 const enc=new TextEncoder();const key=await webcrypto.subtle.importKey('raw',enc.encode('qa-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Buffer.from(await webcrypto.subtle.sign('HMAC',key,enc.encode(stamp+raw))).toString('base64');
 const res=await handler(new Request('https://example.test',{method:'POST',body:raw,headers:{'x-webhook-timestamp':stamp,'x-webhook-signature':options.badSignature?'invalid':signature}}));
 return {status:res.status,body:await res.json(),activations,writes,providerReads};
}
test('webhook rejects a forged signature before touching provider or database',async()=>{const r=await invoke({badSignature:true});assert.equal(r.status,401);assert.equal(r.activations+r.writes+r.providerReads,0)});
test('webhook rejects expired signed delivery',async()=>{const r=await invoke({expired:true});assert.equal(r.status,401);assert.equal(r.activations,0)});
test('signed webhook verifies paid amount before activation',async()=>{const r=await invoke();assert.equal(r.status,200);assert.equal(r.providerReads,1);assert.equal(r.activations,1)});
test('unpaid or mismatched amount cannot activate an order',async()=>{for(const o of [{unpaid:true},{amount:99}]){const r=await invoke(o);assert.equal(r.status,409);assert.equal(r.activations+r.writes,0)}});
test('missing or nonnumeric provider amount fails closed',async()=>{for(const options of [{amount:'invalid'},{noAmount:true},{amount:'Infinity'}]){const r=await invoke(options);assert.equal(r.status,409);assert.equal(r.activations+r.writes,0)}});
test('already activated webhook is idempotent without another provider or activation call',async()=>{const r=await invoke({activated:true});assert.equal(r.status,200);assert.equal(r.activations+r.writes+r.providerReads,0)});

test('legacy signed payment verification also rejects missing or nonnumeric amounts',async()=>{for(const options of [{legacy:true,amount:'invalid'},{legacy:true,noAmount:true}]){const r=await invoke(options);assert.equal(r.status,409);assert.equal(r.writes,0)}});

test('legacy paid verification records one payment and does not call checkout activation',async()=>{const r=await invoke({legacy:true});assert.equal(r.status,200);assert.equal(r.writes,1);assert.equal(r.activations,0)});
