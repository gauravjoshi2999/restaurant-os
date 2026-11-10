"""Package only public runtime files. QA fixtures, source docs, SQL and credentials are excluded."""
from pathlib import Path
import shutil
root=Path(__file__).resolve().parents[1];out=root/'dist/site'
if out.exists():shutil.rmtree(out)
out.mkdir(parents=True)
for name in ['index.html','customer.html','delivery.html','contact.html','robots.txt','sitemap.xml']:
 source=root/name
 if source.exists():shutil.copy2(source,out/name)
shutil.copytree(root/'assets',out/'assets',ignore=shutil.ignore_patterns('*.md'))
assert (out/'index.html').is_file()
assert not (out/'supabase').exists() and not (out/'scripts').exists() and not (out/'qa').exists()
print('Packaged public runtime files in dist/site; test fixtures and source records excluded.')
