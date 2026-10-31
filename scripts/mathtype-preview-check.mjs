/** Preview/release gate: existing Word regressions plus MathType export UI/application integration. */
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';

const started=Date.now();
function run(args,label,timeout=660000){
  const r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:48*1024*1024,timeout,env:process.env});
  process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
  const output=r.stdout||'';
  const failures=[...output.matchAll(/^not ok[^\n]*\n(?:.*\n){0,45}/gm)].map(m=>m[0].slice(0,4500)).slice(0,8);
  return {label,ok:r.status===0&&!r.error,exitCode:r.status,error:r.error?.message||null,
    failures,summary:output.split('\n').filter(l=>/^# (tests|pass|fail|skipped|cancelled|duration_ms)/.test(l))};
}

const legacy=run(['scripts/check-word-import-release.mjs'],'existing-word-release-gate');
const previewIntegration=legacy.ok
  ? run(['--import','tsx','--test','--test-reporter=tap',
      'tests/word-mathtype-export-app.test.mjs',
      'tests/word-mathtype-export-preview-ui.test.mjs'],
      'mathtype-preview-integration')
  : {label:'mathtype-preview-integration',ok:false,skippedBecause:'existing Word release gate failed'};

const report={
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
  console.error('WORD/MATHTYPE PREVIEW NOT READY. Build stopped because a mandatory gate failed.');
  process.exit(1);
}
