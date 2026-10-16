import pathlib,json,sys,statistics,gzip
root=pathlib.Path('/tmp/owner-fairness/runs');rows=[]
def read(p):
 if not p.exists():p=pathlib.Path(str(p)+'.gz')
 return json.loads(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes())
for p in sorted(root.glob('*'+sys.argv[1]+'phone*-frames.json*')):
 r=read(p);f=r['frames'];dt=[b[0]-a[0] for a,b in zip(f,f[1:])];tag=p.name.removesuffix('.gz')[:-12];pr=read(root/(tag+'-profile.json'));names={n['id']:n['callFrame']['functionName'] for n in pr['nodes']};gc=sum(t for n,t in zip(pr['samples'],pr['timeDeltas']) if names[n]=='(garbage collector)')/1000
 rows.append({'tag':tag,'frames':len(f),'over33':sum(x>33 for x in dt),'over50':sum(x>50 for x in dt),'gcMs':round(gc,3),'gcMsPerFrame':round(gc/len(f),5),'p99Ms':round(sorted(dt)[int(len(dt)*.99)],3),'loadEnd':r['load']})
print(json.dumps(rows,indent=2))
