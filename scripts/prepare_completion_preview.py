"""Generate isolated UI fixtures from production source; credentials and provider calls are never used."""
from pathlib import Path
import re,shutil
root=Path(__file__).resolve().parents[1];out=root/'dist/qa';out.mkdir(parents=True,exist_ok=True)
backend=(root/'scripts/fixtures/ui_backend.js').read_text()
for name in ['index.html','customer.html','delivery.html','contact.html']:shutil.copy2(root/name,root/'dist'/name)
shutil.copytree(root/'assets',root/'dist/assets',dirs_exist_ok=True)
for role,source in [('customer','customer.html'),('owner','index.html'),('admin','index.html')]:
 html=(root/source).read_text().replace('<head>','<head><base href="/">',1)
 html=re.sub(r'<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js[^\"]*"[^>]*></script>', '<script>window.__BITE_QA_ROLE='+repr(role)+';</script><script>'+backend+'</script>',html)
 assert 'src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js' not in html, 'Test transport injection failed'
 html=re.sub(r'<script src="https://sdk.cashfree.com[^\"]*"></script>','',html)
 html=html.replace('<body ', '<body ',1).replace('>', '>',1)
 html=re.sub(r'(<body\b[^>]*>)',r'\1<div style="position:sticky;top:0;z-index:200000;background:#382d42;color:#fff;padding:9px 14px;font:12px system-ui">QA FIXTURE — synthetic data, no real login, charge, refund, payout or upload</div>',html,count=1)
 (out/(role+'-flow.html')).write_text(html)
 if role=='customer':(out/'pending-customer-flow.html').write_text(html.replace("window.__BITE_QA_ROLE='customer';","window.__BITE_QA_ROLE='customer';window.__BITE_QA_PENDING=true;window.Cashfree=()=>({checkout:async()=>({error:{message: \"Synthetic fixture: never a real charge\"}})});"))
(out/'mobile-customer.html').write_text('<!doctype html><html><head><title>Bite mobile QA preview</title><style>body{margin:0;padding:16px;background:#dfe3eb;display:grid;place-items:start center}iframe{width:390px;height:844px;border:0;border-radius:14px;box-shadow:0 8px 30px #1a243733}</style></head><body><iframe title="Bite mobile QA" src="customer-flow.html"></iframe></body></html>')
print('Prepared three isolated fixture pages and mobile frame.')
