// Runs ONLY inside the remote VM. This file is platform-owned, never read from the repo.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),zlib=require('node:zlib');
const job=JSON.parse(fs.readFileSync(0,'utf8'));
function run(bin,args,env={}){const started=Date.now();console.error('stage',bin,args[0],args[1]??'');const r=cp.spawnSync(bin,args,{cwd:'/work',env:{PATH:process.env.PATH,HOME:'/root',CI:'true',...env},encoding:'utf8',maxBuffer:1024*1024,timeout:240000});if(r.status!==0)throw new Error(bin+' failed: '+String(r.stderr+'\n'+r.stdout+'\n'+(r.error??'')).slice(-8000));console.error('finished',bin,Date.now()-started);return r.stdout;}
if(job.mode==='check'&&job.previewURL!=='https://hm-s2-dispatch.ryan-d2f.workers.dev')throw new Error('Only test preview checks allowed');
if(process.version!==job.node)throw new Error('Pinned runtime mismatch');
fs.mkdirSync('/work');
run('apt-get',['update','-qq']);run('apt-get',['install','-y','-qq','git','ca-certificates']);
const auth={GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'2',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Bearer '+job.readToken,GIT_CONFIG_KEY_1:'core.hooksPath',GIT_CONFIG_VALUE_1:'/dev/null'};
run('git',['init']);run('git',['fetch','--depth=1',job.remote,job.commit],auth);
delete job.readToken;
run('git',['checkout','--detach','FETCH_HEAD']);
if(run('git',['rev-parse','HEAD']).trim()!==job.commit)throw new Error('Commit mismatch');
const lock=fs.readFileSync('/work/package-lock.json');
if(crypto.createHash('sha256').update(lock).digest('hex')!==job.lockDigest)throw new Error('Lock mismatch');
const pkg=JSON.parse(fs.readFileSync('/work/package.json'));if(pkg.devDependencies?.['@homie-rocks/studio']!==job.toolkit)throw new Error('Toolkit mismatch');
// No Cloudflare credentials, git auth, mounts, or inherited operator environment.
run('npm',['ci','--no-audit','--no-fund']);
if(JSON.parse(fs.readFileSync('/work/node_modules/@homie-rocks/studio/package.json')).version!==job.toolkit)throw new Error('Installed toolkit mismatch');
run('npm',['run','build']);
if(job.mode==='check'){
 run('apt-get',['install','-y','-qq','--no-install-recommends','chromium'],{DEBIAN_FRONTEND:'noninteractive'});
 // The toolkit's authenticated staff checks deliberately require its local test
 // session. Run that documented dev/check pair inside this disposable VM.
 const config=JSON.parse(fs.readFileSync('/work/studio.json'));
 config.cloudflare={worker:'hm-s2-local-check',d1:'hm-s2-local-check-db',d1Id:'00000000-0000-0000-0000-000000000000',domain:null};
 fs.writeFileSync('/work/studio.json',JSON.stringify(config));
 const log=fs.openSync('/work/check-dev.log','w');
 const dev=cp.spawn('npm',['run','dev','--','--port','8787','--no-local-ai'],{cwd:'/work',env:{PATH:process.env.PATH,HOME:'/root',CI:'true',WRANGLER_SEND_METRICS:'false'},stdio:['ignore',log,log]});
 try {
  let ready=false;
  for(let n=0;n<60;n++){
   const probe=cp.spawnSync('node',['-e',"fetch('http://127.0.0.1:8787/api/games',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"],{timeout:3000,stdio:'ignore'});
   if(probe.status===0){ready=true;break;}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);
  }
  if(!ready)throw new Error('Local VM preview did not start: '+fs.readFileSync('/work/check-dev.log','utf8').slice(-5000));
  const result=run('npm',['run','check','--','--url','http://127.0.0.1:8787'],{CHROME_PATH:'/usr/bin/chromium'});
  process.stdout.write(zlib.gzipSync(JSON.stringify({commit:job.commit,studio:true,location:'isolated-cloudflare-vm-local-preview',result})).toString('base64'));
 }finally{dev.kill('SIGTERM');}
 process.exit(0);
}

const files={};let bytes=0;
function collect(dir,prefix){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw new Error('Symlink output rejected');if(stat.isDirectory())collect(file,prefix+name+'/');else{const b=fs.readFileSync(file);bytes+=b.length;if(bytes>40*1024*1024)throw new Error('Artifact limit');files[prefix+name]=b.toString('base64');}}}
const current=JSON.parse(fs.readFileSync('/work/site/src/runtime/current.json'));
const runtime=path.dirname(path.resolve(current.main));if(!runtime.startsWith('/work/site/src/runtime/'))throw new Error('Runtime outside build');
collect(runtime,'modules/');collect('/work/site/dist','assets/');collect('/work/site/migrations','migrations/');
const credentialProbe=fs.existsSync('/work/hm-s2-credential-proof.json')?JSON.parse(fs.readFileSync('/work/hm-s2-credential-proof.json')):null;
const output={credentialProbe,files,commit:job.commit,node:process.version,toolkit:job.toolkit,lockDigest:job.lockDigest,checks:{build:true},credentialKeys:Object.keys(process.env)};
process.stdout.write(zlib.gzipSync(JSON.stringify(output)).toString('base64'));
