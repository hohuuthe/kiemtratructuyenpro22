import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('No persistent passwords; session validated by API',()=>{
 const js=readFileSync('src/main.js','utf8');
 assert.doesNotMatch(js,/localStorage\.(?:setItem|getItem)\(['"]remember_password['"]/);
 assert.match(js,/localStorage\.removeItem\('remember_password'\)/);
 assert.match(js,/fetch\('\/api\/auth\/me'/);
 assert.match(js,/isAdminLoggedIn = roleLower === 'admin'/);
 assert.doesNotMatch(js,/onclick="zoomImage\('\$\{/);
 assert.doesNotMatch(js,/localStorage\.setItem\('appSettings', JSON\.stringify\(appSettings\)\)/);
 const endpoint=readFileSync('functions/api/auth/me.ts','utf8');
 assert.doesNotMatch(endpoint,/a\.password/);
 assert.match(endpoint,/context\.data\?\.authUser/);
});
