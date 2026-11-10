/* A self-contained PDF receipt. Canvas keeps Hindi and ₹ readable without a remote font or PDF service. */
(function(root){
 'use strict';
 const enc=s=>new TextEncoder().encode(s);
 function pdfFromJpegs(images,width=1190,height=1684){
  if(!images.length)throw Error('Receipt has no pages');
  const objects=[],pageIds=images.map((_,i)=>3+i*3);objects[1]=enc('<< /Type /Catalog /Pages 2 0 R >>');objects[2]=enc('<< /Type /Pages /Count '+images.length+' /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] >>');
  const join=parts=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;};
  images.forEach((bytes,i)=>{const page=pageIds[i],content=page+1,image=page+2;objects[page]=enc('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Receipt '+image+' 0 R >> >> /Contents '+content+' 0 R >>');const commands=enc('q 595 0 0 842 0 0 cm /Receipt Do Q');objects[content]=join([enc('<< /Length '+commands.length+' >>\nstream\n'),commands,enc('\nendstream')]);objects[image]=join([enc('<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+bytes.length+' >>\nstream\n'),bytes,enc('\nendstream')]);});
  const parts=[enc('%PDF-1.4\n% Bite receipt\n')],offsets=[0];let length=parts[0].length;
  for(let id=1;id<objects.length;id++){offsets[id]=length;const bytes=join([enc(id+' 0 obj\n'),objects[id],enc('\nendobj\n')]);parts.push(bytes);length+=bytes.length;}
  const xref=length;parts.push(enc('xref\n0 '+objects.length+'\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+objects.length+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n'));return join(parts);
 }
 async function download(data){
  if(!data||!Array.isArray(data.items))throw Error('Invoice data unavailable');await Promise.race([document.fonts?.ready, new Promise(resolve=>setTimeout(resolve,1500))]);
  const pages=[];let canvas,ctx,y;const W=1190,H=1684,M=70;const money=n=>'₹'+Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  function newPage(){canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);ctx.fillStyle='#d92d3a';ctx.font='bold 44px system-ui,sans-serif';ctx.fillText('Bite',M,86);ctx.font='22px system-ui,sans-serif';ctx.fillStyle='#5d6575';ctx.fillText('Eat. Repeat. · '+(data.is_demo?'TEST RECEIPT':'Order receipt'),M,124);ctx.fillStyle='#242936';ctx.font='bold 28px system-ui,sans-serif';ctx.fillText(String(data.order_code||'Order'),M,174);y=220;pages.push(canvas);}
  function text(value,bold=false,size=24){ctx.font=(bold?'bold ':'')+size+'px system-ui,sans-serif';const words=String(value??'').split(/\s+/);let line='';for(const word of words){const next=(line?line+' ':'')+word;if(ctx.measureText(next).width>W-2*M&&line){row(line,bold,size);line=word;}else line=next;}row(line,bold,size);}
  function row(line,bold=false,size=24){if(y>H-150)newPage();ctx.fillStyle='#242936';ctx.font=(bold?'bold ':'')+size+'px system-ui,sans-serif';ctx.fillText(line,M,y,W-2*M);y+=size+14;}
  function amount(label,value,bold=false){if(y>H-150)newPage();ctx.fillStyle='#242936';ctx.font=(bold?'bold ':'')+'25px system-ui,sans-serif';ctx.fillText(label,M,y);const result=money(value);ctx.fillText(result,W-M-ctx.measureText(result).width,y);y+=45;}
  newPage();text(data.restaurant,true,30);if(data.restaurant_address)text(data.restaurant_address,false,22);if(data.phone)text('Restaurant contact: '+data.phone,false,22);text(new Date(data.date).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),false,22);text('Customer: '+(data.customer||'Customer'));text('Payment: '+data.payment_status+' · '+data.status+' · '+data.delivery_type,false,22);y+=15;
  for(const item of data.items){text(item.name,true,24);amount(Number(item.quantity)+' × '+money(item.price),item.total);}
  y+=15;amount('Food subtotal',data.subtotal);amount('Delivery',data.delivery_fee);if(Number(data.discount)>0)amount('Discount'+(data.coupon_code?' ('+data.coupon_code+')':''),-data.discount);if(Number(data.tax)>0)amount('Recorded tax',data.tax);amount('Total',data.total,true);if(Number(data.refund)>0)amount('Provider-confirmed refund',data.refund);y+=18;text('This is an order receipt. A statutory tax invoice, where applicable, must be issued by the responsible registered supplier. No unverified tax or licence number is represented.',false,19);
  const images=[];for(let i=0;i<pages.length;i++){const c=pages[i],g=c.getContext('2d');g.fillStyle='#737b89';g.font='19px system-ui,sans-serif';g.fillText('Bite · '+data.order_code+' · Page '+(i+1)+' of '+pages.length,M,H-55);const blob=await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',0.94));if(!blob)throw Error('PDF image could not be created');images.push(new Uint8Array(await blob.arrayBuffer()));}
  const blob=new Blob([pdfFromJpegs(images,W,H)],{type:'application/pdf'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Bite-'+String(data.order_code).replace(/[^A-Za-z0-9-]/g,'')+'.pdf';a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return blob;
 }
 const api={pdfFromJpegs,download};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.BiteInvoice=api;
})(typeof window!=='undefined'?window:globalThis);
