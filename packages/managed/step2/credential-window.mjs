/** Test-only OAuth window. Wait for Wrangler's documented automatic refresh;
 * never copy refresh credentials or alter the operator's shared auth file. */
import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';import {local,run,token,wrangler} from './operator.mjs';
for(let attempt=0;attempt<20;attempt++){
 execFileSync(wrangler,['whoami'],{stdio:'ignore'});
 const config=readFileSync(homedir()+'/Library/Preferences/.wrangler/config/default.toml','utf8');
 const expires=Date.parse(/^expiration_time\s*=\s*"([^"]+)"/m.exec(config)?.[1]);
 if(!Number.isFinite(expires))throw new Error('Test OAuth expiry unavailable');
 if(expires-Date.now()>480000){
  run(['secret','bulk','--config',local+'pipeline.json'],JSON.stringify({DEPLOY_TOKEN:token()}));
  console.log('Trusted test credential has a full build window');process.exit(0);
 }
 if(attempt===0)console.log('Waiting for temporary Wrangler OAuth to refresh before the next build');
 await new Promise(resolve=>setTimeout(resolve,30000));
}
throw new Error('OAuth refresh window exceeded');
