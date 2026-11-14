/* Safe, aggregate-only push health. No order IDs, FCM tokens or customer data. */
const EVENTS=["sent","failed","queued","retry","processing","no_devices"];
export function summarizePushHealth(devices,events,now=Date.now()){
 if(!Array.isArray(devices)||devices.length>30||!Array.isArray(events)||events.length>100)
  throw Error("Unexpected push diagnostic dataset");
 const active=devices.filter(d=>d?.enabled===true);
 const cutoff=now-48*60*60*1000;
 const recent=active.filter(d=>{
  const stamp=typeof d.last_seen_at==="string"?Date.parse(d.last_seen_at):NaN;
  return Number.isFinite(stamp)&&stamp>=cutoff&&stamp<=now+60*1000;
 });
 const statuses=Object.fromEntries(EVENTS.map(status=>[status,
  events.filter(ev=>ev?.delivery_status===status).length]));
 return {
  status:active.length?"FCM_DEVICE_REGISTERED":"NO_ACTIVE_PARTNER_DEVICE",
  devices:{registered:devices.length,enabled:active.length,
   supports_order_actions:active.filter(d=>d.supports_order_actions===true).length,
   seen_within_48h:recent.length},
  outbox:{sampled_events:events.length,submitted_to_fcm:statuses.sent,
   failed:statuses.failed,queued:statuses.queued,retry:statuses.retry,
   processing:statuses.processing,no_devices:statuses.no_devices},
  delivered_to_phone:"NOT_VERIFIED",
  note:"FCM accepted/submitted does not prove Android displayed the notification. No test push or order was created."
 };
}
