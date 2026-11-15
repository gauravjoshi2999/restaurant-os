/* Firebase HTTP v1 returns HTTP 400 for BOTH malformed message payloads and
   invalid tokens. Never revoke a Partner device on status alone.
   Only explicit FCM token-specific evidence authorizes local deactivation. */
export async function shouldDisableOwnerFcmToken(response){
  if(!response||response.ok||![400,404].includes(response.status))return false;
  let payload;
  try{payload=await response.json()}catch{return false;}
  const error=payload?.error;
  const details=Array.isArray(error?.details)?error.details:[];
  const fcmDetails=details.filter(d=>d&&d['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError');
  const hasBadRequest=details.some(d=>d&&d['@type']==='type.googleapis.com/google.rpc.BadRequest');
  const codes=new Set(fcmDetails.map(d=>String(d.errorCode||'')));
  // UNREGISTERED explicitly means FCM no longer recognizes the installed app token.
  if(response.status===404&&codes.has('UNREGISTERED'))return true;
  // For HTTP 400 require BOTH an FCM-specific invalid-token detail and a
  // clear registration-token message; a malformed notification must not
  // silently turn off the only active Partner phone.
  return response.status===400&&!hasBadRequest&&codes.has('INVALID_ARGUMENT')&&
    /(?:registration token|token is not a valid fcm)/i.test(String(error?.message||''));
}
