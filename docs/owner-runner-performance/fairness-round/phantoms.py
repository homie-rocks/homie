import pathlib,json,gzip,math,sys
spawns=[[3,15],[30,41],[20,31],[10,6],[60,41],[55,6],[40,38],[50,26]]
rows=[]
for p in sorted(pathlib.Path(sys.argv[1]).glob(sys.argv[2]+'*-frames.json.gz')):
 r=json.loads(gzip.decompress(p.read_bytes()));F=r['frames'];S=r.get('seen',[]);O=r['origin'];deaths=[];last=0
 for f in F:
  d=(f[6] or {}).get('diedAt',0)
  if d!=last and d:deaths.append((O+f[0],d));last=d
 for i,s in enumerate(S[1:],1):
  if math.hypot(s[1]-S[i-1][1],s[2]-S[i-1][2])<=3:continue
  if not any(abs(x-s[1])<1.2 and abs(y-s[2])<1.5 for x,y in spawns):continue
  near=[]
  for f in S[max(0,i-50):i]:
   if s[0]-f[0]>=600:continue
   for mi,mx,my in f[3]:near.append((max(abs(mx-f[1]),abs(my-f[2])),mi,mx,my,f[1],f[2],s[0]-f[0]))
  best=min(near) if near else None
  if best and best[0]<1.2:continue
  matches=[(t-s[0],d) for t,d in deaths if -150<t-s[0]<1600]
  nearest=min(F,key=lambda f:abs(O+f[0]-s[0]))
  rows.append({'file':p.name,'s':round((s[0]-O-F[0][0])/1000,3),'from':S[i-1][1:3],'to':s[1:3],'nearestMonsterOnObserver':best,'candidateOwnerDeathReceipts':matches,'ownerDrawnAtObserverJump':{'runner':nearest[1:3],'tick':nearest[8],'diedAt':(nearest[6] or {}).get('diedAt')}})
print(json.dumps(rows,indent=2))
