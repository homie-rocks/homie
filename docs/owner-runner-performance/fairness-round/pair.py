import pathlib,subprocess,os,time,json,sys
out=pathlib.Path('/tmp/owner-fairness');h='/tmp/owner-fairness/trace.mjs'
def pair(name,script,args):
 import urllib.request
 for port in [8791,8792]:
  deadline=time.time()+30
  while True:
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/tiny-platformer/play',timeout=2) as response:response.read(1)
    break
   except Exception:
    if time.time()>deadline:raise
    time.sleep(1)
 while os.getloadavg()[0]>25:
  print('WAIT',time.time(),os.getloadavg(),flush=True);time.sleep(30)
 print('START',name,time.time(),os.getloadavg(),flush=True)
 ps=[]
 for side,port,cwd in [('b',8791,'/Users/ryan/Studios/homie-arcade-rules'),('c',8792,'/tmp/owner-perf-live')]:
  tag=side+sys.argv[2]+name;f=(out/(tag+'.log')).open('w')
  p=subprocess.Popen(['node',script,'--base',f'http://127.0.0.1:{port}','--tag',tag,*args,'--out',str(out/'runs')],cwd=cwd,env={**os.environ,'GPU':'1'},stdout=f,stderr=subprocess.STDOUT);ps.append((side,p,f))
 while any(p.poll() is None for _,p,_ in ps):
  print('LOAD',name,time.time(),os.getloadavg(),[(s,p.poll()) for s,p,_ in ps],flush=True);time.sleep(15)
 for s,p,f in ps:f.close()
 print('DONE',name,[(s,p.returncode) for s,p,_ in ps],flush=True)
 return all(p.returncode==0 for _,p,_ in ps)
mode=sys.argv[1]
if mode=='phone':
 for n in range(1,int(sys.argv[3])+1 if len(sys.argv)>3 else 7):
  if not pair('phone'+str(n),'/tmp/owner-perf-round/profile-phone.mjs',['--seconds','180','--cpu','4','--delay','60','--loss','.01','--jitter','20']):break
if mode=='feel':pair('feel2',h,['--only','feel,feel150'])
if mode=='fair':
 for n in range(1,6):
  if not pair('fair'+str(n),h,['--only','shape','--skip-presses','--obs3','--seconds','60','--delay','300','--loss','.05']):break

if mode=='switch':pair('switch',h,['--only','shape','--skip-presses','--obs3','--seconds','60','--delay','80','--loss','.01','--ls-hold','400','--ls-every','500','--kami'])

if mode=='heap':pair('heap','/tmp/owner-fairness/heap-phone.mjs',['--seconds','60','--cpu','4','--delay','60','--loss','.01','--jitter','20'])

if mode=='feel0':pair('feel0',h,['--only','feel'])
