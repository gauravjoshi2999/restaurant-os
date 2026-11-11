"""Package only public runtime files. QA fixtures, source docs, SQL and credentials are excluded."""
from pathlib import Path
import shutil
import os
import json
root=Path(__file__).resolve().parents[1];out=root/'dist/site'
if out.exists():shutil.rmtree(out)
out.mkdir(parents=True)
for name in ['index.html','customer.html','delivery.html','contact.html','robots.txt','sitemap.xml','android-update-check.js','android-updates.json']:
 source=root/name
 if source.exists():shutil.copy2(source,out/name)
shutil.copytree(root/'assets',out/'assets',ignore=shutil.ignore_patterns('*.md'))
sha = os.environ.get('BITE_DEPLOY_SHA', '')
if len(sha) == 40 and all(ch in '0123456789abcdef' for ch in sha):
 for name in ('index.html', 'customer.html'):
  page = out/name
  if page.is_file():
   page.write_text(page.read_text(encoding='utf-8').replace('__BITE_BUILD_SHA__', sha), encoding='utf-8')
 (out/'bite-deploy-version.json').write_text(json.dumps({'sha': sha}), encoding='utf-8')
assert (out/'index.html').is_file()
assert not (out/'supabase').exists() and not (out/'scripts').exists() and not (out/'qa').exists()
print('Packaged public runtime files in dist/site; test fixtures and source records excluded.')
