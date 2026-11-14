import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bannerDimensionFeedback, RECOMMENDED_BANNER_SIZES } from '../src/header-banner-dimensions.js';

const file = path => readFileSync(new URL('../' + path,import.meta.url),'utf8');

test('banner design sizes for desktop tablet and mobile stay documented and consistent',()=>{
  assert.deepEqual(
    Object.entries(RECOMMENDED_BANNER_SIZES).map(([name,{width,height}])=>[name,width,height]),
    [['desktop',1920,320],['tablet',1200,300],['mobile',750,360]]
  );
  for(const [device,{width,height}] of Object.entries(RECOMMENDED_BANNER_SIZES)){
    const feedback=bannerDimensionFeedback(device,width,height);
    assert.equal(feedback.status,'good');
    assert.match(feedback.text,new RegExp(String(width)));
    assert.match(feedback.text,new RegExp(String(height)));
    assert.equal(bannerDimensionFeedback(device,width/4,height/4).status,'warning');
  }
});

test('dimension mismatch is advisory and never blocks a valid banner upload',()=>{
  const mismatch=bannerDimensionFeedback('mobile',1920,320);
  assert.equal(mismatch.status,'warning');
  assert.match(mismatch.text,/không cắt hoặc kéo méo/);
  assert.equal(bannerDimensionFeedback('desktop',NaN,320).status,'invalid');
  assert.equal(bannerDimensionFeedback('tablet',1200,0).status,'invalid');
  const js=file('src/header-branding-ui.js');
  assert.match(js,/bannerDimensionFeedback\(sourceDevice, img\.naturalWidth, img\.naturalHeight\)/);
  assert.match(js,/guidance\.dataset\.status = result\.status/);
  assert.doesNotMatch(js,/if \(bannerDimensionFeedback\(/);
});

test('configuration guide provides exact recommended sizes and dynamic feedback',()=>{
  const tab=file('public/components/tab-settings.html');
  for(const label of ['1920 × 320','1200 × 300','750 × 360','Kích thước banner khuyến nghị','settings-banner-dimension-feedback']){
    assert.ok(tab.includes(label),'Missing '+label);
  }
  assert.match(tab,/kích thước <strong>khuyến nghị, không bắt buộc<\/strong>/);
  const css=file('public/header-branding.css');
  assert.match(css,/\.app-header-banner-image\{[^\n]+object-fit:contain/);
  assert.match(css,/\.header-banner-dimension-feedback\[data-status=warning\]/);
  assert.match(css,/@media\s*\(min-width:601px\) and \(max-width:1024px\)/);
  assert.match(css,/@media\(max-width:700px\)/);
});

test('current mobile tablet and desktop variants retain safe desktop fallback',()=>{
  const js=file('src/header-branding-ui.js');
  assert.match(js,/\(max-width: 600px\)/);
  assert.match(js,/\(min-width: 601px\) and \(max-width: 1024px\)/);
  assert.match(js,/if \(image\.getAttribute\('src'\) === targetUrl && targetUrl !== branding\.url\)/);
  assert.match(js,/image\.src = branding\.url/);
});
