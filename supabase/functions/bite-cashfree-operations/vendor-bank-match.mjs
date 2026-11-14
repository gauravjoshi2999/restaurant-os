/* Pure comparison for server-side use. Never return, print or persist account numbers.
   Matching payout settings is NOT Cashfree KYC, activation, settlement or bank credit. */
const numberString=(value)=>{
 if(typeof value==="string")return value.trim();
 // Cashfree examples serialize a bank account as a number; only safe integers
 // are compared. Do not silently compare rounded 16+ digit JS numbers.
 if(typeof value==="number"&&Number.isSafeInteger(value)&&value>=0)return String(value);
 return "";
};
const account=value=>{
 const n=numberString(value);
 return /^[0-9]{6,25}$/.test(n)?n:null;
};
const ifsc=value=>{
 if(typeof value!=="string")return null;
 const s=value.trim().toUpperCase();
 return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s)?s:null;
};
export function compareProviderVendorBank(providerVendor,payoutProfile,expectedVendorId){
 if(typeof expectedVendorId!=="string"||
    !/^[A-Za-z0-9_-]{1,80}$/.test(expectedVendorId)||
    providerVendor?.vendor_id!==expectedVendorId)
  throw Error("Cashfree vendor reference mismatch");
 const rawStatus=providerVendor?.status;
 const providerStatus=typeof rawStatus==="string"&&/^[A-Z][A-Z0-9_]{0,39}$/.test(rawStatus)?
  rawStatus:"UNKNOWN";
 let match="NOT_COMPARABLE";
 let reason="PROFILE_UNAVAILABLE";
 if(payoutProfile){
  const dbAccount=account(payoutProfile.account_number),dbIfsc=ifsc(payoutProfile.ifsc_code);
  const providerAccount=account(providerVendor?.bank?.account_number);
  const providerIfsc=ifsc(providerVendor?.bank?.ifsc);
  if(!dbAccount||!dbIfsc)reason="PAYOUT_PROFILE_BANK_INCOMPLETE";
  else if(!providerAccount||!providerIfsc)reason="PROVIDER_BANK_DETAILS_MISSING_OR_UNSAFE";
  else {
   match=dbAccount===providerAccount&&dbIfsc===providerIfsc?"MATCH":"MISMATCH";
   reason=match==="MATCH"?"BANK_DETAILS_MATCH_ONLY":"BANK_DETAILS_DIFFER";
  }
 }
 // No raw PII, doc values, beneficiary name or external account reference.
 return {vendor_id:expectedVendorId,provider_vendor_status:providerStatus,
  bank_details_comparison:match,comparison_reason:reason,
  restaurant_mapping:"NOT_APPROVED",vendor_kyc:"NOT_VERIFIED",
  vendor_payout:"NOT_VERIFIED",bank_credit:"NOT_VERIFIED"};
}
