/**
 * Run the actual Word release gate before builds. The named diagnostic Preview
 * may publish a FAILED report for inspection; no failed report is release-ready.
 * All other branches (especially main/Production) stop on any test failure.
 */
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const diagnosticBranch='fix/mathtype-121-import-20261031';
const started=Date.now();
const result=spawnSync(process.execPath,['scripts/check-word-import-release.mjs'],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:660000,env:process.env});
process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
const output=result.stdout||'';
const failures=[...output.matchAll(/^not ok[^\n]*\n(?:.*\n){0,45}/gm)].map(m=>m[0].slice(0,4500)).slice(0,8);
const report={commit:process.env.CF_PAGES_COMMIT_SHA||process.env.GITHUB_SHA||null,releaseReady:result.status===0&&!result.error,exitCode:result.status,elapsedMs:Date.now()-started,failures,summary:output.split('\n').filter(l=>/^# (tests|pass|fail|skipped|cancelled|duration_ms)/.test(l)),error:result.error?.message||null};
fs.mkdirSync('public',{recursive:true});fs.writeFileSync('public/mathtype-121-diagnostics.json',JSON.stringify(report,null,2)+'\n');
if(!report.releaseReady){
    console.error('MATHTYPE RELEASE NOT READY. Diagnostic Preview is not acceptance evidence.');
    if(process.env.CF_PAGES_BRANCH!==diagnosticBranch)process.exit(result.status||1);
}
