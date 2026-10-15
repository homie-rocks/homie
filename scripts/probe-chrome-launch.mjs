// Explicit runner diagnostic, not part of the test inventory.
import puppeteer from 'puppeteer-core';
import {findChrome,chromeArgs} from '../packages/studio/lib/chrome.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
const rows=[];
mkdirSync('ci-results',{recursive:true});
for(let n=0;n<12;n++)for(const pipe of [false,true]){
 const start=performance.now();let browser;
 try{
  browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:chromeArgs().filter(arg=>pipe||arg!=='--remote-debugging-pipe')});
  rows.push({n,pipe,ok:true,launchMs:performance.now()-start});
 }catch(error){rows.push({n,pipe,ok:false,launchMs:performance.now()-start,error:error.message});}
 finally{await browser?.close();writeFileSync('ci-results/chrome-comparison.json',JSON.stringify(rows,null,2));}
 console.log(JSON.stringify(rows.at(-1)));
}
