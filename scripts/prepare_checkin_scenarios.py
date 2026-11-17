"""Build a visibly synthetic preview using the production check-in controllers."""
import re, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def prepare():
 subprocess.run([sys.executable,str(ROOT/'scripts/prepare_completion_preview.py')],check=True)
 html=(ROOT/'dist/qa/owner-flow.html').read_text()
 needle=re.search(r'<script src="assets/owner-hospitality.js\?[^"\n]+"></script>',html).group()
 fixtures=''.join('<script>'+(ROOT/'scripts/fixtures'/name).read_text()+'</script>' for name in ['hospitality_backend.js','guest_documents_backend.js','checkin_scenarios.js'])
 html=html.replace(needle,'<script>window.__BITE_HOSPITALITY_TYPE="hotel";</script>'+fixtures+needle)
 path=ROOT/'dist/qa/checkin-personal-review.html';path.write_text(html);return path
if __name__=='__main__':print(prepare())
