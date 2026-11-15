'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {resolve}=require('node:path');
const codePath='supabase/functions/bite-owner-push-dispatch/fcm-token-policy.mjs';
const policy=import(pathToFileURL(resolve(codePath)).href);
const fcm=(errorCode)=>({'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode});
const badRequest={'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[{field:'message.data',description:'Invalid data key'}]};
const response=(status,payload)=>({ok:false,status,async json(){if(payload instanceof Error)throw payload;return payload;}});
test('Revokes only explicit FCM UNREGISTERED tokens on HTTP 404',async()=>{
 const {shouldDisableOwnerFcmToken}=await policy;
 assert.equal(await shouldDisableOwnerFcmToken(response(404,{error:{status:'NOT_FOUND',details:[fcm('UNREGISTERED')]}})),true);
 assert.equal(await shouldDisableOwnerFcmToken(response(404,{error:{status:'NOT_FOUND',message:'URL not found'}})),false);
 assert.equal(await shouldDisableOwnerFcmToken(response(404,{error:{status:'NOT_FOUND',details:[fcm('UNAVAILABLE')]}})),false);
});
test('HTTP 400 malformed message payload cannot disable Owner Android device',async()=>{
 const {shouldDisableOwnerFcmToken}=await policy;
 const malformed={error:{status:'INVALID_ARGUMENT',message:"Invalid value at message.data[0].value",details:[badRequest]}};
 assert.equal(await shouldDisableOwnerFcmToken(response(400,malformed)),false);
 assert.equal(await shouldDisableOwnerFcmToken(response(400,{error:{status:'INVALID_ARGUMENT',message:'bad request'}})),false);
 assert.equal(await shouldDisableOwnerFcmToken(response(400,{error:{status:'INVALID_ARGUMENT',message:'Invalid registration token',details:[badRequest,fcm('INVALID_ARGUMENT')]}})),false);
 assert.equal(await shouldDisableOwnerFcmToken(response(400,{error:{status:'INVALID_ARGUMENT',message:'Bad field',details:[fcm('INVALID_ARGUMENT')]}})),false);
});
test('Only specific confirmed FCM INVALID_ARGUMENT registration token can be deactivated',async()=>{
 const {shouldDisableOwnerFcmToken}=await policy;
 assert.equal(await shouldDisableOwnerFcmToken(response(400,{error:{
  status:'INVALID_ARGUMENT',message:'The registration token is not a valid FCM registration token',
  details:[fcm('INVALID_ARGUMENT')]
 }})),true);
});
test('Non-JSON, transient, unknown, and successful FCM outcomes cannot revoke device',async()=>{
 const {shouldDisableOwnerFcmToken}=await policy;
 for(const status of [401,403,408,429,500,503]){
  assert.equal(await shouldDisableOwnerFcmToken(response(status,{error:{details:[fcm('UNREGISTERED')]}})),false);
 }
 assert.equal(await shouldDisableOwnerFcmToken(response(400,new Error('not JSON'))),false);
 assert.equal(await shouldDisableOwnerFcmToken(response(404,{error:{details:null}})),false);
 assert.equal(await shouldDisableOwnerFcmToken(null),false);
 assert.equal(await shouldDisableOwnerFcmToken({ok:true,status:200}),false);
});
test('New-order and cancellation dispatchers apply the same conservative FCM token check',()=>{
 const path='supabase/functions/bite-owner-push-dispatch/';
 const regular=fs.readFileSync(path+'index.ts','utf8');
 const cancel=fs.readFileSync(path+'cancellation-push.mjs','utf8');
 for(const source of [regular,cancel]){
  assert.match(source,/import \{shouldDisableOwnerFcmToken\} from "\.\/fcm-token-policy\.mjs"/);
  assert.match(source,/if\(await shouldDisableOwnerFcmToken\(response\)\)/);
  assert.doesNotMatch(source,/if\(response\.status===404\|\|response\.status===400\)/);
  assert.doesNotMatch(source,/if\(\[400,404\]\.includes\(response\.status\)\)/);
  assert.match(source,/\.update\(\{enabled:false,updated_at:/);
 }
 // No refund/order mutation, and original verified-payment and owner checks remain.
 assert.match(regular,/finance\?\.payment_status!=="paid"/);
 assert.match(regular,/ids\.length!==1/);
 assert.match(cancel,/ledger\.data\?\.payment_status!=="paid"/);
 assert.match(cancel,/owner\.data\?\.length!==1/);
});
