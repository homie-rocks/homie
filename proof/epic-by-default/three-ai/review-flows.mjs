/** Independent local UI review of the fresh builders' outputs. Does not alter their source. */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const who=process.argv[2], origin=process.argv[3];
const config={sam:{id:'gathering',room:'pantry'},maya:{id:'workshop',room:'shop'},ines:{id:'climb',room:'highline'}}[who];
if(!config||!origin)throw new Error('person and local origin required');
const out=new URL(`./${who}/`,import.meta.url).pathname;mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const errors=[],proof={person:who,origin,at:new Date().toISOString(),browser:'real Google Chrome, emulated phone viewport',checks:[]};
try {
 async function open(name,path,width,height){const ctx=await browser.createBrowserContext(),page=await ctx.newPage();await page.setViewport({width,height,isMobile:name==='phone',hasTouch:name==='phone'});page.on('pageerror',e=>errors.push(e.message));await page.goto(`${origin}/${config.id}/${path}?room=${config.room}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__shell?.arrival?.phase==='done',{timeout:60000});const frame=page.frames().find(f=>/\/__game\//.test(f.url()));if(!frame)throw new Error('app frame missing');return {page,frame};}
 const wall=await open('wall','tv',1920,1080),phone=await open('phone','open',390,844);
 await wall.page.screenshot({path:join(out,'wall-before.png')});await phone.page.screenshot({path:join(out,'phone-before.png')});
 if(who==='sam'){
  await phone.frame.select('#frequency','once');await phone.frame.click('#pledge');await phone.frame.waitForFunction(()=>document.querySelector('#receipt')?.textContent.includes('pledge is saved'));
  proof.checks.push({need:'give once',result:'unpaid intention only',receipt:await phone.frame.$eval('#receipt',e=>e.textContent)});
  await phone.frame.select('#frequency','month');await phone.frame.click('#pledge');await phone.frame.waitForFunction(()=>document.querySelector('#receipt')?.textContent.includes('monthly'));
  proof.checks.push({need:'give monthly',result:'unpaid intention only',receipt:await phone.frame.$eval('#receipt',e=>e.textContent)});
  await phone.frame.click('#signup');await phone.frame.waitForFunction(()=>document.querySelector('#receipt')?.textContent.includes('signed up'));
  proof.checks.push({need:'volunteer shift',result:'saved',receipt:await phone.frame.$eval('#receipt',e=>e.textContent)});
 }
 if(who==='maya'){
  const form=await phone.frame.$('#gear-name');if(form){await form.click({clickCount:3});await form.type('Review blue skis');await phone.frame.select('#gear-kind','skis');await phone.frame.click('#book-tune');await phone.frame.waitForSelector('#my-ticket',{visible:true});}
  proof.checks.push({need:'phone booking',receipt:await phone.frame.$eval('#my-ticket',e=>e.textContent)});
 }
 if(who==='ines'){
  const options=await phone.frame.$$eval('#route option',es=>es.map(e=>e.value).filter(Boolean));if(!options.length)throw new Error('no open route to log');await phone.frame.select('#route',options[0]);await phone.frame.type('#display-name','Review climber');await phone.frame.click('#log-send');await phone.frame.waitForSelector('#receipt',{visible:true});
  proof.checks.push({need:'log a send',receipt:await phone.frame.$eval('#receipt',e=>e.textContent)});
  await wall.frame.waitForFunction(()=>document.querySelector('#latest')?.textContent.includes('Review climber'));
 }
 await new Promise(r=>setTimeout(r,2500));
 await wall.page.screenshot({path:join(out,'wall.png')});await phone.page.screenshot({path:join(out,'phone.png')});
 const receiptSelector=who==='maya'?'#my-ticket':'#receipt'; await phone.frame.$eval(receiptSelector,el=>el.scrollIntoView({block:'center'})); await phone.page.screenshot({path:join(out,'phone-receipt.png')});
 proof.phoneUrl=who==='sam' ? await phone.frame.$eval('#receipt a',el=>el.href) : phone.page.url();proof.wallText=await wall.frame.$eval('body',e=>e.innerText);proof.phoneText=await phone.frame.$eval('body',e=>e.innerText);
 await phone.page.reload({waitUntil:'domcontentloaded'});await phone.page.waitForFunction(()=>window.__shell?.arrival?.phase==='done',{timeout:60000});
 const again=phone.page.frames().find(f=>/\/__game\//.test(f.url()));proof.afterReload=await again.$eval('body',e=>e.innerText);
 await phone.page.screenshot({path:join(out,'phone-reloaded.png')});
 proof.wallLayout=await wall.frame.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
 const followContext=await browser.createBrowserContext(),follow=await followContext.newPage();await follow.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await follow.goto(proof.phoneUrl,{waitUntil:'domcontentloaded'});await follow.waitForFunction(()=>window.__shell?.arrival?.phase==='done',{timeout:60000});
 const followFrame=follow.frames().find(f=>/\/__game\//.test(f.url()));await new Promise(r=>setTimeout(r,1000));proof.secondPhone=await followFrame.$eval('body',e=>e.innerText);await follow.screenshot({path:join(out,'phone-followed.png')});proof.errors=errors;
 writeFileSync(join(out,'review-flow.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({person:who,checks:proof.checks,errors}));
}finally{await browser.close();}
