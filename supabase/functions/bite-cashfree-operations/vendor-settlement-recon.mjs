/* Read-only Cashfree Easy Split vendor reconciliation — strict order and vendor scope.
   No response here is independent restaurant BANK CREDIT confirmation. */
const id=value=>(typeof value==="string"&&/^[A-Za-z0-9_-]{1,80}$/.test(value))?value:null;
const utr=value=>{
 if(typeof value==="number"&&Number.isSafeInteger(value)&&value>0)value=String(value);
 if(typeof value!=="string")return null;
 const s=value.trim().toUpperCase();
 return /^[A-Z0-9]{6,48}$/.test(s)?s:null;
};
const moneyCents=value=>{
 if(typeof value!=="number"&&typeof value!=="string")return null;
 const s=String(value);
 if(!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(s))return null;
 const [whole,decimal=""]=s.split(".");
 const n=Number(whole)*100+Number(decimal.padEnd(2,"0"));
 return Number.isSafeInteger(n)&&n>=0?n:null;
};
const output=(status,fields={})=>({
 status,utr_check:"NOT_SUBMITTED",vendor_settlement_utr_masked:null,
 vendor_settlement_id:null,provider_settled:false,
 bank_credit:"NOT_INDEPENDENTLY_VERIFIED",
 disclaimer:"Cashfree vendor settlement reports and operator-entered UTR matches are not independent proof of the restaurant bank credit.",
 ...fields
});
export function parseVendorSettlementRecon(raw,{orderId,vendorId,splitAmount,bankStatementUtr=null}){
 if(!id(orderId)||!id(vendorId)||!Array.isArray(raw?.data)||raw.data.length>50)
  throw Error("Invalid Cashfree vendor reconciliation response");
 const expected=moneyCents(splitAmount);
 if(expected===null)throw Error("Untrusted split amount");
 // A partial page cannot certify unsettled or paid states. No cursor traversal
 // until order-scoped pagination is explicitly implemented.
 if(raw.cursor!==null&&raw.cursor!==undefined)
  return output("PAGINATION_INCOMPLETE");
 if(raw.data.some(r=>!r||r.merchant_order_id!==orderId))
  throw Error("Reconciliation contains a different order");
 const rows=raw.data.filter(r=>r.entity_type==="vendor_commission"&&r.merchant_vendor_id===vendorId);
 if(!rows.length)return output("NO_VENDOR_RECON_ROW");
 if(rows.length!==1)return output("MULTIPLE_VENDOR_RECON_ROWS");
 const row=rows[0];
 if(row.currency!=="INR")throw Error("Unexpected vendor currency");
 const amount=moneyCents(row.amount);
 if(amount===null||amount!==expected)throw Error("Vendor recon amount does not match split");
 if(row.settled==="NO")return output("PROVIDER_NOT_SETTLED");
 if(row.settled!=="YES")return output("PROVIDER_STATUS_UNCLEAR");
 // Treat a provider-reported "settled" state without reference + successful
 // settlement evidence as incomplete, never as bank credit.
 const past=Array.isArray(row.past_settlements)?row.past_settlements:[];
 const settlementId=typeof row.vendor_settlement_id==="number"&&Number.isSafeInteger(row.vendor_settlement_id)?
  String(row.vendor_settlement_id):id(row.vendor_settlement_id);
 const settlementUtr=utr(row.vendor_settlement_utr);
 if(!settlementId||!settlementUtr||
    !past.some(x=>x&&String(x.settlement_id)===settlementId&&x.status==="SUCCESS"))
  return output("PROVIDER_SETTLEMENT_EVIDENCE_INCOMPLETE");
 let utrCheck="NOT_SUBMITTED";
 if(bankStatementUtr!==null&&bankStatementUtr!==undefined&&bankStatementUtr!==""){
  const typed=utr(bankStatementUtr);
  if(!typed)throw Error("Invalid bank statement UTR format");
  utrCheck=typed===settlementUtr?"MATCHES_OPERATOR_INPUT":"DIFFERS_FROM_OPERATOR_INPUT";
 }
 return output("PROVIDER_REPORTS_SETTLED",{
  provider_settled:true,vendor_settlement_id:settlementId,
  vendor_settlement_utr_masked:"••••"+settlementUtr.slice(-4),
  utr_check:utrCheck
 });
}
