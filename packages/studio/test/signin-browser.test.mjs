import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import puppeteer from 'puppeteer-core';
import {findChrome,chromeArgs} from '../lib/chrome.mjs';
import {ownerRoutes} from '../worker/stats-page.mjs';
import {arrivalCard} from '../worker/arrival.mjs';

test('opening an office link signs the browser in directly, while a preview spends nothing',{timeout:15000},async t=>{
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 sql.exec('CREATE TABLE stats_keys(hash TEXT PRIMARY KEY,kind TEXT,expires_at INTEGER)');
 const key='hsk_'+'b'.repeat(48);sql.prepare('INSERT INTO stats_keys VALUES(?,?,?)').run(createHash('sha256').update(key).digest('hex'),'signin',Date.now()+60000);
 const stmt=(q,args=[])=>({bind:(...a)=>stmt(q,a),first:async()=>sql.prepare(q).get(...args),run:async()=>({meta:{changes:sql.prepare(q).run(...args).changes}})});
 const env={DB:{prepare:stmt,batch:async xs=>Promise.all(xs.map(x=>x.run()))}};
 let cookie;
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,`http://localhost:${server.address().port}`);
  if(url.pathname==='/postcards/open'){cookie=req.headers.cookie;res.end('Your postcards');return;}
  const request=new Request(url,{method:req.method,headers:req.headers});
  const response=await ownerRoutes(request,env,url,{catalogueOf:async()=>({studio:{name:'Cards'},games:[]})});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
 }catch(error){res.writeHead(500);res.end(error.message);}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>(server.closeAllConnections(),server.close(r))));
 const origin=`http://localhost:${server.address().port}`,url=origin+'/_studio/signin?k='+key+'&to='+encodeURIComponent('/postcards/open?room=party');
 assert.equal((await fetch(url)).status,200);assert.equal(sql.prepare("SELECT count(*) n FROM stats_keys WHERE kind='signin'").get().n,1);
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});t.after(()=>browser.close());
 const page=await browser.newPage();await page.goto(url);
 await page.waitForFunction(()=>location.pathname==='/postcards/open',{timeout:2000});
 assert.equal(page.url(),origin+'/postcards/open?room=party');assert.ok(cookie?.startsWith('studio_owner='));
 assert.equal(sql.prepare("SELECT count(*) n FROM stats_keys WHERE kind='signin'").get().n,0);
});

test('an app wall uses app join wording and retains its own control text',{timeout:15000},async t=>{
 const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs()});t.after(()=>browser.close());const page=await browser.newPage();
 const app={kind:'app',id:'cards',name:'Cards',words:{join:'Scan to join'}};
 await page.setContent(arrivalCard({studio:{}},app,{screen:true}).html);
 assert.equal(await page.$eval('[data-for="tv"]',el=>el.textContent),'Scan to join');
 await page.setContent(arrivalCard({studio:{}},{...app,landing:{controls:{tv:'Our own invitation'}}},{screen:true}).html);
 assert.equal(await page.$eval('[data-for="tv"]',el=>el.textContent),'Our own invitation');
});
