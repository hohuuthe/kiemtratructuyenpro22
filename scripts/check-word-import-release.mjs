/** Required release gate: every npm build runs this before bundling.
 * No credentials, production API, user database, or browser are accessed here.
 * An evidence marker is emitted ONLY after real lint and tests exit successfully.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const evidence='public/word-import-build-evidence.json';
fs.rmSync(evidence,{force:true});
function run(command,args){
    const r=spawnSync(command,args,{encoding:'utf8',maxBuffer:32*1024*1024,timeout:600000,env:{...process.env,WORD_IMPORT_FULL_TESTS:'1'}});
    if(r.stdout)process.stdout.write(r.stdout);
    if(r.stderr)process.stderr.write(r.stderr);
    if(r.error)throw r.error;
    if(r.status!==0)throw new Error('Word import release gate failed: '+command+' '+args.join(' ')+' (exit '+r.status+')');
    return r.stdout||'';
}
run(process.platform==='win32'?'npm.cmd':'npm',['run','lint']);
const tests=fs.readdirSync('tests').filter(f=>/^word-.*\.test\.mjs$/.test(f)||['scientific-formula-tokenizer.test.mjs','question-bank-word-export.test.mjs','question-bank-fraction-regression.test.mjs'].includes(f)).sort().map(f=>'tests/'+f);
if(!tests.includes('tests/word-mathtype-regression.test.mjs'))throw new Error('MathType regression suite missing');
// Running all Word suites in parallel can exhaust the memory available to Pages build workers.
// Preserve the complete coverage while running test files sequentially.
console.log('Word import release gate: running',tests.length,'test files sequentially');
const output=run(process.execPath,['--import','tsx','--test','--test-concurrency=1','--test-reporter=tap',...tests]);
const total=[...output.matchAll(/^# tests (\d+)\s*$/gm)].at(-1)?.[1];
const passed=[...output.matchAll(/^# pass (\d+)\s*$/gm)].at(-1)?.[1];
const failed=[...output.matchAll(/^# fail (\d+)\s*$/gm)].at(-1)?.[1];
if(!total||!passed||failed!=='0')throw new Error('Incomplete test summary; no release evidence emitted');
fs.mkdirSync(path.dirname(evidence),{recursive:true});
fs.writeFileSync(evidence,JSON.stringify({feature:'mathtype-dsmt4-source-verification',commit:process.env.CF_PAGES_COMMIT_SHA||process.env.GITHUB_SHA||null,lint:'passed',tests:Number(total),passed:Number(passed),failed:0,verifiedAt:new Date().toISOString()},null,2)+'\n');
console.log('Word import release gate passed:',total,'tests.');
