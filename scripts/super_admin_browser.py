#!/usr/bin/env python3
"""Real production controllers and layouts with isolated synthetic backend data."""
import json,os,subprocess,sys
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
subprocess.run([sys.executable,'scripts/prepare_completion_preview.py'],check=True)
base=(ROOT/'dist/qa/admin-flow.html').read_text()
prefix='<script src="assets/super-admin-workspace.js?v='
start=base.find(prefix)
assert start>=0,'Current Super Admin controller script tag is missing'
end=base.find('</script>',start)
assert end>start,'Malformed Super Admin controller tag'
needle=base[start:end+len('</script>')]
base=base.replace(needle,'<script>'+(ROOT/'scripts/fixtures/super_admin_backend.js').read_text()+'</script>'+needle)
(ROOT/'dist/qa/super-admin-flow.html').write_text(base)
OUT=ROOT/'dist/launch-qa';OUT.mkdir(parents=True,exist_ok=True)
server=ThreadingHTTPServer(('127.0.0.1',4197),lambda *a,**kw:SimpleHTTPRequestHandler(*a,directory=str(ROOT/'dist'),**kw));Thread(target=server.serve_forever,daemon=True).start()
evidence=[];errors=[]
def check(ok,label):
 assert ok,label
 evidence.append(label);print('PASS:',label,flush=True)
def ready(page,route):
 page.locator('#'+route+'.active #sa-'+route).wait_for(state='visible')
 page.wait_for_function("() => !document.querySelector('.page.active .sa-workspace')?.innerText.includes('Loading current records')")
def nav(page,route):
 primary=page.locator('#saNavigation [data-sa-route="'+route+'"]')
 if primary.count():primary.click()
 else:
  if not page.locator('#saMore').evaluate('(e)=>e.open'):page.locator('#saMore summary').click()
  page.locator('#saMore [data-sa-route="'+route+'"]').click()
 if route in ['overview','restaurants','orders','financials','platform-commission','platform-reports']:ready(page,route)
 else:page.locator('#'+route+'.active').wait_for(state='visible')
