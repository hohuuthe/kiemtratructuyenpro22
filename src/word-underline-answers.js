// Word underline choice recognition. Works with original OOXML reader marker spans.
export function stripWordImportMarks(value) {
  return String(value ?? '').replace(/\[\[\/?(?:U|B)\]\]/g, '');
}

export function scanWordImportMarks(input) {
  const source = String(input ?? ''), underline = [], bold = [], errors = [];
  const active = {U:0,B:0};
  const marker = /^\[\[(\/?)(U|B)\]\]/;
  let text = '';
  for (let i = 0; i < source.length;) {
    const hit = source.slice(i).match(marker);
    if (hit) {
      const key = hit[2];
      if (hit[1]) {
        if (active[key]) active[key]--; else errors.push('Thẻ ' + key + ' đóng không có thẻ mở.');
      } else active[key]++;
      i += hit[0].length;
    } else {
      text += source[i]; underline.push(active.U > 0); bold.push(active.B > 0); i++;
    }
  }
  for (const key of ['U','B']) if (active[key]) errors.push('Thẻ ' + key + ' chưa được đóng.');
  return {text,underline,bold,errors};
}

export function wordMarkerCoverage(scan, from, to, marker = 'underline') {
  let total = 0, marked = 0;
  const flags = marker === 'bold' ? scan.bold : scan.underline;
  for (let i = from; i < to;) {
    if (scan.text.startsWith('__WMATH_',i)) {
      const token = scan.text.slice(i).match(/^__WMATH_[0-9]{6}__/);
      if (token) {i += token[0].length;continue;}
    }
    if (scan.text[i] === '<') {
      const end = scan.text.indexOf('>',i+1);
      if (end >= 0 && end < to) {i = end+1;continue;}
    }
    if (/[\p{L}\p{N}]/u.test(scan.text[i])) {total++;if(flags[i])marked++;}
    i++;
  }
  return {total,marked};
}

export function extractWordMarkedChoices(raw, marker = 'underline') {
  const scan = scanWordImportMarks(raw);
  const matches = [...scan.text.matchAll(/(^|\t| {2,}|\n)([A-D])\s*[.):：]/gi)];
  const spans = matches.map((m,idx) => {
    const begin = m.index + m[0].length;
    const end = matches[idx+1]?.index ?? scan.text.length;
    return {
      letter:m[2].toUpperCase(),
      prefixMarked:Boolean((marker==='bold'?scan.bold:scan.underline)[m.index+m[1].length]),
      text:scan.text.slice(begin,end).trim(),
      coverage:wordMarkerCoverage(scan,begin,end,marker)
    };
  });
  return {spans,before:matches.length ? scan.text.slice(0,matches[0].index).trim():scan.text.trim(),errors:scan.errors,scan};
}

export function parseWordUnderlinedOptionLines(lines, startIndex, type) {
  const options = Object.fromEntries(['A','B','C','D'].map(k=>[k,{text:'',image:'',present:false,prefixMarked:false,total:0,marked:0}]));
  const issues = [], stem=[], letters=['A','B','C','D'];
  let active='',stemImage='',i=startIndex;
  for (;i<lines.length;i++) {
    const line=lines[i]||{}, raw=String(line.text??''), flat=stripWordImportMarks(raw).trim();
    if (/^Câu\s*\d+[:.]?/i.test(flat)||/^Đáp án\s*[:.]?/i.test(flat))break;
    const parsed=extractWordMarkedChoices(raw,'underline');
    for(const msg of parsed.errors)issues.push('Dòng '+(i+1)+': '+msg);
    if(parsed.spans.length) {
      if(parsed.before) {
        if(active)issues.push('Dòng '+(i+1)+': Văn bản đứng trước nhãn phương án không xác định được.');
        else stem.push(parsed.before);
      }
      if(line.image && parsed.spans.length>1)issues.push('Dòng '+(i+1)+': Ảnh nằm cạnh nhiều phương án.');
      for(const span of parsed.spans) {
        const current=options[span.letter];
        if(current.present)issues.push('Dòng '+(i+1)+': Phương án '+span.letter+' bị lặp nhãn.');
        current.present=true; current.prefixMarked ||= span.prefixMarked;
        current.total+=span.coverage.total;current.marked+=span.coverage.marked;
        current.text+=(current.text?'\n':'')+span.text;active=span.letter;
        if(line.image&&parsed.spans.length===1) {
          if(current.image)issues.push('Dòng '+(i+1)+': Phương án '+active+' có nhiều ảnh.');
          else current.image=line.image;
        }
      }
    } else if(active) {
      const current=options[active];
      const coverage=wordMarkerCoverage(parsed.scan,0,parsed.scan.text.length,'underline');
      current.total+=coverage.total;current.marked+=coverage.marked;
      if(parsed.before)current.text+=(current.text?'\n':'')+parsed.before;
      if(line.image) {
        if(current.image)issues.push('Dòng '+(i+1)+': Phương án '+active+' có nhiều ảnh.');
        else current.image=line.image;
      }
    } else {
      if(parsed.before)stem.push(parsed.before);
      if(line.image) {
        if(stemImage)issues.push('Dòng '+(i+1)+': Thân câu hỏi có nhiều ảnh chưa gắn rõ vị trí.');
        else stemImage=line.image;
      }
    }
  }
  for(const letter of letters) {
    const option=options[letter];
    if(!option.present)issues.push('Thiếu phương án '+letter+'.');
    else if(!option.text.trim()&&!option.image)issues.push('Phương án '+letter+' thiếu nội dung.');
  }
  const marked=letters.filter(k=> {
    const o=options[k];return o.present && (o.prefixMarked||(o.total>0&&o.marked===o.total));
  });
  if(type==='4-1' && marked.length>1)issues.push('Có nhiều đáp án gạch chân: '+marked.join(', ')+'.');
  const partialOnly=letters.filter(k=> {
    const o=options[k];return o.marked>0&&o.marked<o.total&&!o.prefixMarked;
  });
  return {options,nextIndex:i,marked,partialOnly,allFourMarked:marked.length===4,issues,stemText:stem.join('\n'),stemImage};
}
