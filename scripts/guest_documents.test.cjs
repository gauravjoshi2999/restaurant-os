'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../assets/owner-guest-documents.js');
test('document validator rejects empty, oversized and active-content formats',()=>{
 for(const size of [0,-1,D.MAX_BYTES+1,NaN])assert.throws(()=>D.supported({size,type:'image/png'}));
 for(const type of ['image/svg+xml','text/html','application/javascript','application/octet-stream',''])assert.throws(()=>D.supported({size:10,type}));
 for(const type of ['image/jpeg','image/png','application/pdf'])assert.equal(D.supported({size:D.MAX_BYTES,type}),type);
});
test('document header rejects a renamed HTML/SVG file without reading its full body',async()=>{
 await assert.rejects(D.validate(new Blob(['<html>active</html>'],{type:'image/png'})),/contents/);
 await assert.rejects(D.validate(new Blob(['<svg/>'],{type:'application/pdf'})),/contents/);
 assert.equal(D.matchesHeader([255,216,255],'image/jpeg'),true);
 assert.equal(D.matchesHeader([137,80,78,71,13,10,26,10],'image/png'),true);
 assert.equal(D.matchesHeader([37,80,68,70,45],'application/pdf'),true);
});
test('valid masked-copy file signatures remain accepted regardless of original filename',async()=>{
 for(const [bytes,type] of [[[255,216,255,0],'image/jpeg'],[[137,80,78,71,13,10,26,10],'image/png'],[[37,80,68,70,45,49,46,55],'application/pdf']])
  assert.equal(await D.validate(new Blob([new Uint8Array(bytes)],{type})),type);
});
test('private-copy action escapes guest IDs before rendering markup',()=>{
 const html=D.button('x" onclick="evil()');assert(!html.includes('data-doc-guest="x"'));assert(html.includes('&quot;'));
});
test('camera MIME aliases and missing MIME use real file signatures',async()=>{
 for(const type of ['', 'application/octet-stream', 'image/jpg']){
  const file=await D.prepare(new File([new Uint8Array([255,216,255,0])],'synthetic.jpg',{type}));
  assert.equal(file.type,'image/jpeg');assert.equal(file.size,4);
 }
});
test('photo preparation rejects contradictory types, oversized PDFs and unsupported camera formats',async()=>{
 await assert.rejects(D.prepare(new File([new Uint8Array([255,216,255,0])],'wrong.png',{type:'image/png'})),/contents/);
 await assert.rejects(D.prepare(new File(['HEIC synthetic'],'synthetic.heic',{type:'image/heic'})),/JPEG, PNG or PDF/);
 await assert.rejects(D.prepare(new File(['%PDF-',new Uint8Array(D.MAX_BYTES)],'synthetic.pdf',{type:'application/pdf'})),/PDF up to 4 MB/);
});

test('permanent private-copy removal is offered only to the property owner',()=>{
 const ready={id:'doc-1',status:'ready',can_finish:false};
 assert.match(D.rowActions(ready,'owner'),/data-doc-action="remove"/);
 assert.match(D.rowActions(ready,'owner'),/data-doc-action="download"/);
 for(const role of ['manager','receptionist','cashier','']) {
  const html=D.rowActions(ready,role);
  assert.doesNotMatch(html,/data-doc-action="remove"/,role);
  assert.match(html,/data-doc-action="download"/,role);
 }
 const pending={id:'doc-2',status:'pending',can_finish:true};
 assert.match(D.rowActions(pending,'manager'),/data-doc-action="finish"/);
 assert.doesNotMatch(D.rowActions(pending,'manager'),/data-doc-action="remove"/);
});
