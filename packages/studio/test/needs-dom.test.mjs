import {test} from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {findChrome,chromeArgs} from '../lib/chrome.mjs';
import {actInApp} from '../lib/app-ready.mjs';

test('a refresh during a held press retains navigation when the button stays connected', {timeout:30000},async()=>{
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
 try {
 const page=await browser.newPage();
 const exercise=async replace=>{
  await page.setContent('<main><button id="role">Choose crew</button><output></output></main>');
  await page.evaluate(replace=>{
   const button=document.querySelector('button');
   button.onclick=()=>document.querySelector('output').textContent='Crew selected';
   button.onpointerdown=()=>setTimeout(()=>{
    if(replace){const next=button.cloneNode(true);next.onclick=button.onclick;button.replaceWith(next);}
    else button.textContent='Choose crew (2 places)';
    window.refreshed=true;
   },20);
   window.refreshed=false;
  },replace);
  const box=await (await page.$('button')).boundingBox();
  await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();
  await page.waitForFunction(()=>window.refreshed);await page.mouse.up();
  return page.$eval('output',el=>el.textContent);
 };
 assert.equal(await exercise(true),'','reproduces the cancelled navigation from replacing a held button');
 await page.click('#role');assert.equal(await page.$eval('output',el=>el.textContent),'Crew selected','the replacement has a working click handler; only the interrupted press was lost');
 assert.equal(await exercise(false),'Crew selected');
 // Deterministically replace the actual queried handle between lookup and dispatch.
 let attempts=0;const surface={name:'phone',frame:page.mainFrame()};
 await actInApp(surface,'#role',async frame=>{
  const button=await frame.$('#role');
  if(++attempts===1)await frame.evaluate(()=>{const b=document.querySelector('#role');const next=b.cloneNode(true);next.onclick=()=>document.querySelector('output').textContent='Retried';b.replaceWith(next);});
  try {await button.click();}finally{await button.dispose();}
 },{ready:async()=>{}});
 assert.equal(attempts,2);assert.equal(await page.$eval('output',e=>e.textContent),'Retried');
 }finally{await browser.close();}
});

test('stale action retries are bounded and other failures are never replayed',async()=>{
 const surface={name:'phone',frame:{waitForSelector:async()=>{}}};let calls=0;
 await assert.rejects(actInApp(surface,'#role',async()=>{calls++;throw Error('Node is detached from document');},{ready:async()=>{},timeout:25}),/phone.*#role.*never settled/);
 assert.ok(calls>=2&&calls<5);
 calls=0;await assert.rejects(actInApp(surface,'#pay',async()=>{calls++;throw Error('Execution context was destroyed after navigation');},{ready:async()=>{}}),/context/);assert.equal(calls,1);
});
