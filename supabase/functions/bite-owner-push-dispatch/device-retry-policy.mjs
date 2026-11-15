/* Safely defer an eligible Owner order/cancellation push while no app device is registered.
   Every next dispatch revalidates the real paid order and owner mapping first.
   A bounded wait avoids an old notification appearing long after the request. */
export const MAX_MISSING_DEVICE_ATTEMPTS=15;
export const MAX_MISSING_DEVICE_AGE_MS=25*60*1000;
export function awaitingOwnerDevicePolicy(attempts,createdAt,now=Date.now()){
 const at=typeof createdAt==="string"?Date.parse(createdAt):NaN;
 if(!Number.isSafeInteger(attempts)||attempts<1||
    !Number.isFinite(at)||!Number.isFinite(now)||at>now+60_000)
  return {status:"failed",reason:"Owner notification queue metadata invalid"};
 if(attempts>=MAX_MISSING_DEVICE_ATTEMPTS||now-at>=MAX_MISSING_DEVICE_AGE_MS)
  return {status:"failed",reason:"No Owner device within notification window"};
 return {status:"retry",reason:"Awaiting Owner Partner device"};
}
