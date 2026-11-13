/* Owner cash closing review: pure, testable money math. Server remains authoritative. */
(function(root){
  'use strict';
  const MAX_RUPEES=999999999999;
  function paise(value,label='Amount'){
    const raw=String(value??'').trim();
    if(!/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(raw))
      throw new Error(label+' sahi bharein (0 ya positive, maximum 2 decimals).');
    const parts=raw.split('.');
    const result=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));
    if(!Number.isSafeInteger(result)||result>MAX_RUPEES*100+99)
      throw new Error(label+' bahut bada hai.');
    return result;
  }
  function validateDate(date,today){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))
      throw new Error('Valid closing date select karein.');
    const d=new Date(date+'T00:00:00Z');
    if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==date)
      throw new Error('Valid closing date select karein.');
    if(today&&date>today)throw new Error('Future date ka cashbook close nahi ho sakta.');
  }
  function preview(entries,openingValue,countedValue,notes){
    const opening=paise(openingValue,'Opening cash'),counted=paise(countedValue,'Counted cash');
    let cashIn=0,cashOut=0,cashCount=0;
    for(const entry of entries||[]){
      if(entry.payment_method!=='Cash')continue;
      const amount=paise(entry.amount,'Cashbook entry');
      if(entry.direction==='in')cashIn+=amount;
      else if(entry.direction==='out')cashOut+=amount;
      else throw new Error('Cashbook entry direction galat hai.');
      cashCount++;
    }
    const expected=opening+cashIn-cashOut,difference=counted-expected;
    if(!Number.isSafeInteger(expected)||!Number.isSafeInteger(difference))
      throw new Error('Cash total bahut bada hai.');
    if(expected<0)throw new Error('Expected cash negative hai. Entries aur opening cash check karein.');
    const reason=String(notes||'').trim();
    if(difference!==0&&reason.length<8)
      throw new Error('Cash difference ke liye kam se kam 8 characters ka reason likhein.');
    return {opening_cash:opening/100,cash_in:cashIn/100,cash_out:cashOut/100,
      expected_cash:expected/100,counted_cash:counted/100,difference:difference/100,
      notes:reason,cash_entry_count:cashCount};
  }
  function fingerprint(entries){
    return JSON.stringify((entries||[]).map(e=>[
      String(e.entry_id||''),String(e.source_type||''),String(e.source_id||''),
      String(e.entry_date||''),String(e.direction||''),String(e.payment_method||''),
      String(e.amount??'')
    ]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
  }
  const api={paise,validateDate,preview,fingerprint};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BiteCashClosing=api;
})(typeof window!=='undefined'?window:globalThis);
