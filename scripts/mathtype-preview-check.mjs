/** Temporary isolated diagnostic branches only. Never merge this probe into main. */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const branch=process.env.CF_PAGES_BRANCH;
const modes={
 'diag/mt121-import-20261031':{pattern:'Actual DOCX|All 24 questions',files:['tests/word-mathtype-121.test.mjs'],minimum:2},
 'diag/mt121-export-20261031':{pattern:'All 121 native equations re-export',files:['tests/word-mathtype-121.test.mjs'],minimum:1},
 'diag/mt121-legacy-20261031':{files:['tests/word-mathtype-regression.test.mjs','tests/word-mathtype-import.test.mjs','tests/word-import-omml.test.mjs','tests/scientific-formula-tokenizer.test.mjs'],minimum:10}
};
const mode=modes[branch];
if(!mode)throw new Error('Diagnostic branch only; not authorized as a release build');
const args=['--import','tsx','--test','--test-concurrency=1','--test-reporter=tap'];
if(mode.pattern)args.push('--test-name-pattern='+mode.pattern);
args.push(...mode.files);
const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:32*1024*1024,timeout:600000,env:{...process.env,WORD_IMPORT_FULL_TESTS:'1'}});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
const count=n=>Number([...(r.stdout||'').matchAll(new RegExp('^# '+n+' (\\d+)\\s*$','gm'))].at(-1)?.[1]??NaN);
const success=r.status===0&&!r.error&&count('fail')===0&&count('pass')>=mode.minimum;
fs.mkdirSync('public',{recursive:true});
fs.writeFileSync('public/mathtype-diagnostic-probe.json',JSON.stringify({branch,scope:mode,success,releaseReady:false,pass:count('pass'),fail:count('fail'),skipped:count('skipped')},null,2));
if(!success)process.exit(r.status||1);
console.log('Selected diagnostic tests passed. This is NOT a full release check.');
