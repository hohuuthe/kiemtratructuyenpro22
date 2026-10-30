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

export function parseWordMarkedOptionLines(lines, startIndex, type, marker = 'underline') {
  if (!['underline','bold'].includes(marker)) throw new Error('Unsupported Word answer format');
  const options = Object.fromEntries(['A','B','C','D'].map(k=>[k,{text:'',image:'',present:false,prefixMarked:false,total:0,marked:0}]));
  const issues = [], stem=[], letters=['A','B','C','D'];
  let active='',stemImage='',i=startIndex;
  for (;i<lines.length;i++) {
    const line=lines[i]||{}, raw=String(line.text??''), flat=stripWordImportMarks(raw).trim();
    if (/^Câu\s*\d+[:.]?/i.test(flat)||/^Đáp án\s*[:.]?/i.test(flat))break;
    const parsed=extractWordMarkedChoices(raw,marker);
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
      const coverage=wordMarkerCoverage(parsed.scan,0,parsed.scan.text.length,marker);
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
  const fullContent=letters.filter(k=>{
    const q=options[k];
    return q.present && q.total>0 && q.marked===q.total;
  });
  const markedPrefixes=letters.filter(k=>options[k].present && options[k].prefixMarked);
  const partialOnly=letters.filter(k=>{
    const q=options[k];
    return q.marked>0 && q.marked<q.total && !q.prefixMarked;
  });
  let marked=letters.filter(k=>options[k].present && (options[k].prefixMarked||fullContent.includes(k)));
  const ambiguities=[];
  if(marker==='bold') {
    const decorativeLabels=markedPrefixes.length===4;
    if(fullContent.length===4) {
      marked=[];
      ambiguities.push('Cả bốn phương án đều in đậm nội dung; cần dòng Đáp án: để xác định ý đúng.');
    } else if(fullContent.length>0) {
      if(type==='4-1') {
        const conflicting=markedPrefixes.filter(k=>!fullContent.includes(k));
        if(conflicting.length && !decorativeLabels) {
          marked=[];
          ambiguities.push('Nhãn in đậm ('+conflicting.join(', ')+') mâu thuẫn với nội dung in đậm ('+fullContent.join(', ')+').');
        } else {
          marked=fullContent;
        }
      } else {
        // TF4 may legitimately mark one true statement by its letter
        // and another by its entire body. Uniform bold A-D labels
        // are decoration and do not contribute true statements.
        marked=decorativeLabels?fullContent:[...new Set([...markedPrefixes,...fullContent])].sort();
      }
    } else if(decorativeLabels) {
      marked=[];
      ambiguities.push('Cả bốn nhãn A-D đều in đậm; đây có thể là kiểu trình bày, không được đoán đáp án.');
    } else {
      marked=markedPrefixes;
    }
    if(type==='4-1' && marked.length>1) {
      ambiguities.push('Có nhiều phương án in đậm ('+marked.join(', ')+') cho câu chỉ có một đáp án.');
      marked=[];
    }
    const formulaOnlyEvidence=marked.filter(k=>fullContent.includes(k) &&
      !markedPrefixes.includes(k) && /__WMATH_[0-9]{6}__/.test(options[k].text));
    if(formulaOnlyEvidence.length) {
      ambiguities.push('Phương án '+formulaOnlyEvidence.join(', ')+' chứa Equation Word; chữ đậm ngoài công thức chưa xác nhận định dạng bên trong Equation. Cần ghi Đáp án:.');
      marked=[];
    }
  } else if(type==='4-1' && marked.length>1) {
    issues.push('Có nhiều đáp án gạch chân: '+marked.join(', ')+'.');
  }
  return {
    options,nextIndex:i,marked,fullContent,markedPrefixes,partialOnly,
    allFourMarked:marked.length===4,ambiguities,issues,stemText:stem.join('\n'),stemImage
  };
}
export function parseWordUnderlinedOptionLines(lines, startIndex, type) {
  return parseWordMarkedOptionLines(lines,startIndex,type,'underline');
}
export function parseWordBoldOptionLines(lines, startIndex, type) {
  return parseWordMarkedOptionLines(lines,startIndex,type,'bold');
}
