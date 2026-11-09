/* Small, dependency-free Excel export and printable bills. */
(function (root) {
  'use strict';
  const encoder = new TextEncoder();
  const xml = value => String(value ?? '').replace(/[<>&"']/g, c =>
    ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
  const join = parts => {
    const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let offset = 0;
    for (const part of parts) { out.set(part, offset); offset += part.length; }
    return out;
  };
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const local = [], central = []; let offset = 0;
    for (const [path, content] of Object.entries(files)) {
      const name = encoder.encode(path), data = encoder.encode(content), crc = crc32(data);
      const header = new Uint8Array(30), h = new DataView(header.buffer);
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      const directory = new Uint8Array(46), d = new DataView(directory.buffer);
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true);
      d.setUint16(8, 0x0800, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true);
      d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
      local.push(header, name, data); central.push(directory, name); offset += header.length + name.length + data.length;
    }
    const directory = join(central), end = new Uint8Array(22), e = new DataView(end.buffer);
    const count = Object.keys(files).length;
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true);
    e.setUint32(12, directory.length, true); e.setUint32(16, offset, true);
    return join([...local, directory, end]);
  }
  function workbook(rows) {
    const sheet = rows.map((row, index) => '<row r="'+(index+1)+'">' + row.map(value =>
      typeof value === 'number' && Number.isFinite(value)
        ? '<c t="n"><v>'+value+'</v></c>'
        : '<c t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>'
    ).join('') + '</row>').join('');
    return zip({
      '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml':'<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Bite Report" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml':'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="12" width="22" customWidth="1"/></cols><sheetData>'+sheet+'</sheetData></worksheet>'
    });
  }
  function download(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], {type}));
    const link = document.createElement('a'); link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function print(title, subtitle, headings, rows, notes = []) {
    const popup = window.open('', '_blank');
    if (!popup) { alert('Bill kholne ke liye browser mein pop-ups allow karein.'); return; }
    popup.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+xml(title)+'</title><style>body{font:14px/1.6 system-ui,sans-serif;color:#222;max-width:900px;margin:40px auto;padding:0 24px}h1{margin-bottom:0;color:#c8442b}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{text-align:left;border-bottom:1px solid #ddd;padding:10px;overflow-wrap:anywhere}th{background:#f7f7f7}tr{break-inside:avoid}.note{color:#555}button{padding:12px 20px;background:#e9563b;color:white;border:0;border-radius:8px;cursor:pointer}@media print{button{display:none}body{margin:0;max-width:none}thead{display:table-header-group}}@page{size:A4;margin:18mm}</style></head><body><h1>'+xml(title)+'</h1><p>'+xml(subtitle)+'</p><button onclick="window.print()">Print / Save PDF</button><table><thead><tr>'+headings.map(h=>'<th>'+xml(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+xml(cell)+'</td>').join('')+'</tr>').join('')+'</tbody></table>'+notes.map(note=>'<p class="note">'+xml(note)+'</p>').join('')+'<p class="note">Bite · Eat. Repeat.</p></body></html>');
    popup.document.close();
  }
  const api = { workbook, download, print };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BiteExports = api;
})(typeof window !== 'undefined' ? window : globalThis);
