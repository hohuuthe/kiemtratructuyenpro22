import {spawnSync} from 'node:child_process';
if(process.env.CF_PAGES_BRANCH!=='diag/mt121-legacy-20261031')throw new Error('Diagnostic only');
const r=spawnSync(process.execPath,['--import','tsx','--test','--test-reporter=tap','tests/word-mathtype-regression.test.mjs'],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:600000,env:{...process.env,WORD_IMPORT_FULL_TESTS:'1'}});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
if(r.error||r.status!==0)process.exit(r.status||1);
console.log('Only old 41-source regression suite passed; not full release acceptance.');
