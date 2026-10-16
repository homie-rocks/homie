import subprocess,sys,json,time,os
from pathlib import Path
cases=[]
# Network delays are per direction, FIFO loss adds a retransmission wait.
for delay,loss,jitter in [(0,0,0),(80,.01,30),(150,.03,50),(300,.05,80)]:
 for observer in ['h','n']:
  cases.append((f'n{delay}{observer}',['--delay',str(delay),'--loss',str(loss),'--jitter',str(jitter),'--seconds','180']+(['--obs3'] if observer=='n' else [])))
for delay in [0,80]:
 for observer in ['h','n']:
  cases.append((f'k{delay}{observer}',['--delay',str(delay),'--loss','.01' if delay else '0','--seconds','180','--kami']+(['--obs3'] if observer=='n' else [])))
for count in range(4,9):
 cases.append((f'p{count}',['--delay','80','--loss','.01','--jitter','30','--seconds','180','--crowd',str(count-2)]))
for observer in ['h','n']:
 cases.append(('d'+observer,['--delay','150','--loss','.01','--jitter','30','--seconds','180','--drift','1.01']+(['--obs3'] if observer=='n' else [])))
 cases.append(('l'+observer,['--delay','80','--seconds','180','--ls-every','500','--ls-hold','400']+(['--obs3'] if observer=='n' else [])))
for ms in [3000,6000,15000]:
 cases.append(('w'+str(ms//1000),['--delay','80','--loss','.01','--seconds','180','--stall','--authority','--stall-every','40','--stall-ms',str(ms),'--obs3']))
for n in range(2,7):cases.append(('f'+str(n),['--script','phone.mjs','--cpu','4','--seconds','180']))
cases.append(('ft',['--script','phone.mjs','--cpu','4','--seconds','180','--trace']))
Path('/tmp/pt9/matrix-plan.json').write_text(json.dumps(cases,indent=2))
results=[]
for tag,args in cases:
 n=0
 while True:
  name=tag if not n else tag+'r'+str(n)
  code=subprocess.call([sys.executable,'/tmp/pt9/pair.py',name,*args]);print(name,code,flush=True)
  results.append({'tag':name,'exit':code});Path('/tmp/pt9/matrix-status.json').write_text(json.dumps(results,indent=2))
  if code==2:n+=1;continue
  if code:sys.exit(code)
  break
