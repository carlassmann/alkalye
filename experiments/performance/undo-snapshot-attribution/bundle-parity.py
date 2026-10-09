import pathlib,re,hashlib,json
fresh=pathlib.Path('/tmp/alkalye-production-undo-residual/current-7d7df3d/app-runtime/dist');reference=pathlib.Path('/Users/carlassmann/.codex/worktrees/b513/alkalye/dist')
def normalize(s):
 def reference(match):
  path=match.group(1)
  if not path.startswith('.'):return match.group(0)
  return '"'+re.sub(r'([a-z][a-z0-9-]*-)[a-z0-9]{8}(?=\.js$)',r'\1HASH',path)+'"'
 return re.sub(r'"([^"\n]+\.js)"',reference,re.sub(r'(?m)^//# debugId=[A-F0-9]+$', '', s))
def graph(root):
 pending=['app.js'];seen={};groups={}
 while pending:
  name=pending.pop()
  if name in seen:continue
  p=root/name;s=p.read_text();n=normalize(s);fingerprint=hashlib.sha256(n.encode()).hexdigest()
  seen[name]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'normalizedSHA256':fingerprint};groups.setdefault(fingerprint,[]).append(name)
  for value in re.findall(r'"([^"\n]+\.js)"',s):
   if not value.startswith('.'):continue
   path=(p.parent/value).resolve()
   if path.exists() and path.is_relative_to(root.resolve()):pending.append(str(path.relative_to(root.resolve())))
 return seen,groups
a,ag=graph(fresh);b,bg=graph(reference)
report={'fresh':a,'reference':b,'normalizedGraphEqual':sorted(ag)==sorted(bg),'freshOnly':[ag[x] for x in ag.keys()-bg.keys()],'referenceOnly':[bg[x] for x in bg.keys()-ag.keys()]}
pathlib.Path('bundle-parity.json').write_text(json.dumps(report,indent=2)+'\n')
print('reached',len(a),len(b),'normalized exact',report['normalizedGraphEqual'],'unmatched',report['freshOnly'],report['referenceOnly'])

pairs=[]
if report['normalizedGraphEqual']:
 for fingerprint,names in ag.items():
  other=bg[fingerprint]
  if len(names)!=1 or len(other)!=1:raise Exception('Non-bijective executable graph')
  left,right=names[0],other[0]
  lm,rm=fresh/(left+'.map'),reference/(right+'.map')
  lmap,rmap=json.loads(lm.read_text()),json.loads(rm.read_text())
  exactContent=lmap.get('sourcesContent')==rmap.get('sourcesContent')
  mappingsEqual=lmap.get('mappings')==rmap.get('mappings')
  pairs.append({'fresh':left,'reference':right,'executableSHA256':fingerprint,'sourceContentsEqual':exactContent,'mappingsEqual':mappingsEqual,'freshMapSHA256':hashlib.sha256(lm.read_bytes()).hexdigest(),'referenceMapSHA256':hashlib.sha256(rm.read_bytes()).hexdigest()})
 report['bijectivePairs']=pairs
 report['gatePassed']=all(p['sourceContentsEqual'] and p['mappingsEqual'] for p in pairs) and len(pairs)==len(a)
 pathlib.Path('bundle-parity.json').write_text(json.dumps(report,indent=2)+'\n')
 print('maps verified',len(pairs),'gate',report['gatePassed'])
