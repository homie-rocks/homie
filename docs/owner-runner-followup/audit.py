import json,gzip,pathlib,math,subprocess
out=pathlib.Path('/tmp/owner-followup');runs=out/'runs';summary={}
def read(p):return json.loads(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes())
for tag in ['final-stall3000','final-stall15000','final-drift.99','final-drift1.01','final-switch','final-reconnect']:
 summary[tag]={}
 for w in ['b','c']:
  p=next(runs.glob(w+'-'+tag+'*frames.json.gz'));r=read(p);j=read(runs/(w+'-'+tag+'.json'))['shape'];f=r['frames'];seen=r['seen'];last=seen[-1][0]
  z={'seconds':round(j['seconds'],2),'hud':j['scoreOnMyHud'],'observerScore':j['scoreOnTheOtherScreen'],'observerMovingFramesLast5s':sum(math.hypot(b[1]-a[1],b[2]-a[2])>.01 for a,b in zip(seen,seen[1:]) if b[0]>last-5000),'observerFramesLast5s':sum(a[0]>last-5000 for a in seen),'clockLeadEnd':None if not r['kit'] else r['kit']['tick']-r['kit']['serverTick'],'events':[]}
  for e in r['events']:
   end=e.get('back',e['at']+e['ms']);during=[a[3] for a in f if e['at']+200<a[0]<e['at']+e['ms']];s=[a for a in seen if end+r['origin']-1000<a[0]<end+r['origin']+3000];big=[];streak=0;maxstreak=0
   for a,b in zip(s,s[1:]):
    d=math.hypot(b[1]-a[1],b[2]-a[2]);hit=d>1.5 and b[0]-a[0]<34
    if hit:big.append(round(d,2));streak+=1;maxstreak=max(streak,maxstreak)
    else:streak=0
   z['events'].append({**e,'hudDuring':[min(during),max(during)] if during else [],'largeRemoteStepsNearReturn':big,'maxConsecutiveLargeRemoteSteps':maxstreak})
  summary[tag][w]=z
(out/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary,indent=2))