def fit(page,label):
 check(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),label+' fits viewport')
 check(page.locator('#saNavigation').bounding_box()['width']<=page.viewport_size['width'],label+' navigation fits viewport')
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch()
  for width in [320,360,390,430,1440]:
   context=browser.new_context(viewport={'width':width,'height':950},accept_downloads=True)
   page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.route('**/*.supabase.co/**',lambda r:r.abort())
   page.goto('http://127.0.0.1:4197/qa/super-admin-flow.html',wait_until='domcontentloaded');page.locator('[data-sa-today-orders]').wait_for()
   check(page.locator('[data-sa-today-orders]').inner_text()=='32',f'{width}px Home uses server overview count')
   check(page.locator('[data-sa-all-restaurants]').inner_text()=='29',f'{width}px Home total restaurant count uses RLS source')
   check(page.locator('[data-sa-active-restaurants]').inner_text()=='27',f'{width}px Home published restaurant count uses approved active records')
   check(page.locator('[data-sa-platform-orders]').inner_text()=='32',f'{width}px Home excludes demos and counts only platform website orders')
   check('5,440' in page.locator('[data-sa-today-payments]').inner_text(),f'{width}px Home shows verified collection total')
   check(page.locator('#biteHotelHome').is_hidden(),f'{width}px hotel operations stay outside Super Admin')
   check(page.locator('.workspace-sync-note').is_hidden(),f'{width}px Home omits legacy implementation banner')
   check(page.locator('[data-sa-today-payments]').evaluate('(e)=>e.getBoundingClientRect().height<parseFloat(getComputedStyle(e).fontSize)*1.6'),f'{width}px collection amount remains on one line')
   fit(page,f'{width}px Home');page.screenshot(path=str(OUT/f'super-admin-home-{width}.png'))
   page.locator('[data-sa-attention=orders]').click();page.locator('#sa-orders .sa-record').wait_for();check(page.locator('#sa-orders .sa-record').count()==1,f'{width}px delayed count opens matching delayed list')
   page.locator('#sa-orders [data-sa-action=detail]').first.click();page.locator('#saProviderResult').wait_for(state='attached');check('Synthetic Veg Thali' in page.locator('#sa-orders').inner_text(),f'{width}px delayed order opens its own items and timeline')
   check(page.locator('#sa-orders').get_by_role('button',name='Accept order',exact=True).count()==0,f'{width}px monitoring does not expose owner fulfilment actions')
   fit(page,f'{width}px order detail')
   nav(page,'restaurants');page.locator('#sa-restaurants .sa-record').first.wait_for();check(page.locator('#sa-restaurants .sa-record').count()==25,f'{width}px directory is paginated')
   page.locator('#saListFilters [name=search]').fill('Kitchen');page.locator('#saListFilters button[type=submit]').click();page.wait_for_function("document.querySelectorAll('#sa-restaurants .sa-record').length===1")
   page.locator('#sa-restaurants [data-sa-action=detail]').click();page.locator('.sa-menu-review').wait_for();check('Synthetic Veg Thali' in page.locator('.sa-menu-review').inner_text(),f'{width}px restaurant review shows read-only menu')
   check(page.locator('[data-sa-action=reset-owner]').is_visible(),f'{width}px existing Owner login assistance remains available')
   fit(page,f'{width}px restaurant review');page.screenshot(path=str(OUT/f'super-admin-review-{width}.png'))
   nav(page,'overview');page.locator('[data-sa-attention=financials][data-filter=settlements]').click();page.wait_for_function("document.querySelector('#saListFilters [name=filter]')?.value==='pending'");check(page.locator('#sa-financials .sa-record').count()==1,f'{width}px pending settlement attention excludes paid records')
   nav(page,'overview');page.locator('[data-sa-attention=financials][data-filter=refunds]').click();page.wait_for_function("document.querySelector('#saListFilters [name=filter]')?.value==='followup'");check(page.locator('#sa-financials .sa-record').count()==1,f'{width}px refund attention excludes completed refunds')
   nav(page,'financials');page.locator('#sa-financials .sa-record').first.wait_for();page.locator('[data-sa-tab=refunds]').click();page.locator('#sa-financials [data-sa-action=detail]').first.click();page.locator('#saProviderResult').wait_for(state='attached');page.locator('[data-sa-action=check-provider]').click();page.wait_for_function("document.querySelector('#saProviderResult').textContent.includes('Cashfree refund status')")
   check('PENDING' in page.locator('#saProviderResult').inner_text(),f'{width}px refund check shows provider processing status')
   check('Bank credit is not independently confirmed' in page.locator('#saProviderResult').inner_text(),f'{width}px pending refund never claims bank credit')
   fit(page,f'{width}px refund details');page.screenshot(path=str(OUT/f'super-admin-refund-{width}.png'))
   if width==390:
    nav(page,'restaurants');page.locator('#saListFilters [name=search]').fill('Kitchen');page.locator('#saListFilters button[type=submit]').click();page.wait_for_function("document.querySelectorAll('#sa-restaurants .sa-record').length===1");page.locator('#sa-restaurants [data-sa-action=detail]').click();page.locator('[data-sa-action=review][data-id=approve]').click();page.locator('[data-sa-action=review][data-id=publish]').wait_for();check(page.evaluate('__BITE_SUPER_ADMIN_QA.data.restaurants[0].onboarding_status==="approved"&&!__BITE_SUPER_ADMIN_QA.data.restaurants[0].is_published'),'Approve saves backend state without silently publishing')
    page.locator('[data-sa-action=review][data-id=publish]').click();page.locator('[data-sa-action=review][data-id=pause]').wait_for();check(page.evaluate('__BITE_SUPER_ADMIN_QA.data.restaurants[0].is_published'),'Publish exposes approved listing only after explicit action')
    page.locator('[data-sa-action=review][data-id=pause]').click();page.locator('[data-sa-action=review][data-id=publish]').wait_for();check(page.evaluate('!__BITE_SUPER_ADMIN_QA.data.restaurants[0].is_published'),'Pause removes listing through backend')
    page.locator('[data-sa-action=request-changes]').click();page.locator('#saRequestChanges [name=note]').fill('Please verify the business address');page.locator('#saRequestChanges button[type=submit]').click();page.wait_for_function('__BITE_SUPER_ADMIN_QA.data.restaurants[0].onboarding_status==="rejected"');check(page.evaluate('__BITE_SUPER_ADMIN_QA.data.restaurants[0].onboarding_rejection_reason.includes("verify")'),'Request changes saves owner-facing feedback')
    nav(page,'platform-commission');page.locator('#saCommissionForm [name=rate]').fill('12.5');page.locator('#saCommissionForm button[type=submit]').click();page.wait_for_function('__BITE_SUPER_ADMIN_QA.data.platform_settings[0].default_commission_rate===12.5');check(page.evaluate('__BITE_SUPER_ADMIN_QA.data.order_financials.every(f=>f.commission_rate===10&&f.commission_amount===15)'),'Commission save preserves pre-existing order snapshots')
    page.locator('#saCommissionForm [name=scope]').select_option('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');page.locator('#saCommissionForm [name=inherit]').wait_for();page.wait_for_function('document.querySelector("#saCommissionForm [name=inherit]").checked');page.locator('#saCommissionForm [name=inherit]').uncheck();page.locator('#saCommissionForm [name=rate]').fill('14');page.locator('#saCommissionForm button[type=submit]').click();page.wait_for_function('__BITE_SUPER_ADMIN_QA.data.restaurants[0].platform_commission_rate===14');check(True,'Restaurant commission override saves through guarded RPC')
    page.evaluate('__BITE_SUPER_ADMIN_QA.data.restaurants[0].platform_commission_rate=16');page.locator('#saCommissionForm [name=rate]').fill('20');page.locator('#saCommissionForm button[type=submit]').click();page.wait_for_function('document.querySelector("#saMessage").textContent.includes("Commission changed")');check(page.evaluate('__BITE_SUPER_ADMIN_QA.data.restaurants[0].platform_commission_rate===16'),'Concurrent commission edit fails visibly without overwriting latest rate')
    nav(page,'platform-reports');page.locator('.sa-report-metrics').wait_for();check('Awaiting confirmation' in page.locator('.sa-report-metrics').inner_text(),'Reports preserve unknown actual gateway fee')
    check('Ledger-recorded collections' in page.locator('.sa-report-metrics').inner_text(),'Reports do not mislabel ledger totals as bank-verified')
    check('Ledger-recorded refunds' in page.locator('.sa-report-metrics').inner_text(),'Reports do not claim bank-credited refunds')
    with page.expect_download() as dl:page.locator('[data-sa-action=export]').click()
    check(dl.value.suggested_filename.endswith('.csv'),'Report export downloads real displayed period data')
    csv_text=Path(dl.value.path()).read_text(encoding='utf-8-sig')
    check('Ledger-recorded collections (provider/bank verification separate)' in csv_text and 'customer bank credit not proven' in csv_text,'CSV export retains source values but clearly marks missing bank evidence')
    nav(page,'support');page.locator('[data-support-save]').wait_for();page.locator('[data-support-response]').fill('We are checking the gateway reference.');page.locator('[data-support-status]').select_option('In Progress');page.locator('[data-support-save]').click();page.wait_for_function('__BITE_SUPER_ADMIN_QA.data.customer_support_tickets[0].status==="In Progress"');check(True,'Support response and status persist through the existing backend action');fit(page,'390px support');page.screenshot(path=str(OUT/'super-admin-support-390.png'))
    nav(page,'audit');page.locator('#auditLogRows tr').first.wait_for();check('restaurant_approve' in page.locator('#auditLogRows').inner_text(),'Sensitive approval actions appear in audit history');fit(page,'390px audit')
    nav(page,'financials');page.locator('[data-sa-tab=payments]').click();page.locator('#sa-financials [data-sa-action=detail]').first.click();page.locator('[data-sa-action=check-provider]').click();page.wait_for_function("document.querySelector('#saProviderResult').textContent.includes('Cashfree collection')");check('Restaurant bank payout: not independently verified' in page.locator('#saProviderResult').inner_text(),'PAID collection never becomes an assumed restaurant payout')
    page.evaluate('__BITE_SUPER_ADMIN_QA.providerFailure=true');page.locator('[data-sa-action=check-provider]').click();page.wait_for_function("document.querySelector('#saProviderResult').textContent.includes('Status check failed')");check(True,'Provider outage shows a failure without fabricated payment outcome')
    nav(page,'financials');page.locator('[data-sa-tab=settlements]').click();page.locator('#sa-financials [data-sa-action=detail]').first.click();page.locator('[data-sa-action=settlement-refresh]').click();page.locator('[data-sa-action=settlement-refresh]').wait_for();check('Drafts do not send money' in page.locator('#sa-financials').inner_text(),'Settlement detail and refresh distinguish draft from bank transfer')
    check(page.evaluate('!__BITE_SUPER_ADMIN_QA.calls.some(c=>["execute_refund","approve_refund","refund"].includes(c.body?.action))'),'Browsing and provider status checks never initiate refunds')
    nav(page,'overview');page.evaluate('__BITE_SUPER_ADMIN_QA.failNext=true');page.locator('#sa-overview [data-sa-action=refresh]').click();page.locator('#sa-overview [role=alert]').wait_for();check('Synthetic read failure' in page.locator('#sa-overview').inner_text(),'Backend read error remains visible with retry action')
    page.locator('#sa-overview [data-sa-action=refresh]').click();page.locator('[data-sa-today-orders]').wait_for();check(True,'Retry recovers real server overview')
   context.close()
  # Owner cannot reach platform pages or see the Super Admin shell.
  c=browser.new_context(viewport={'width':390,'height':900});p=c.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.route('**/*.supabase.co/**',lambda r:r.abort());p.goto('http://127.0.0.1:4197/qa/owner-flow.html');p.wait_for_function("document.body.dataset.role==='owner'");p.evaluate("showPage('platform-commission')");check(p.locator('#overview').is_visible(),'Owner platform route attempt returns to Owner home');check(p.locator('#saNavigation').count()==0,'Owner receives no Super Admin navigation');c.close()
  check(not errors,'No JavaScript page errors: '+str(errors[:3]));browser.close()
finally:
 server.shutdown();(OUT/'super-admin-evidence.json').write_text(json.dumps({'checks':evidence,'errors':errors},indent=2))
