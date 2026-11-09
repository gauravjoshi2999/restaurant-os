"""Catch invalid dashboard nesting that makes active pages invisible in a browser."""
from html.parser import HTMLParser
from pathlib import Path
import subprocess

class Dashboard(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sections = []
        self.pages = []
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            assert attrs['id'] not in self.ids, f"Duplicate element id: {attrs['id']}"
            self.ids.add(attrs['id'])
        if tag == 'section':
            page = attrs.get('id') if 'page' in attrs.get('class', '').split() else None
            if page:
                assert not any(self.sections), f"Page {page} is nested inside another page"
                self.pages.append(page)
            self.sections.append(page)

    def handle_endtag(self, tag):
        if tag == 'section':
            assert self.sections, 'Unexpected closing section'
            self.sections.pop()

parser = Dashboard()
parser.feed(Path('index.html').read_text())
assert not parser.sections, 'Unclosed dashboard section'
required = {'overview','orders','menu','tables','khata','cashbook','expenses','purchases','inventory','hr','reports','settings'}
assert required <= set(parser.pages)
for script in Path('assets').glob('owner-*.js'):
    subprocess.run(['node', '--check', str(script)], check=True)
print(f'PASS: {len(parser.pages)} independent dashboard pages, unique ids and Owner script syntax')
