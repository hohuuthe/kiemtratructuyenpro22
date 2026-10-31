/** Isolated build-time qualification probe. Never merge this script into main. */
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
if(process.env.CF_PAGES_BRANCH!=='diag/word-export-mathtype-20261031')throw new Error('Diagnostic branch only');
const run=(args)=>{const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:16*1024*1024,timeout:360000,env:process.env});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');const out=r.stdout||'';const count=k=>Number([...out.matchAll(new RegExp('^# '+k+' (\\d+)\\s*$','gm'))].at(-1)?.[1]??NaN);return {success:r.status===0&&!r.error,exitCode:r.status,error:r.error?.message||null,tests:count('tests'),pass:count('pass'),fail:count('fail'),skipped:count('skipped'),failures:[...out.matchAll(/^not ok[^\n]*\n(?:.*\n){0,45}/gm)].slice(0,8).map(m=>m[0].slice(0,5000)),stderr:(r.stderr||'').slice(-4000)};};
const application=run(['--import','tsx','--test','--test-reporter=tap','tests/word-mathtype-export-app.test.mjs']);
const legacy=run(['scripts/check-word-import-release.mjs']);
fs.mkdirSync('public',{recursive:true});
fs.writeFileSync('public/word-export-qualification.json',JSON.stringify({commit:process.env.CF_PAGES_COMMIT_SHA||null,nativeEditorVerified:false,releaseReady:false,application,legacy},null,2)+'\n');
console.log('Diagnostic report only; preview success does NOT qualify MathType for production.');
