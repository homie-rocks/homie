import pathlib,gzip,json,math,sys
spawns=[[3,15],[30,41],[20,31],[10,6],[60,41],[55,6],[40,38],[50,26]]
for p in pathlib.Path('/tmp/owner-fairness/runs').glob(sys.argv[1]+'*-frames.json.gz'):
 r=json.loads(gzip.decompress(p.read_bytes()));S=r['seen'];sresp=[]
 for i,f in enumerate(S[1:],1):
  if math.hypot(f[1]-S[i-1][1],f[2]-S[i-1][2])>3 and any(abs(x-f[1])<1.2 and abs(y-f[2])<1.5 for x,y in spawns):sresp.append(f[0])
 run={};out=[]
 for i,f in enumerate(S[1:],1):
  t,x,y,mons=f[:4];dy=y-S[i-1][2];now=set()
  for mi,mx,my in mons:
   if abs(mx-x)>31/32 or abs(my-y)>31/32:continue
   now.add(mi);cur=run.setdefault(mi,{'t':t,'n':0,'deep':0,'start':f,'monster':(mi,mx,my)})
   if not(dy>0 and my-y>.5):cur['n']+=1;cur['deep']+=int(abs(mx-x)<.5 and abs(my-y)<.5)
  for mi,cur in list(run.items()):
   if mi in now:continue
   del run[mi]
   if not any(m[0]==mi for m in mons):continue
   if cur['n']>=2 and cur['deep'] and not any(cur['t']>=rt-50 and cur['t']-rt<2200 for rt in sresp) and not any(rt>=cur['t'] and rt-cur['t']<1000 for rt in sresp):
    out.append({**cur,'s':(cur['t']-r['origin']-r['frames'][0][0])/1000,'nearDeaths':[(rt-cur['t']) for rt in sresp if abs(rt-cur['t'])<4000]})
 print(p.name,json.dumps(out))
