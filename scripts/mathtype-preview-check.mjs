/** Isolated qualification probe. Never merge this script into main. */
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
if(process.env.CF_PAGES_BRANCH!=='diag/word-export-mathtype-20261031')throw new Error('Diagnostic branch only');
function execute(args){const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:32*1024*1024,timeout:600000,env:process.env});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');if(r.error)throw r.error;if(r.status!==0)throw new Error('Qualification failed: '+args.join(' ')+'; exit '+r.status);return r.stdout||'';}
const output=execute(['--import','tsx','--test','--test-reporter=tap','tests/word-mathtype-export-app.test.mjs']);
const count=k=>Number([...output.matchAll(new RegExp('^# '+k+' (\\d+)\\s*$','gm'))].at(-1)?.[1]??NaN);
if(count('tests')!==3||count('pass')!==3||count('fail')!==0||count('skipped')!==0)throw new Error('Incomplete application-test evidence');
execute(['scripts/check-word-import-release.mjs']);
fs.mkdirSync('public',{recursive:true});fs.writeFileSync('public/word-export-qualification.json',JSON.stringify({commit:process.env.CF_PAGES_COMMIT_SHA,applicationTests:3,applicationPass:3,legacyGate:'passed',nativeEditorVerified:false,releaseReady:false},null,2)+'\n');
