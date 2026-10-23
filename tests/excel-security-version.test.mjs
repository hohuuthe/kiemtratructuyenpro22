import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
test('Patched SheetJS preserves Unicode, numeric values and formula text on XLSX roundtrip',()=>{
  assert.equal(XLSX.version,'0.20.3');
  const rows=[['Ho va ten','Diem','Cong thuc'],['Nguy\u1ec5n V\u0103n A',9.25,'$x^2+1$'],['Zero',0,'H2O']];
  const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'KTTT');
  const bytes=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});
  const decoded=XLSX.read(bytes,{type:'buffer'});
  assert.deepEqual(XLSX.utils.sheet_to_json(decoded.Sheets.KTTT,{header:1,raw:true}),rows);
});
