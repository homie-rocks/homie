// Runs ONLY inside the remote VM. This file is platform-owned, never read from the repo.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),zlib=require('node:zlib');
const job=JSON.parse(fs.readFileSync(0,'utf8'));
function run(bin,args,env={}){const r=cp.spawnSync(bin,args,{cwd:'/work',env:{PATH:process.env.PATH,HOME:'/root',CI:'true',...env},encoding:'utf8',maxBuffer:1024*1024,timeout:240000});if(r.status!==0)throw new Error(bin+' failed: '+(r.stderr||r.stdout||r.error).toString().slice(-4000));return r.stdout;}
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
 if(job.previewURL!=='https://hm-s2-dispatch.ryan-d2f.workers.dev')throw new Error('Only test preview checks allowed');
 run('apt-get',['install','-y','-qq','chromium']);
 const result=run('npm',['run','check','--','--url',job.previewURL],{CHROME_PATH:'/usr/bin/chromium'});
 process.stdout.write(zlib.gzipSync(JSON.stringify({commit:job.commit,studio:true,result})).toString('base64'));process.exit(0);
}

const files={};let bytes=0;
function collect(dir,prefix){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw new Error('Symlink output rejected');if(stat.isDirectory())collect(file,prefix+name+'/');else{const b=fs.readFileSync(file);bytes+=b.length;if(bytes>40*1024*1024)throw new Error('Artifact limit');files[prefix+name]=b.toString('base64');}}}
const current=JSON.parse(fs.readFileSync('/work/site/src/runtime/current.json'));
const runtime=path.dirname(path.resolve(current.main));if(!runtime.startsWith('/work/site/src/runtime/'))throw new Error('Runtime outside build');
collect(runtime,'modules/');collect('/work/site/dist','assets/');collect('/work/site/migrations','migrations/');
const output={files,commit:job.commit,node:process.version,toolkit:job.toolkit,lockDigest:job.lockDigest,checks:{build:true},credentialKeys:Object.keys(process.env)};
process.stdout.write(zlib.gzipSync(JSON.stringify(output)).toString('base64'));
