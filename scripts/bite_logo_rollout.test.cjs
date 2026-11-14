const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('Selected founder-approved logo images exist and use real binary formats',()=>{
 const word=fs.readFileSync('assets/bite-selected-wordmark.webp');
 const icon=fs.readFileSync('assets/bite-selected-icon.png');
 assert.equal(word.toString('ascii',0,4),'RIFF');
 assert.equal(word.toString('ascii',8,12),'WEBP');
 assert.equal(icon.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.ok(word.length>10000&&icon.length>8000);
});

test('Customer, Owner, Admin, Super Admin and QR share the identical chosen Bite brand',()=>{
 for(const page of ['index.html','customer.html','owner-feedback.html','menu-qr.html','menu-qr-card.html',
                   'delivery.html','contact.html','delivery-test.html','cashfree-sandbox-test.html']){
   const html=fs.readFileSync(page,'utf8');
   assert.ok(html.includes('assets/bite-selected-wordmark.webp'),page+' lacks chosen logo');
   assert.ok(html.includes('assets/bite-selected-logo-rollout.css'),page+' lacks rollout styles');
   assert.ok(html.includes('assets/bite-selected-icon.png'),page+' lacks icon');
 }
 const owner=fs.readFileSync('index.html','utf8');
 assert.match(owner,/bite-dashboard-brand/);
 assert.match(owner,/assets\/bite-selected-wordmark\.webp/);
 const customer=fs.readFileSync('customer.html','utf8');
 assert.match(customer,/class="bite-logo"/);
 assert.match(customer,/assets\/bite-selected-wordmark\.webp/);
 const qr=fs.readFileSync('menu-qr.html','utf8');
 assert.match(qr,/class="bite-qr-menu"/);
 assert.match(qr,/assets\/bite-selected-wordmark\.webp/);
 const card=fs.readFileSync('menu-qr-card.html','utf8');
 assert.match(card,/class="bite-qr-print"/);
 assert.match(card,/ctx\.drawImage\(logo,212,841,476,196\)/);
 assert.match(card,/src="assets\/bite-selected-wordmark\.webp"/);
 assert.doesNotMatch(card,/class="qr-brand-text"/);
});

test('Old SVG logo URLs remain compatible for cached pages and external links',()=>{
 for(const path of ['bite-logo.svg','bite-logo-on-dark.svg','bite-menu-brand.svg','bite-app-icon.svg','bite-menu-brand-mark.svg']){
  const svg=fs.readFileSync('assets/'+path,'utf8');
  assert.match(svg,/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg,/data:image\/(png|webp);base64,/);
 }
});
test('Next signed Android builds generate native Bite launcher icons from same approved PNG',()=>{
 const wf=fs.readFileSync('.github/workflows/bite-android-signed-manual.yml','utf8');
 assert.match(wf,/Apply founder-selected Bite launcher icon/);
 assert.match(wf,/assets\/bite-selected-icon\.png/);
 assert.match(wf,/ic_launcher\.png/);
 assert.match(wf,/ic_launcher_round\.png/);
 assert.match(wf,/ic_launcher_foreground\.png/);
 assert.match(wf,/app: \[customer, partner, admin\]/);
});
