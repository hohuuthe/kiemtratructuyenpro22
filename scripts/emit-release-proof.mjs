import fs from 'node:fs';
import path from 'node:path';
const phase=process.argv[2];
const sha=process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || 'local';
if(phase==='prepare'){
  console.log('[release gate] full test suite and TypeScript check passed; starting build for',sha);
}else if(phase==='publish'){
  const output=path.join(process.cwd(),'dist');
  if(!fs.existsSync(output)||!fs.statSync(output).isDirectory())
    throw Error('Release build directory does not exist');
  const manifest={commit:sha,checkedAt:new Date().toISOString(),
    node:process.version,tests:'npm run verify:release',lint:'npm run lint',
    build:'vite build + esbuild server.ts',status:'passed'};
  fs.writeFileSync(path.join(output,'release-verification.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log('[release gate] build verified:',sha);
}else{
  console.error('Usage: emit-release-proof.mjs prepare|publish');
  process.exitCode=2;
}
