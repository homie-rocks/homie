import pathlib,json,gzip,sys,math
out=[]
for p in sorted(pathlib.Path('/tmp/owner-fairness/runs').glob(sys.argv[1]+'*-frames.json.gz')):
 r=json.loads(gzip.decompress(p.read_bytes()));F=r['frames'];S=r.get('seen',[]);rows=[];last=0
 for i,s in enumerate(S):
  if len(s)<10:continue
  d=s[5]
  if not d or d==last:continue
  last=d
  before=[f for f in S[:i] if s[0]-f[0]<600]
  near=[(max(abs(mx-f[1]),abs(my-f[2])),mi,mx,my,f[1],f[2]) for f in before for mi,mx,my in f[3]]
  best=min(near) if near else None
  c=next((c for c in r.get('catchTraces',[]) if c['id']==s[7] and c['tick']==d),None)
  rows.append({'diedAt':d,'onlookerReceipt':s[0],'onlookerClock':s[8:10],'nearestDrawnMonster':best,'noNearbyMonster':best is None or best[0]>=1.2,'serverContact':c})
 out.append({'file':p.name,'confirmedObserverDeaths':rows})
print(json.dumps(out,indent=2))
