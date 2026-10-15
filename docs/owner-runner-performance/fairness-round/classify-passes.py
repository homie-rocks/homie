import pathlib,json,gzip,sys
root=pathlib.Path('/tmp/owner-fairness');out=[]
for name in sys.argv[1:]:
 for line in (root/name).read_text().splitlines():
  file,raw=line.split(' ',1);flags=json.loads(raw);r=json.loads(gzip.decompress((root/'runs'/file).read_bytes()));S=r['seen']
  for f in flags:
   start=f['start'];death=start[5];receipt=next((s for s in S if 0<=s[0]-f['t']<1000 and s[5] and s[5]!=death),None)
   invulnerable=bool(death and start[9]<death+30)
   status='invulnerable' if invulnerable else 'confirmed catch' if receipt else 'unresolved visual pass'
   out.append({'file':file,'start':start,'monster':f['monster'],'classification':status,'deathReceipt':None if receipt is None else {'delayMs':receipt[0]-f['t'],'tick':receipt[5],'sampledTick':receipt[9],'position':receipt[1:3]}})
print(json.dumps(out,indent=2))
