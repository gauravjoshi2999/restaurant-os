/* Bite: tenant-scoped direct ordering links + opt-in itemized POS receipt sharing. */
(function(root){
 'use strict';
 const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const BASE='https://gauravjoshi2999.github.io/restaurant-os/customer.html';
 const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const clean=(value,max=140)=>String(value??'').replace(/[\r\n\t]+/g,' ').trim().slice(0,max);
 function normalizeIndianMobile(value){
  let digits=String(value??'').replace(/\D/g,'');
  if(digits.length===12&&digits.startsWith('91'))digits=digits.slice(2);
  return /^[6-9]\d{9}$/.test(digits)?'91'+digits:null;
 }
 function directRestaurantUrl(restaurantId){
  if(!UUID.test(String(restaurantId||'')))throw new Error('Valid restaurant is required.');
  const url=new URL(BASE);
  url.searchParams.set('direct','1');
  url.searchParams.set('restaurant',String(restaurantId).toLowerCase());
  return url.toString();
 }
 function validatedBill(payload){
  const id=clean(payload?.restaurantId,80),link=directRestaurantUrl(id);
  const items=Array.isArray(payload?.items)?payload.items:[];
  if(!items.length||items.length>180)throw new Error('Bill must have 1 to 180 items.');
  const lines=items.map(item=>{
   const name=clean(item.name||item.item_name||'Item',110);
   const quantity=Number(item.quantity),unit_price=Number(item.unit_price??item.price);
   if(!name||!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unit_price)||unit_price<0)
    throw new Error('Invalid bill item');
   return {name,quantity,unit_price,total:Math.round(quantity*unit_price*100)/100};
  });
  const total=Number(payload?.total),paid=Number(payload?.paid),due=Number(payload?.due??0),waived=Number(payload?.waived??0);
  if([total,paid,due,waived].some(n=>!Number.isFinite(n)||n<0))
   throw new Error('Invalid invoice amount');
  if(Math.abs(total-paid-due-waived)>0.06)throw new Error('Bill payment breakdown does not match total.');
  if(Math.abs(total-lines.reduce((n,i)=>n+i.total,0))>0.06)throw new Error('Bill items do not match saved total.');
  return {
   restaurantId:id,link,restaurantName:clean(payload?.restaurantName||'Restaurant',100),
   restaurantAddress:clean(payload?.restaurantAddress||'',200),
   restaurantPhone:clean(payload?.restaurantPhone||'',30),
   customerName:clean(payload?.customerName||'',100),phone:clean(payload?.phone||'',25),
   orderCode:clean(payload?.orderCode||'',75),items:lines,total,paid,due,waived,
   date:payload?.date||new Date().toISOString()
  };
 }
 function marketingMessage(raw){
  const p=validatedBill(raw);
  const customer=p.customerName?' '+p.customerName.split(/\s+/)[0]:'';
  return [
   '🙏 Namaste'+customer+'!',
   '*'+p.restaurantName+'* par aane ke liye shukriya! ❤️',
   '🧾 Bill '+(p.orderCode?'*'+p.orderCode+'* ':'')+'• '+money(p.total)+' — neeche item-wise details hain.',
   '',
   '🍽️ *Agli baar restaurant aaye bina bhi apna favourite khana order karein!*',
   'Hamare menu se dishes chunein, aur available ho to delivery ya pickup select karein.',
   '',
   '👇 *'+p.restaurantName+' ka online menu:*',
   p.link,
   '',
   '💚 Phir milenge! — Team '+p.restaurantName
  ].join('\n');
 }
 // Fallback for browsers that cannot share an actual image/PDF attachment.
 // Keep the full itemized bill in the message; never replace a bill with only advertising.
 function billMessage(raw){
  const p=validatedBill(raw);
  return [
   '🧾 '+p.restaurantName+' | Bite Bill',
   p.orderCode?'Bill: '+p.orderCode:null,
   p.customerName?'Customer: '+p.customerName:null,
   'Items:',
   ...p.items.map(i=>'• '+i.name+' × '+i.quantity+' — '+money(i.total)),
   'Total: '+money(p.total),
   'Received: '+money(p.paid),
   p.waived>0?'Waived: '+money(p.waived):null,
   p.due>0?'Balance due: '+money(p.due):null,
   '',
   marketingMessage(p)
  ].filter(x=>x!==null).join('\n');
 }
 function whatsAppUrl(mobile,message){
  const digits=normalizeIndianMobile(mobile);
  if(!digits)throw new Error('Valid customer WhatsApp mobile number required.');
  if(!message||typeof message!=='string')throw new Error('Message required');
  return 'https://wa.me/'+digits+'?text='+encodeURIComponent(message);
 }
 function fileName(raw,ext){
  const p=validatedBill(raw),rid=p.orderCode.replace(/[^A-Za-z0-9-]/g,'').slice(0,55)||'Bill';
  return p.restaurantName.replace(/[^A-Za-z0-9 -]/g,'').trim().replace(/\s+/g,'-').slice(0,45)+'-'+rid+'.'+ext;
 }
 function drawReceiptCanvas(raw){
  if(typeof document==='undefined')throw new Error('Bill image requires a browser.');
  const p=validatedBill(raw),W=960,M=54,H=Math.max(1150,660+p.items.length*61+210),canvas=document.createElement('canvas');
  canvas.width=W;canvas.height=H;const g=canvas.getContext('2d');
  if(!g)throw new Error('Receipt image unavailable');
  g.fillStyle='#fff';g.fillRect(0,0,W,H);g.fillStyle='#17283a';g.fillRect(0,0,W,185);
  const text=(s,x,y,font='26px system-ui,sans-serif',color='#17283a',limit=W-2*M)=>{
   g.fillStyle=color;g.font=font;g.fillText(String(s),x,y,limit);
  };
  const wrap=(s,x,y,maxWidth,font='24px system-ui,sans-serif',color='#334155',step=36)=>{
   g.font=font;let line='',cy=y;
   for(const word of String(s||'').split(/\s+/)){
    const candidate=line?line+' '+word:word;
    if(g.measureText(candidate).width>maxWidth&&line){text(line,x,cy,font,color,maxWidth);cy+=step;line=word;}
    else line=candidate;
   }
   if(line){text(line,x,cy,font,color,maxWidth);cy+=step;}
   return cy;
  };
  text(p.restaurantName,M,77,'bold 44px system-ui,sans-serif','#fff');
  text('THANK YOU FOR VISITING  •  BITE',M,130,'bold 21px system-ui,sans-serif','#fbbf85');
  text('CUSTOMER BILL',M,233,'bold 31px system-ui,sans-serif');
  text(p.orderCode||'POS receipt',M,277,'bold 24px system-ui,sans-serif','#475569');
  const day=new Date(p.date);
  text(!Number.isNaN(day.getTime())?day.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'',M,315,'22px system-ui,sans-serif','#64748b');
  let y=357;
  if(p.restaurantAddress)y=wrap(p.restaurantAddress,M,y,W-2*M,'20px system-ui,sans-serif','#64748b',30);
  if(p.restaurantPhone){text('Restaurant: '+p.restaurantPhone,M,y,'20px system-ui,sans-serif','#64748b');y+=34;}
  text('Customer: '+(p.customerName||'Walk-in customer'),M,y,'23px system-ui,sans-serif');y+=52;
  g.fillStyle='#edf1f5';g.fillRect(M,y,W-2*M,49);
  text('ITEM / QTY',M+14,y+33,'bold 21px system-ui,sans-serif','#334155');
  text('AMOUNT',W-M-150,y+33,'bold 21px system-ui,sans-serif','#334155');
  y+=75;
  for(const i of p.items){
   text(i.name,M+10,y,'bold 24px system-ui,sans-serif','#17283a',580);
   const value=money(i.total);g.font='bold 23px system-ui,sans-serif';
   text(value,W-M-g.measureText(value).width,y,'bold 23px system-ui,sans-serif','#17283a');
   y+=29;text(i.quantity+' × '+money(i.unit_price),M+10,y,'21px system-ui,sans-serif','#64748b');y+=32;
   g.strokeStyle='#e8edf1';g.beginPath();g.moveTo(M,y);g.lineTo(W-M,y);g.stroke();
  }
  y+=37;
  function totalRow(label,value,bold=false){
   const font=bold?'bold 31px system-ui,sans-serif':'24px system-ui,sans-serif';
   text(label,M,y,font);g.font=font;
   const v=money(value);text(v,W-M-g.measureText(v).width,y,font);y+=44;
  }
  totalRow('Bill total',p.total,true);
  totalRow('Payment received',p.paid);
  if(p.waived>0)totalRow('Waived amount',p.waived);
  if(p.due>0)totalRow('Amount due',p.due,true);
  const promoTop=Math.max(y+38,H-265);
  g.fillStyle='#eefaf2';g.fillRect(M,promoTop,W-2*M,H-promoTop-45);
  text('🍽️ ORDER AGAIN FROM '+p.restaurantName.toUpperCase(),M+20,promoTop+51,'bold 24px system-ui,sans-serif','#10613e');
  wrap('Apna favourite khana ab online order karein!',M+20,promoTop+93,W-2*M-40,'22px system-ui,sans-serif','#12613e');
  const urlParts=p.link.replace('https://','').replace('?',' ?').split(/\s+/);
  let urlY=promoTop+135;
  for(const part of urlParts)urlY=wrap(part,M+20,urlY,W-2*M-40,'18px system-ui,sans-serif','#18714e',27)+3;
  text('Bite • Eat. Repeat.  |  Digital bill · Not a tax invoice',M,H-18,'18px system-ui,sans-serif','#64748b');
  return canvas;
 }
 function jpegBlob(canvas){
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Bill image could not be generated')),'image/jpeg',0.91));
 }
 async function createBillImageFile(raw){
  const canvas=drawReceiptCanvas(raw),blob=await jpegBlob(canvas);
  return new File([blob],fileName(raw,'jpg'),{type:'image/jpeg'});
 }
 async function createBillPdfFile(raw,pdfEncoder){
  if(typeof pdfEncoder!=='function')throw new Error('PDF generator unavailable');
  const canvas=drawReceiptCanvas(raw),pageHeight=1360,parts=[];
  for(let start=0;start<canvas.height;start+=pageHeight){
   const slice=document.createElement('canvas');slice.width=canvas.width;slice.height=pageHeight;
   const ctx=slice.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,slice.width,slice.height);
   ctx.drawImage(canvas,0,start,canvas.width,Math.min(pageHeight,canvas.height-start),0,0,canvas.width,Math.min(pageHeight,canvas.height-start));
   parts.push(new Uint8Array(await (await jpegBlob(slice)).arrayBuffer()));
  }
  const pdf=pdfEncoder(parts,canvas.width,pageHeight);
  return new File([pdf],fileName(raw,'pdf'),{type:'application/pdf'});
 }
 function canNativeShare(file,nav){
  return Boolean(file&&nav&&typeof nav.share==='function'&&typeof nav.canShare==='function'&&nav.canShare({files:[file]}));
 }
 const api=Object.freeze({normalizeIndianMobile,directRestaurantUrl,validatedBill,marketingMessage,billMessage,whatsAppUrl,fileName,drawReceiptCanvas,createBillImageFile,createBillPdfFile,canNativeShare});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else root.BiteDirectOrder=api;
})(typeof window!=='undefined'?window:globalThis);
