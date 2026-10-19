import {test} from 'node:test';
import assert from 'node:assert/strict';
import {launchChrome,remoteBrowserEndpoint} from '../lib/chrome.mjs';
test('remote check uses Puppeteer CDP without local Chrome or launch flags',async()=>{
  const calls=[],browser={close(){}};
  const puppeteer={connect:async options=>{calls.push(options);return browser;},launch(){throw Error('Local browser must not launch');}};
  assert.equal(await launchChrome(puppeteer,{executablePath:null,args:['--local-only'],protocolTimeout:123},{env:{HOMIE_BROWSER_WS_ENDPOINT:'wss://browser.example/session'}}),browser);
  assert.deepEqual(calls,[{browserWSEndpoint:'wss://browser.example/session',protocolTimeout:123,defaultViewport:null}]);
});
test('local launch options are preserved',async()=>{
  const options={executablePath:'/chrome',args:['--gpu']};
  assert.equal(await launchChrome({launch:async o=>o},options,{env:{}}),options);
});
test('malformed remote endpoint never falls back to a local browser',()=>{
  for(const endpoint of ['https://browser.example','wss://user:secret@browser.example'])assert.throws(()=>remoteBrowserEndpoint({HOMIE_BROWSER_WS_ENDPOINT:endpoint}));
});
