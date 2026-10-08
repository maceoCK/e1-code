const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const {nativeFixture,available}=require('./native-ui-fixture.cjs');

test('browser start uses real actions, same-tab navigation, persistent dismissals and responsive native theme',{skip:!available},async t=>{
  const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:920,height:680}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await nativeFixture(page,'<main id="fixture" style="height:640px"></main>');
  await page.route('https://native.test/assets/v1/e1-browser-start.js',route=>route.fulfill({path:path.resolve(__dirname,'../src/browser-start.js'),contentType:'text/javascript'}));
  await page.evaluate(async()=>{
    const {aa:h,sa:createRoot}=await import('/assets/v1/vendor-frame-Bk3oL3Qp.js');
    const {zc:Provider}=await import('/assets/v1/shared-frame-mKeNK6Hi.js');
    const {BrowserStart,recordBrowserVisit}=await import('/assets/v1/e1-browser-start.js');
    window.calls=[];window.recordVisit=recordBrowserVisit;
    window.e1NativeTabActions={browser:()=>window.calls.push('browser'),terminal:()=>window.calls.push('terminal'),files:()=>window.calls.push('files'),changes:null};
    window.fixtureRoot=createRoot(document.querySelector('#fixture'));
    window.renderStart=(mode='light')=>window.fixtureRoot.render(h(Provider,{mode,children:h(BrowserStart,{
      onNavigate:url=>window.calls.push(['navigate',url]),onSetUp:()=>window.calls.push('detect'),
    })}));
    window.renderStart();
  });
  const start=page.locator('[data-e1-browser-start]');await start.waitFor();
  assert.equal(await start.getByRole('heading',{name:'Suggested'}).count(),0);
  assert.equal(await start.getByRole('button',{name:'Changes',exact:true}).count(),0);
  await start.getByRole('button',{name:'Terminal',exact:true}).click();
  await start.getByRole('button',{name:'Detect dev server',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.calls),['terminal','detect']);
  const grid=page.locator('.e1-browser-tools');
  assert.equal(await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
  await page.evaluate(()=>{
    window.recordVisit('https://example.com/private?token=secret#fragment');
    window.recordVisit('https://openai.com/');
    window.recordVisit('javascript:alert(1)');
    window.recordVisit('https://user:pass@private.test');
  });
  await start.getByRole('heading',{name:'Suggested'}).waitFor();
  assert.equal(await page.locator('.e1-browser-site').count(),2);
  assert.equal(await page.evaluate(()=>localStorage.getItem('e1.browser.top-sites.v1').includes('secret')),false);
  await start.getByRole('button',{name:'example.com',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),['navigate','https://example.com']);
  await start.getByRole('button',{name:'Dismiss example.com',exact:true}).focus();
  await page.keyboard.press('Enter');
  assert.equal(await start.getByRole('button',{name:'example.com',exact:true}).count(),0);
  await page.evaluate(()=>window.renderStart('dark'));
  await start.getByRole('button',{name:'Undo',exact:true}).click();
  await start.getByRole('button',{name:'example.com',exact:true}).waitFor();
  await start.getByRole('button',{name:'Dismiss example.com',exact:true}).click();
  await page.evaluate(()=>{
    window.e1NativeTabActions={browser:()=>window.calls.push('browser'),changes:()=>Promise.reject(new Error('Review unavailable'))};
    window.dispatchEvent(new Event('e1:tab-actions'));
  });
  await start.getByRole('button',{name:'Changes',exact:true}).click();
  await start.getByRole('alert').waitFor();
  assert.equal(await start.getByRole('alert').textContent(),'Review unavailable');
  assert.equal(await start.getByRole('button',{name:'Terminal',exact:true}).count(),0);
  await page.setViewportSize({width:360,height:600});
  assert.equal(await grid.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
  assert.equal(await start.evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:path.resolve(__dirname,'../evidence/browser-start-narrow.png')});
  await page.setViewportSize({width:920,height:680});
  await page.evaluate(()=>window.renderStart('light'));
  await page.screenshot({path:path.resolve(__dirname,'../evidence/browser-start-light.png')});
  await page.evaluate(()=>window.renderStart('dark'));
  await page.screenshot({path:path.resolve(__dirname,'../evidence/browser-start-dark.png')});
  await page.evaluate(()=>window.fixtureRoot.unmount());
  await page.evaluate(()=>{for(let i=0;i<50;i++)window.dispatchEvent(new Event('e1:tab-actions'));});
  assert.deepEqual(errors,[]);
});

test('browser adapter targets only the new-tab branch and rejects source drift',{skip:!available},()=>{
  const adapter=require('../scripts/patch-browser-start.cjs');
  const capture=path.join(process.env.E1_CAPTURE_ROOT||path.resolve(__dirname,'../../outputs/claude-desktop-decomp'),'full/original/Claude.app/Contents/Resources/ion-dist');
  const source=fs.readFileSync(path.join(capture,adapter.file),'utf8'),patched=adapter.patch(source);
  assert.ok(patched.includes('serverId:o,activeTabId:U,onRun:no'));
  assert.ok(patched.includes('navigatePreview?.(s,url,tab)'));
  assert.ok(patched.includes('a(cr,{onSetUp:o??r,labels:i,detectionActive:c'),'stopped/error preview states remain native');
  assert.throws(()=>adapter.patch(patched));
  assert.throws(()=>adapter.patch(source.replace('e===n&&x(t)','e===n&&x(t+"")')));
});
