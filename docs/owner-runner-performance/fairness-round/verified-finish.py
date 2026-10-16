import pathlib,subprocess,time
p=pathlib.Path('/tmp/owner-fairness');studio='/Users/ryan/Studios/homie-arcade-rules'
def run(n,args,cwd=studio):
 print('START',n,time.time(),flush=True)
 with (p/(n+'.log')).open('w') as f:r=subprocess.run(args,cwd=cwd,stdout=f,stderr=subprocess.STDOUT)
 print('DONE',n,r.returncode,time.time(),flush=True)
 if r.returncode:raise SystemExit(r.returncode)
assert '# pass 44' in (p/'verified-tests.log').read_text()
run('verified-refresh',['python3','/tmp/owner-perf-round/refresh.py'])
for mode in ['phone','heap','fair','switch','feel0']:
 args=['python3',str(p/'pair.py'),mode,'verified']
 if mode=='phone':args+=['1']
 run('verified-'+mode+'-pairs',args)
run('verified-check',['npx','--no-install','homie-studio','check','tiny-platformer','--url','http://127.0.0.1:8791'])
