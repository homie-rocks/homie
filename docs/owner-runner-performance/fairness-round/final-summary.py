import pathlib,json,re,collections
root=pathlib.Path('/tmp/owner-fairness');loads=[]
for mode in ['phone','heap','fair','switch','feel0']:
 name='verified-'+mode+'-pairs.log';starts=[];values=[]
 for l in (root/name).read_text().splitlines():
  m=re.search(r'\((\d+(?:\.\d+)?),',l)
  if m:
   v=float(m[1]);values.append(v)
   if l.startswith('START'):starts.append(v)
 loads.append({'file':name,'starts':starts,'recordedMin':min(values),'recordedMax':max(values)})
latency={}
for side in 'bc':latency[side]=json.loads((root/'runs'/(side+'verifiedfeel0.json')).read_text())['feel']
r={'status':'not_ready','startingToolkit':'27d431c933014b859677a3f54aa1802b37f2fe1d','controlStudio':'75b280cfb7f4d03d8d5f695f38b42b3c29cc5385','fairness':json.loads((root/'verified-fair-summary.json').read_text()),'phone':json.loads((root/'verified-phone-summary.json').read_text()),'passAudit':json.loads((root/'verified-pass-audit.json').read_text()),'latency':latency,'load':loads,'tests':{'view':305,'validator':17,'studio':44}}
(root/'final-summary.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(loads,indent=2))
