/* Cashfree Easy Split provider response: strictly parse read-only split evidence.
   A listed vendor or settlement_id is NOT confirmation that the restaurant was paid. */
const cents=value=>{
 if(typeof value!=='number'&&typeof value!=='string')throw Error('Split amount is unavailable');
 const text=String(value);
 if(!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(text))throw Error('Invalid split amount');
 const [whole,dec='']=text.split('.');
 const valueCents=Number(whole)*100+Number(dec.padEnd(2,'0'));
 if(!Number.isSafeInteger(valueCents)||valueCents<0)return null;
 return valueCents;
};
export function parseCashfreeSplit(raw,{orderId,orderAmount,currency='INR'}){
 const settlement=raw?.settlement;
 if(!settlement||settlement.order_id!==orderId||settlement.order_currency!==currency)
  throw Error('Split evidence does not match the trusted order reference');
 const expectedCents=cents(orderAmount),receivedCents=cents(settlement.order_amount);
 if(expectedCents===null||receivedCents===null||receivedCents!==expectedCents)
  throw Error('Provider split amount mismatch');
 if(!Array.isArray(raw.vendors)||raw.vendors.length>50)
  throw Error('Provider split vendor list unavailable or unexpectedly large');
 let splitCents=0;
 const seen=new Set();
 const vendors=raw.vendors.map(v=>{
  const id=v?.vendor_id;
  if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||seen.has(id))
   throw Error('Invalid or duplicate provider vendor reference');
  seen.add(id);
  const amount=cents(v.settlement_amount);
  if(amount===null||amount>expectedCents)throw Error('Provider vendor amount mismatch');
  splitCents+=amount;
  if(!Number.isSafeInteger(splitCents))throw Error('Split total too large');
  const settlementId=v.settlement_id;
  return {vendor_id:id,amount:amount/100,
   settlement_reference:typeof settlementId==='number'&&Number.isSafeInteger(settlementId)?String(settlementId):
    typeof settlementId==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(settlementId)?settlementId:null};
 });
 if(splitCents>expectedCents)throw Error('Vendor splits exceed trusted order amount');
 return {status:vendors.length?'PROVIDER_VENDOR_SPLIT_RECORDS':'NO_VENDOR_SPLIT_RECORDS',
  vendor_count:vendors.length,vendors,
  vendor_mapping:'NOT_VERIFIED',bank_payout:'NOT_VERIFIED',
  disclaimer:'Vendor split references are not bank-credit evidence. Confirm the exact vendor and bank UTR separately.'};
}
