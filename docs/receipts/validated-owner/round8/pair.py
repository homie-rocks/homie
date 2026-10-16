import os,sys,json,time,subprocess
from pathlib import Path
P='/tmp/pt9'
PAIR_SOURCE=Path(__file__).read_bytes()
tag=sys.argv[1];args=sys.argv[2:];script='cmp6.mjs'
if '--script' in args:
 i=args.index('--script');script=args[i+1];del args[i:i+2]
log=Path('/tmp/pt9/batch.log')
def record(s):
 with log.open('a') as f:f.write(time.strftime('%H:%M:%S')+' '+s+' load='+str(os.getloadavg())+'\n')
quiet=0;gate_deadline=time.time()+300
while quiet<60:
 if time.time()>gate_deadline:
  record('DEFER LAUNCH LOAD '+tag);sys.exit(3)
 load=os.getloadavg()[0];quiet=quiet+5 if load<=(8 if script=='phone.mjs' else 12 if '--crowd' in args else 15) else 0
 record('WAIT '+tag+' quiet='+str(quiet));time.sleep(5)
record('START '+tag)
Path('/tmp/pt9/runs/'+tag+'-manifest.json').write_text(json.dumps({'tag':tag,'script':script,'args':args,'harness_sha256':{name:__import__('hashlib').sha256(PAIR_SOURCE if name=='pair.py' else Path(P+'/'+name).read_bytes()).hexdigest() for name in [script,'browser.mjs','barrier.mjs','pair.py']},'runtime':{side:{k:json.loads(Path('/tmp/pt9/'+side+'.json').read_text())[k] for k in ['main','assets']} for side in ['b','c']}},indent=2))
ps=[];files=[];paused_workers=[]
peak=os.getloadavg()[0];samples=[];aborted=False
def observe():
 global peak
 load=os.getloadavg()[0];peak=max(peak,load);samples.append([time.time(),load])
for side,port,cwd in [('b','8791','/Users/ryan/Studios/homie-arcade-rules'),('c','8792','/tmp/arcade-control')]:
 extra=args[:]
 if '--authority' in extra:
  extra.remove('--authority')
  if side=='c':extra.remove('--stall');extra+=['--stall-host']
 if '--stall' in extra:
  extra.remove('--stall')
  parent=26141 if side=='b' else 26150
  parent_command=subprocess.check_output(['ps','-p',str(parent),'-o','command='],text=True)
  if '--config /tmp/pt9/'+side+'.json' not in parent_command:raise RuntimeError('Runtime parent is no longer this task server')
  workers=[]
  for line in subprocess.check_output(['ps','-axo','pid,ppid,command'],text=True).splitlines()[1:]:
   row=line.strip().split(None,2)
   if len(row)==3 and int(row[1])==parent and '/bin/workerd serve ' in row[2] and '--inspector-addr=' in row[2]:workers.append(int(row[0]))
  if len(workers)!=1:raise RuntimeError('Expected exactly one owned runtime worker: '+str(workers))
  paused_workers.extend(workers)
  record('STALL TARGET '+side+' '+str(workers))
  extra+=['--stall-pids',','.join(map(str,workers))]
 cmd=['node',P+'/'+script,'--base','http://127.0.0.1:'+port,'--tag',side+'-'+tag,'--out','/tmp/pt9/runs']
 if script=='cmp6.mjs' and '--only' not in extra:cmd+=['--only','shape','--skip-presses']
 f=open('/tmp/pt9/runs/'+side+'-'+tag+'.log','w');files.append(f)
 ps.append(subprocess.Popen(cmd+extra,cwd=cwd,env={**os.environ,'GPU':'1','PAIR_BARRIER':'/tmp/pt9/runs/'+tag+'-ready','PAIR_SIDE':side},stdout=f,stderr=subprocess.STDOUT))
 if side=='b':
  ready=Path('/tmp/pt9/runs/'+tag+'-ready-'+('phone' if script=='phone.mjs' else 'shape')+'-b')
  deadline=time.time()+150
  while not ready.exists() and ps[-1].poll() is None and time.time()<deadline:
   observe()
   if peak>25:break
   time.sleep(1)
  observe()
  if peak>25 or ps[-1].poll() is not None:break
while any(p.poll() is None for p in ps):
 observe()
 if peak>25 and not aborted:
  aborted=True;record('ABORT ABOVE CEILING '+tag)
  for p in ps:
   if p.poll() is None:p.send_signal(__import__('signal').SIGINT)
 time.sleep(1)
# A load abort may interrupt the child during SIGSTOP; always resume our recorded workers.
for pid in paused_workers:
 try:os.kill(pid,__import__('signal').SIGCONT)
 except ProcessLookupError:pass
Path('/tmp/pt9/runs/'+tag+'-load.json').write_text(json.dumps({'peak':peak,'valid':peak<=25,'complete':len(ps)==2 and all(p.returncode==0 for p in ps),'qualified':peak<=25 and len(ps)==2 and all(p.returncode==0 for p in ps),'samples':samples}))
for f in files:f.close()
record('END '+tag+' exits='+str([p.returncode for p in ps])+' peak='+str(peak))
if peak>25:record('INVALID LOAD '+tag)
sys.exit(2 if peak>25 else int(len(ps)!=2 or any(p.returncode for p in ps)))
