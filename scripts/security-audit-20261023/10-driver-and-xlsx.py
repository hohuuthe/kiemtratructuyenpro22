from pathlib import Path
import subprocess
p=Path('tests/security-release-acceptance.test.ts');s=p.read_text()
a="const which=connection===urls.a?'a':connection===urls.b?'b':null;"
assert a in s
s=s.replace(a,"const parsed=new URL(connection || '');\n    assert.equal(parsed.username,'fixture');assert.equal(parsed.password,'fixture');\n    const which=parsed.hostname==='tenant-a.invalid'&&parsed.pathname==='/testa'?'a':parsed.hostname==='tenant-b.invalid'&&parsed.pathname==='/testb'?'b':null;")
p.write_text(s)
# Maintainer's official distribution. The npm registry xlsx 0.18.5 is obsolete.
subprocess.run(['npm','install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund','https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz'],check=True)
subprocess.run(['git','add','package-lock.json'],check=True)
Path('tests/excel-security-version.test.mjs').write_text('''import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
test('Patched SheetJS preserves Unicode, numeric values and formula text on XLSX roundtrip',()=>{
  assert.equal(XLSX.version,'0.20.3');
  const rows=[['Ho va ten','Diem','Cong thuc'],['Nguy\\u1ec5n V\\u0103n A',9.25,'$x^2+1$'],['Zero',0,'H2O']];
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'KTTT');
  const bytes=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
  const decoded=XLSX.read(bytes,{type:'buffer'});
  assert.deepEqual(XLSX.utils.sheet_to_json(decoded.Sheets.KTTT,{header:1,raw:true}),rows);
});
''')
