import pathlib,gzip,json,sys,math
root=pathlib.Path('/tmp/owner-fairness/runs')
def audit(p):
 r=json.loads(gzip.decompress(p.read_bytes()));F=r['frames'];S=r.get('seen',[]);origin=r['origin'];events=[]
 deaths={}
 for i,f in enumerate(F):
  d=(f[6] or {}).get('diedAt',0)
  if d and d not in deaths:deaths[d]=i
 traces=r.get('catchTraces',[])
 ids={}
 for c in traces:
  if c['tick'] in deaths:ids[c['id']]=ids.get(c['id'],0)+1
 own=max(ids,key=ids.get) if ids else None
 for c in traces:
  if c['id']!=own or c['tick'] not in deaths:continue
  i=deaths[c['tick']];death=F[i];before=F[max(0,i-1)];window=[f for f in F[:i] if death[0]-f[0]<4000]
  target=c['report']-1+(c['sub']+1)/3
  at=min(window,key=lambda f:abs(f[8][0]-target)) if window else before
  m=next((m for m in at[5] if m[0]==c['monster']),None)
  near=[]
  for f in window:
   if death[0]-f[0]>1150:continue
   for mi,mx,my in ([(j,*xy) for j,xy in enumerate(f[9])] if len(f)>9 else f[5]):
    near.append((max(abs(mx-f[1]),abs(my-f[2])),f[0],mi,mx,my,f[1],f[2]))
  best=min(near) if near else None
  sn=[s for s in S if abs(s[0]-(origin+death[0]))<1500]
  row={**c,'ageTicks':c['tick']-c['report'],'historyChoice':'current' if c['judged']==c['tick'] else 'report','spriteSizeTiles':1,'collisionSizeTiles':31/32,'sideInsetTiles':6/32 if c.get('remote') else 0,'ownerPaintedMonstersAtReport':at[9] if len(at)>9 else None,'contactSeparation':{axis:max(abs(c['runnerPos'][axis]-c['monsterPos'][axis]) for axis in ['x','y']) for axis in ['max']},'ownReceiptS':round((death[0]-F[0][0])/1000,3),'ownBeforeReceipt':before[1:3],'ownerAtReport':{'tick':at[8][0],'viewTick':at[8][1],'runner':at[1:3],'monster':m,'tickError':round(at[8][0]-target,3)},'nearestVisibleMonsterBeforeReceipt':best,'ownNoOverlapWithin1150ms':best is None or best[0]>31/32}
  events.append(row)
 return {'file':p.name,'events':events}
rows=[audit(p) for p in sorted(root.glob(sys.argv[1]+'*-frames.json.gz'))]
print(json.dumps(rows,indent=2))
