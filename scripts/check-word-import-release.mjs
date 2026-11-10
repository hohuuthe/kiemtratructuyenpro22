/** Explicit release gate: no production credentials, APIs or databases are accessed. */
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
const tests=[
    'tests/word-mathtype-121.test.mjs',
    'tests/word-mathtype-regression.test.mjs',
    'tests/word-mathtype-writer-reader-parity.test.mjs',
    'tests/word-mathtype-import.test.mjs',
    'tests/word-import-omml.test.mjs',
    'tests/scientific-formula-tokenizer.test.mjs'
];
console.log('Word import release gate:',tests.length,'test files sequentially');
const output=run(process.execPath,['--import','tsx','--test','--test-concurrency=1','--test-reporter=tap',...tests]);
const value=name=>Number([...output.matchAll(new RegExp('^# '+name+' (\\d+)\\s*$','gm'))].at(-1)?.[1]??NaN);
const total=value('tests'),passed=value('pass'),failed=value('fail'),skipped=value('skipped');
if(!Number.isFinite(total)||total<200||passed!==total||failed!==0||skipped!==0)throw new Error('Incomplete test summary; no release evidence emitted');
fs.mkdirSync(path.dirname(evidence),{recursive:true});
fs.writeFileSync(evidence,JSON.stringify({feature:'mathtype-121-import',commit:process.env.CF_PAGES_COMMIT_SHA||process.env.GITHUB_SHA||null,lint:'passed',tests:total,passed,failed:0,skipped:0,verifiedAt:new Date().toISOString()},null,2)+'\n');
console.log('Word import release gate passed:',total,'tests.');
