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
