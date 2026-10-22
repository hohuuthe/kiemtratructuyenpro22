/** Non-destructive parser for scientific formula catalogs pasted into exam questions. */
export function splitLabeledScientificRecords(value) {
  const input = String(value ?? '');
  const pattern = /(?:^|\s)(?=(?:MAT|PHY|CHE|BIO|CS|ENG|GEO|ECO|MED|AST|GEN|STR|EX)-\d{3}\s*\|)/g;
  const cuts = [];
  for (const match of input.matchAll(pattern)) {
    const i = match.index + match[0].length;
    if (!cuts.includes(i)) cuts.push(i);
  }
  if (!cuts.length) return null;
  const records = [];
  const prefix = input.slice(0, cuts[0]).trim();
  if (prefix) records.push({type:'text',value:prefix});
  for (let n = 0; n < cuts.length; n++) {
    const raw = input.slice(cuts[n], n + 1 < cuts.length ? cuts[n+1] : input.length).trim();
    const parsed = /^([A-Z]{2,3}-\d{3})\s*\|\s*([^|\n]+?)\s*\|\s*([\s\S]+)$/.exec(raw);
    if (parsed) records.push({type:'record',id:parsed[1],label:parsed[2].trim(),formula:parsed[3].trim()});
    else records.push({type:'text',value:raw});
  }
  return records.some(x => x.type === 'record') ? records : null;
}
