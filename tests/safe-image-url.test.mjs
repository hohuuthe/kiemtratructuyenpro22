import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedImageUrl,escapeImageSource} from '../src/safe-image-url.js';
test('Images cannot break out of attributes or embed executable document URLs',()=>{
 for(const value of ['javascript:alert(1)','https://example.invalid/a" onerror="alert(1)','data:image/svg+xml;base64,PHN2Zz4=','//evil.invalid/x','https://name:pass@example.invalid/x'])assert.equal(normalizedImageUrl(value),'');
 assert.equal(normalizedImageUrl('data:image/png;base64,iVBORw0KGgo='),'data:image/png;base64,iVBORw0KGgo=');
 assert.equal(escapeImageSource('https://images.invalid/x?a=1&b=2'),'https://images.invalid/x?a=1&amp;b=2');
});
