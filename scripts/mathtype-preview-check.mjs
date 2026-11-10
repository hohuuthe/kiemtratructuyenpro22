/** Preview/release gate: existing Word regressions plus MathType export UI/application integration. */
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const started=Date.now();
// Additional read-only diagnostic using the supplied classroom DOCX formulas.
// Run only on the dedicated review branch; do not block Preview for findings
// on a document that has not been fully supported yet.
if(process.env.CF_PAGES_BRANCH==='fix/word-mathtype-safe-recovery-20261110'){
  const caseRun=spawnSync(process.execPath,['--import','tsx','scripts/check-on-tap-toan10-omml.mjs'],
    {encoding:'utf8',maxBuffer:1024*1024,timeout:120000,env:process.env});
  fs.mkdirSync('public',{recursive:true});
  fs.writeFileSync('public/qa-on-tap-toan10-execution.json',JSON.stringify({
    exitCode:caseRun.status,passed:caseRun.status===0,
    statusLine:String(caseRun.stdout||'').split('\\n').find(x=>x.includes('math objects:'))||'',
    exception:(caseRun.status===0?'':String(caseRun.stderr||caseRun.error?.message||'').split('\\n').slice(0,5).join('\\n').slice(0,750))
  },null,2)+'\\n');
  console.log('[math10-omml-check] exit='+caseRun.status);
  if(caseRun.stdout)console.log(caseRun.stdout.slice(0,3000));
  if(caseRun.error||caseRun.status!==0)console.error('[math10-omml-check] diagnostic failed: '+String(caseRun.error?.message||caseRun.stderr||'exit '+caseRun.status).slice(0,500));
}

function run(args,label,timeout=660000){
  const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:48*1024*1024,timeout,env:process.env});
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
  const output=r.stdout||'';
  const failures=[...output.matchAll(/^not ok[^\n]*\n(?:.*\n){0,45}/gm)].map(m=>m[0].slice(0,4500)).slice(0,8);
  return {label,ok:r.status===0&&!r.error,exitCode:r.status,error:r.error?.message||null,
    failures,
    // Bounded failure excerpt is generated only for the dedicated diagnostic
    // Preview. No environment variables, secrets or success logs are printed.
    failureDetail:r.status===0?undefined:{
      stderr:String(r.stderr||'').slice(-5000),
      firstFailedTap:output.includes('not ok ')
        ? output.slice(output.indexOf('not ok '),output.indexOf('not ok ')+7500)
        : output.slice(-4000)
    },
    summary:output.split('\n').filter(l=>/^# (tests|pass|fail|skipped|cancelled|duration_ms)/.test(l))};
}

const legacy=run(['scripts/check-word-import-release.mjs'],'existing-word-release-gate');
const previewIntegration=legacy.ok
  ? run(['--import','tsx','--test','--test-reporter=tap',
      'tests/word-mathtype-export-app.test.mjs',
      'tests/word-mathtype-export-preview-ui.test.mjs'],
      'mathtype-preview-integration')
  : {label:'mathtype-preview-integration',ok:false,skippedBecause:'existing Word release gate failed'};

// A dedicated, non-production review deployment may expose failed tests for
// diagnosis. Production and all other branches stay fail-closed. This only
// changes the prebuild gate, never runtime authorization or data access.
const previewBranch='fix/word-mathtype-safe-recovery-20261110';
const diagnosticPreview=process.env.CF_PAGES_BRANCH===previewBranch &&
  process.env.CF_PAGES==='1';
const report={
  previewDiagnosticsOnly:diagnosticPreview,
  commit:process.env.CF_PAGES_COMMIT_SHA||process.env.GITHUB_SHA||null,
  releaseReady:Boolean(legacy.ok&&previewIntegration.ok),
  elapsedMs:Date.now()-started,
  legacy,
  previewIntegration,
  nativeEditorVerified:false,
  productionMathTypeEnabled:false
};
fs.mkdirSync('public',{recursive:true});
fs.writeFileSync('public/mathtype-121-diagnostics.json',JSON.stringify(report,null,2)+'\n');
if(!report.releaseReady){
  console.error('WORD/MATHTYPE RELEASE GATE FAILED. Build blocked in every environment.');
  process.exit(1);
}
