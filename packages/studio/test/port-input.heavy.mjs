import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import puppeteer from 'puppeteer-core';
import { chromeArgs, findChrome } from '../lib/chrome.mjs';
import { measuredPress, judgePresses, roundClockContinued } from '../lib/port-check.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
test('round clock uses both observation times, including a slow pre-disconnect screenshot', () => {
  const before = { observedAt: 1000, round: { n: 1, leftMs: 30000 } };
  const after = { observedAt: 12000, round: { n: 1, leftMs: 19000 } };
  assert.equal(roundClockContinued(before, after), true);
  assert.equal(roundClockContinued(before, { ...after, round: { n: 1, leftMs: 27000 } }), false);
});

test('real input receipts exclude slow touch delivery and collect enough frames without changing the response limit', { skip: !findChrome(), timeout: 60000 }, async () => {
  const game = `<style>html,body{margin:0;touch-action:none}</style><script>
    let x=0,y=0,dx=0,dy=0,tx=0,ty=0,last=performance.now();const rows=[];window.touchReceipts=[];
    addEventListener('keydown',e=>{dx=e.code==='ArrowRight'?6:0;});addEventListener('keyup',()=>{dx=0;dy=0;});
    addEventListener('touchstart',e=>{tx=e.touches[0].clientX;ty=e.touches[0].clientY;},{passive:true});
    addEventListener('touchmove',e=>{const t=e.touches[0];dx=Math.sign(t.clientX-tx)*6;dy=Math.sign(t.clientY-ty)*6;touchReceipts.push(window.__homieCheckInput.touch);},{passive:true});
    addEventListener('touchend',()=>{dx=0;dy=0;});
    setInterval(()=>{const now=performance.now();x+=dx*(now-last)/1000;if(window.bounded)x=Math.max(-3,Math.min(3,x));y+=dy*(now-last)/1000;last=now;rows.push([now,x,y,1,0,0,-1,0,0]);},125);
    window.__homiePort={now:()=>performance.now(),rows:(a=0)=>rows.filter(r=>r[0]>=a)};
  </script>`;
  const server = createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(req.url.includes('/__game/')?game:'<iframe src="/__game/g" style="position:fixed;left:16px;top:24px;width:600px;height:440px;border:0"></iframe>');});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  let browser, pendingTouch;
  try {
    browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});
    const page=await browser.newPage();await page.setViewport({width:640,height:480,isMobile:true,hasTouch:true});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const frame=page.frames().find(f=>f.url().includes('/__game/'));await frame.waitForFunction('window.__homiePort');await frame.evaluate(()=>window.focus());
    const cdp=await page.createCDPSession();
    let moveDelay=100;
    const h={page,touchAll:true,touch:async(type,points)=>{
      await sleep(type==='touchStart'?800:moveDelay);
      const send=()=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
      // CDP can acknowledge a move before Chrome delivers it to the frame.
      // Make the final ramp event arrive late on every machine, not just CI.
      if(type==='touchMove'&&points[0]?.y===130){pendingTouch=sleep(200).then(send);return;}
      await send();
    }};
    const key=await measuredPress(h,'keys','ArrowRight',[200,200],'right');
    assert.equal(key.a,await frame.evaluate(()=>__homieCheckInput.key));
    assert.ok((await frame.evaluate(a=>__homiePort.rows(a),key.a)).length>=4);
    assert.equal(judgePresses(await frame.evaluate(()=>__homiePort.rows()),[key],.5,'top').ok,true);
    const started=await frame.evaluate(()=>performance.now());
    const touch=await measuredPress(h,'touch','ArrowUp',[200,200],'up');
    assert.ok(touch.a-started>800,'the automation takes over 800 ms to deliver the full gesture');
    // CDP can deliver a queued touchmove after measuredPress captures its receipt.
    // Judge the captured event, not the mutable latest-event timestamp.
    assert.ok((await frame.evaluate(()=>touchReceipts)).includes(touch.a), 'the receipt is an actual delivered touch event');
    const rows=await frame.evaluate(()=>__homiePort.rows());
    assert.equal(judgePresses(rows,[touch],.5,'top').ok,true);
    assert.equal(judgePresses(rows,[{...touch,a:started}],.5,'top').ok,false,'timing from before delivery reproduces the false latency failure');
    const delayed=rows.filter(r=>r[0]>=touch.a).map(r=>[r[0]+800,...r.slice(1)]);
    assert.equal(judgePresses(delayed,[{...touch,b:touch.b+800}],.5,'top').ok,false,'a real response over 600 ms still fails');
    // On software Chrome each ramp event can take hundreds of milliseconds.
    // A multi-event ramp crosses the arena before the final-point receipt starts
    // measurement, falsely reporting working controls as blocked in both directions.
    await frame.evaluate(()=>{window.bounded=true;x=0;});
    moveDelay=350;
    for(const dir of ['left','right']) {
      const press=await measuredPress(h,'touch',dir==='left'?'ArrowLeft':'ArrowRight',[200,200],dir);
      const judged=judgePresses(await frame.evaluate(()=>__homiePort.rows()),[press],.5,'top');
      assert.equal(judged.ok,true,`slow delivery must measure ${dir} before reaching the arena wall: ${JSON.stringify(judged)}`);
    }

  } finally {
    try { await pendingTouch; }
    finally {
      try { await browser?.close(); }
      finally { server.closeAllConnections();await new Promise(r=>server.close(r)); }
    }
  }
});


test('the first changed frame answers a press even when the renderer draws only 2.5 fps', () => {
  const row = (t, x) => [t, x, 0, 1, 0, 0, -1, 0, 0];
  const press = { dir: 'right', a: 50, b: 1650 };
  const immediate = [row(0, 0), row(400, 2), row(800, 4), row(1200, 6), row(1600, 8)];
  const result = judgePresses(immediate, [press], .5, 'top');
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].matchMs, 350);
  const late = [row(0, 0), row(400, 0), row(800, 2), row(1200, 4), row(1600, 6)];
  assert.equal(judgePresses(late, [press], .5, 'top').ok, false, 'a 750 ms response still fails');
});
