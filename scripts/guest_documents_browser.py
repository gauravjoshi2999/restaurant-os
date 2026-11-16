#!/usr/bin/env python3
"""Private guest copies: actual controllers, synthetic Storage/RPC transport.
Postgres role/storage policy proof runs independently. No real identities uploaded.
"""
import base64,json,os,re,subprocess,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
html=(ROOT/'dist/qa/owner-flow.html').read_text()
needle=re.search(r'<script src="assets/owner-hospitality.js\?[^"\n]+"></script>',html).group()
fixture=(ROOT/'scripts/fixtures/hospitality_backend.js').read_text()
docs=(ROOT/'scripts/fixtures/guest_documents_backend.js').read_text()
html=html.replace(needle,'<script>window.__BITE_HOSPITALITY_TYPE="hotel";</script><script>'+fixture+'</script><script>'+docs+'</script>'+needle)
(ROOT/'dist/qa/document-owner.html').write_text(html)
server=ThreadingHTTPServer(('127.0.0.1',4191),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw))
Thread(target=server.serve_forever,daemon=True).start()
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRSEAAAAASUVORK5CYII=')
evidence=[];errors=[]
def check(ok,label):
 assert ok,label
 evidence.append({'case':label,'status':'PASS','layer':'synthetic Chromium transport'});print('PASS:',label)
def open_copies(page):
 page.evaluate("""async()=>{const q=window.__BITE_HOTEL_QA;q.db.guests=[{id:'90909090-9090-4090-8090-909090909090',property_id:q.property.id,full_name:'Synthetic privacy guest',phone:'9999999999',country:'India'}];await BiteHospitality.reload();showPage('guests')}""")
 page.locator('#guests.active [data-doc-guest]').click();page.locator('[data-document-message]').wait_for(state='hidden')
def file(page,name='synthetic-masked.png',mime='image/png',body=PNG):
 page.locator('[name=copy]').set_input_files({'name':name,'mimeType':mime,'buffer':body});page.locator('[name=redacted_confirmed]').check()
def save(page):page.locator('[data-document-upload] button[type=submit]').click()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch()
  for width in [360,390,1440]:
   page=browser.new_page(viewport={'width':width,'height':900},accept_downloads=True)
   page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
   page.route('**/*.supabase.co/**',lambda r:r.abort());page.route('**/api.cashfree.com/**',lambda r:r.abort())
   page.goto('http://127.0.0.1:4191/qa/document-owner.html',wait_until='domcontentloaded')
   page.wait_for_function("document.body.dataset.businessType==='hotel'");open_copies(page)
   check(page.evaluate('__BITE_DOCUMENT_QA.rows.size')==0,'Opening private copies never uploads a document at '+str(width)+'px')
   file(page,body=b'<html>not a PNG</html>');save(page);page.get_by_text(re.compile('File contents do not match')).wait_for(state='visible')
   check(page.evaluate("__BITE_DOCUMENT_QA.calls.every(c=>c.name==='bite_guest_document_list')"),'Invalid file contents are rejected before creating a document request')
   file(page);page.evaluate('__BITE_DOCUMENT_QA.failFinishAfterCommit=true');save(page)
   page.get_by_text(re.compile('Synthetic interrupted finish response')).wait_for(state='visible');save(page)
   page.get_by_text('Private copy saved.',exact=True).wait_for(state='visible')
   check(page.locator('[data-document-list] article').count()==1,'Interrupted finish retries retain exactly one private copy at '+str(width)+'px')
   check(page.evaluate("__BITE_DOCUMENT_QA.lastUploadOptions.upsert===false&&__BITE_DOCUMENT_QA.lastUploadOptions.cacheControl==='0'"),'Private copy upload disables overwrite and cache retention')
   with page.expect_download() as result:page.locator('[data-doc-action=download]').click()
   download=result.value
   check(Path(download.path()).read_bytes()==PNG,'Authenticated download returns the saved copy bytes')
   check('synthetic-masked' not in download.suggested_filename,'Download filename contains no original identity filename')
   page.get_by_text('Private download started.',exact=True).wait_for(state='visible')
   check(page.evaluate("!JSON.stringify(__BITE_DOCUMENT_QA.calls).includes('synthetic-masked')"),'Original filename is excluded from RPC payloads')
   check(page.evaluate("!JSON.stringify({...localStorage}).includes('synthetic-masked')"),'Copy payload and original filename do not persist in browser storage')
   check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Private copy controls fit '+str(width)+'px')
   page.screenshot(path=str(OUT/f'ui-guest-documents-{width}.png'),full_page=width>760)
   page.evaluate('__BITE_DOCUMENT_QA.deny=true');page.locator('[data-doc-action=download]').click();page.get_by_text('Guest document access denied',exact=True).wait_for(state='visible')
   check(page.evaluate('__BITE_DOCUMENT_QA.downloadCalls')==1,'Revoked access is checked again before fetching retained bytes')
   page.evaluate('__BITE_DOCUMENT_QA.deny=false;__BITE_DOCUMENT_QA.failRemove=true');page.locator('[data-doc-action=remove]').click()
   page.get_by_text('Synthetic deletion not confirmed',exact=True).wait_for(state='visible')
   check(page.locator('[data-document-list] article').count()==1,'Failed removal never reports the retained copy deleted')
   page.locator('[data-doc-action=remove]').click();page.get_by_text('Copy removed.',exact=True).wait_for(state='visible')
   check(page.evaluate("__BITE_DOCUMENT_QA.objects.size===0&&[...__BITE_DOCUMENT_QA.rows.values()].every(d=>d.status==='deleted')"),'Confirmed removal deletes bytes before retiring its metadata')
   file(page);page.evaluate('__BITE_DOCUMENT_QA.failUpload=true');save(page);page.get_by_text(re.compile('Synthetic upload connection lost')).wait_for(state='visible')
   page.locator('[data-doc-action=finish]').click();page.get_by_text('Upload not confirmed',exact=True).wait_for(state='visible')
   check(page.locator('[data-document-list] [data-doc-action=download]').count()==0,'Unfinished upload never offers a confirmed download')
   save(page);page.get_by_text('Private copy saved.',exact=True).wait_for(state='visible')
   check(page.evaluate("[...__BITE_DOCUMENT_QA.rows.values()].filter(d=>d.status==='ready').length") == 1,'Failed upload retries the same document request')
   downloads=[];page.on('download',lambda d:downloads.append(d.suggested_filename))
   page.evaluate('__BITE_DOCUMENT_QA.holdDownload=true');page.locator('[data-doc-action=download]').click()
   page.wait_for_function('typeof __BITE_DOCUMENT_QA.releaseDownload==="function"')
   page.evaluate('BiteHospitality.clear();__BITE_DOCUMENT_QA.releaseDownload()');page.wait_for_function('!BiteGuestDocuments.busy()')
   check(not downloads and page.locator('#biteGuestDocuments').count()==0,'Account/property clear discards an in-flight private download')
   page.close()
  browser.close()
 check(not errors,'No page errors in private-copy workflows')
finally:
 server.shutdown();(OUT/'guest-documents-browser-evidence.json').write_text(json.dumps({'checks':evidence,'page_errors':errors,'scope':'Synthetic browser RPC/Storage. No real identity copy or payment used.'},indent=2))
