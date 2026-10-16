import subprocess,sys,json,time
from pathlib import Path
ns={};exec(Path('/tmp/pt9/matrix.py').read_text().split('results=[]')[0],ns)
cases=[('s4',['--delay','80','--loss','.01','--seconds','100','--obs3','--stall','--stall-every','25','--stall-ms','3000'])]+ns['cases']+[('f7',['--script','phone.mjs','--cpu','4','--seconds','180'])]
cases.insert(1,('f8',['--script','phone.mjs','--cpu','4','--seconds','180']))
cases=[('v'+tag,args) for tag,args in cases]
state=Path('/tmp/pt9/campaign2-status.json')
results=json.loads(state.read_text())['results'] if state.exists() else []
done={r['case'] for r in results if r['exit']==0}
queue=[(tag,args,sum(r['case']==tag for r in results)) for tag,args in cases if tag not in done]
Path('/tmp/pt9/campaign2-plan.json').write_text(json.dumps(cases,indent=2))
while queue:
 tag,args,n=queue.pop(0);name=tag if not n else tag+'r'+str(n)
 code=subprocess.call([sys.executable,'/tmp/pt9/pair.py',name,*args]);print(name,code,flush=True)
 results.append({'case':tag,'tag':name,'exit':code})
 if code in [2,3]:queue.append((tag,args,n+1))
 elif code:
  state.write_text(json.dumps({'results':results,'queue':queue},indent=2));sys.exit(code)
 state.write_text(json.dumps({'results':results,'queue':queue},indent=2))
