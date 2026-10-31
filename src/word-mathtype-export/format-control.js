/** UI component for the later integration stage. Not attached to existing modals. */
import {MATHTYPE_EXPORT_QUALIFICATION} from '../word-export-format.js';
export function createWordEquationFormatControl(doc=document){
  const fieldset=doc.createElement('fieldset');fieldset.className='space-y-2 rounded-xl border p-3';
  const legend=doc.createElement('legend');legend.className='px-1 font-semibold';legend.textContent='Ki\u1ec3u c\u00f4ng th\u1ee9c trong file Word';fieldset.append(legend);
  const unique='word-equation-format-'+crypto.randomUUID();
  const inputs=[];
  for(const [value,text] of [['equation','Equation Word \u2014 m\u1eb7c \u0111\u1ecbnh, gi\u1eef c\u01a1 ch\u1ebf hi\u1ec7n t\u1ea1i'],['mathtype','MathType OLE \u2014 ch\u1ec9nh s\u1eeda b\u1eb1ng MathType']]){
    const label=doc.createElement('label');label.className='flex items-start gap-2';
    const input=doc.createElement('input');input.type='radio';input.name=unique;input.value=value;input.checked=value==='equation';
    if(value==='mathtype')input.disabled=!MATHTYPE_EXPORT_QUALIFICATION.enabled||!MATHTYPE_EXPORT_QUALIFICATION.nativeEditorVerified;
    const span=doc.createElement('span');span.textContent=text;label.append(input,span);fieldset.append(label);inputs.push(input);
  }
  if(inputs[1].disabled){const note=doc.createElement('p');note.className='text-sm text-amber-700';note.textContent='MathType ch\u01b0a b\u1eadt: c\u1ea7n nghi\u1ec7m thu m\u1edf, s\u1eeda v\u00e0 l\u01b0u b\u1eb1ng Word + MathType th\u1ef1c t\u1ebf.';fieldset.append(note);}
  return {element:fieldset,value:()=>inputs.find(i=>i.checked)?.value||'equation'};
}
