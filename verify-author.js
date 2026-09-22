'use strict';
if(require.main===module)require('./pipeline-lock').guard('verify:author');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const author=require('./author.json');
const decode=text=>String(text).replace(/&(amp|quot|apos|lt|gt);/g,(_,name)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'})[name]);
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const theme of ['light','dark']){
      const page=await browser.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      const url=new URL(process.env.PAP_SITE_URL||process.argv[2]||'http://127.0.0.1:8787/');
      url.searchParams.set('scoutTheme',theme);url.hash='author';
      await page.goto(url.href);
      await page.waitForFunction(()=>document.getElementById('authorDetails')?.textContent.includes('last updated'));
      assert.equal(await page.locator('#author h2').textContent(),author.name);
      assert.equal(await page.locator('#authorIntroduction').textContent(),author.headline);
      const text=await page.locator('#authorDetails').textContent();
      for(const paragraph of author.bio)assert(text.includes(decode(paragraph)),'Authored biography is retained.');
      for(const role of author.roles)assert(text.includes(decode(role.org))&&text.includes(decode(role.detail)));
      for(const talk of author.talks){
        assert(text.includes(decode(talk.title))&&text.includes(decode(talk.venue))&&text.includes(decode(talk.blurb)));
        assert.equal(await page.locator(`#authorDetails a[href="${talk.url}"]`).count(),1);
      }
      assert.equal(await page.locator('#authorProfile').getAttribute('href'),author.linkedin);
      assert.deepEqual(errors,[]);await page.close();
    }
  }finally{await browser.close();}
  console.log('RESULT: PASS - exact author biography, headline, roles, appearance titles/venues/blurbs and original links in both themes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
