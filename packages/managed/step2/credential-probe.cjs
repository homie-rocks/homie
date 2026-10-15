// This adversarial probe is copied INTO the tenant repo and run as owner build code.
const fs=require('node:fs');
(async()=>{
 const forbidden=Object.keys(process.env).filter(k=>/CLOUDFLARE|DEPLOY_TOKEN|OPERATOR_KEY|BUILD_KEY|RUN_KEY|AWS_SECRET/.test(k));
 const credentials=['/root/.wrangler/config/default.toml','/root/.config/.wrangler/config/default.toml','/Users/ryan/Library/Preferences/.wrangler/config/default.toml'].filter(p=>fs.existsSync(p));
 const denied=await fetch('https://hm-s2-pipeline.ryan-d2f.workers.dev/status',{signal:AbortSignal.timeout(10000)});
 if(forbidden.length||credentials.length||denied.status!==404)throw new Error('Build credential boundary failed');
 fs.writeFileSync('hm-s2-credential-proof.json',JSON.stringify({forbiddenEnv:forbidden,operatorCredentialFiles:credentials,controlWithoutCredential:denied.status}));
})().catch(e=>{console.error(e.message);process.exit(1)});
