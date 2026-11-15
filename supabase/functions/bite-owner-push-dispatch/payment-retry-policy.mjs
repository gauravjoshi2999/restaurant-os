/* Bounded wait for Cashfree verification before notifying the restaurant.
   A checkout can take longer than the four generic FCM-error retries.
   This policy never sends a notification; dispatch must recheck PAID each time. */
export const MAX_PENDING_PAYMENT_ATTEMPTS=15;
export const MAX_PENDING_PAYMENT_AGE_MS=25*60*1000;
export function pendingPaymentRetryPolicy(attempts,createdAt,now=Date.now()){
 const timestamp=typeof createdAt==="string"?Date.parse(createdAt):NaN;
 if(!Number.isSafeInteger(attempts)||attempts<1||!Number.isFinite(timestamp)||
    !Number.isFinite(now)||timestamp>now+60_000)
  return {status:"failed",reason:"Payment verification queue metadata invalid"};
 const age=Math.max(0,now-timestamp);
 if(attempts>=MAX_PENDING_PAYMENT_ATTEMPTS||age>=MAX_PENDING_PAYMENT_AGE_MS)
  return {status:"failed",reason:"Payment verification window expired"};
 return {status:"retry",reason:"Awaiting verified payment"};
}
