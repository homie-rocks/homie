from pathlib import Path
import json,subprocess,sys
root=Path('/tmp/pt9');runs=root/'runs';out={}
for tag in sys.argv[1:]:
 load=json.loads((runs/(tag+'-load.json')).read_text())
 if not load.get('qualified',False):
  out[tag]={'excluded':True,'peakLoad':load['peak']};continue
 manifest=json.loads((runs/(tag+'-manifest.json')).read_text());row={'peakLoad':load['peak'],'manifest':manifest,'sides':{}}
 for side in ['b','c']:
  files=list(runs.glob(side+'-'+tag+'-frames.json'))+list(runs.glob(side+'-'+tag+'-lag*-frames.json.gz'))
  assert len(files)==1,(tag,side,files)
  f=files[0];stats={}
  commands=[('owner',['node',str(root/'ana4.mjs'),str(f)])]
  if f.suffix=='.gz':
   commands += [(name,['node',str(root/(script+'.mjs')),*args,str(f)]) for name,script,args in [('fair','fair',[]),('observerJumps','tele',['3']),('stomps','mflick',[]),('observerFreezes','sstall',[]),('stallRecovery','stall-recovery',[])]]
  for name,cmd in commands:
   p=subprocess.run(cmd,capture_output=True,text=True,cwd='/Users/ryan/Studios/homie-arcade-rules');assert p.returncode==0,(cmd,p.stderr);stats[name]=p.stdout.strip()
  row['sides'][side]=stats
 out[tag]=row
path=runs/('analysis-'+ '-'.join(sys.argv[1:])+'.json');path.write_text(json.dumps(out,indent=2));print(path)
