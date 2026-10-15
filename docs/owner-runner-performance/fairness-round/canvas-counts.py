import pathlib,json,gzip,math
spawns=[[3,15],[30,41],[20,31],[10,6],[60,41],[55,6],[40,38],[50,26]]
rows=[]
for p in sorted(pathlib.Path('/tmp/owner-fairness/runs').glob('*margin2fair*-frames.json.gz')):
 r=json.loads(gzip.decompress(p.read_bytes()));F=r['frames'];last=-1e9;catches=0;phantoms=0
 for i,f in enumerate(F[1:],1):
  t,x,y=f[:3]
  if any(abs(mx-x)<=31/32 and abs(my-y)<=31/32 for mx,my in f[9]):last=t
  prev=F[i-1]
  if abs(x-prev[1])+abs(y-prev[2])>3 and t-prev[0]<200 and any(abs(x-sx)<1.2 and abs(y-sy)<1.5 for sx,sy in spawns):
   catches+=1;phantoms+=int(t-last>1150)
 rows.append({'file':p.name,'heuristicCatches':catches,'canvasNoOverlapBeforeCatch':phantoms})
print(json.dumps(rows,indent=2))
