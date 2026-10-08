import json,collections,bisect,os
base='/tmp/alkalye-worker-source-diagnostic'
es=json.load(open(base+'/human-peer.json.trace.json'))['traceEvents']
abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
def decode(s):
 out=[];value=shift=0
 for c in s:
  d=abc.index(c);value+=(d&31)<<shift
  if d&32:shift+=5
  else:out.append(-(value>>1) if value&1 else value>>1);value=shift=0
 return out
maps={}
for asset in ['worker','browser-fixture']:
 m=json.load(open(base+'/runtime/assets/'+asset+'.js.map'));src=ln=col=0;lines=[]
 for line in m['mappings'].split(';'):
  gen=0;segments=[]
  for segment in line.split(','):
   if not segment:continue
   v=decode(segment);gen+=v[0]
   if len(v)>=4:
    src+=v[1];ln+=v[2];col+=v[3];segments.append((gen,src,ln,col))
  lines.append(segments)
 maps[asset]=(m,lines)
def mapped(frame):
 name=frame.get('functionName') or '(anonymous)';url=frame.get('url','');line=frame.get('lineNumber',-1);column=frame.get('columnNumber',0)
 asset='worker' if '/worker.js' in url else 'browser-fixture' if '/browser-fixture.js' in url else None
 if asset and line>=0:
  m,lines=maps[asset]
  if line<len(lines):
   seg=lines[line];i=bisect.bisect_right([x[0] for x in seg],column)-1
   if i>=0:
    _,source,ln,col=seg[i];path=m['sources'][source]
    if '/src/' in path:path=path[path.index('/src/')+1:]
    elif '/effect/' in path:path='effect/'+path.split('/effect/')[-1]
    else:path=os.path.basename(path)
    return name+' ['+path+':'+str(ln+1)+']'
 return name
marks=[e for e in es if e['name'].startswith('worker:')]
roles={e['tid']:e['name'].split(':')[1] for e in marks}
a=next(e['ts'] for e in es if e['name']=='sustained:start');b=next(e['ts'] for e in es if e['name']=='sustained:aftermath')
profiles={}
for e in es:
 if e['name']=='Profile':profiles[(e['pid'],e['id'])]={'time':e['args']['data']['startTime'],'nodes':{},'samples':[]}
for e in es:
 if e['name']!='ProfileChunk':continue
 p=profiles[(e['pid'],e['id'])];d=e['args']['data'];cpu=d.get('cpuProfile',{})
 for n in cpu.get('nodes',[]):p['nodes'][n['id']]=n
 for node,delta in zip(cpu.get('samples',[]),d.get('timeDeltas',[])):
  p['time']+=delta;p['samples'].append((p['time'],node,max(0,delta)))
output={'profiles':[],'longWorkerTasks':[]}
for p in profiles.values():
 nodes=p['nodes'];selfms=collections.Counter();inclusive=collections.Counter();n=0
 for t,node,delta in p['samples']:
  if not(a<=t<b):continue
  n+=1;name=mapped(nodes[node]['callFrame']);selfms[name]+=delta/1000
  seen=set()
  while node in nodes:
   row=nodes[node];name=mapped(row['callFrame']);seen.add(name);node=row.get('parent')
  for name in seen:inclusive[name]+=delta/1000
 urls=sorted({n['callFrame'].get('url','') for n in nodes.values() if 'worker.js' in n['callFrame'].get('url','')})
 output['profiles'].append({'urls':urls,'samples':n,'selfMs':selfms.most_common(20),'inclusiveMs':inclusive.most_common(70)})
for e in sorted([e for e in es if e['name']=='RunTask' and e.get('ph')=='X' and e['tid'] in roles and a<=e['ts']<b],key=lambda x:x.get('dur',0),reverse=True)[:12]:
 tid=e['tid'];start=e['ts'];end=start+e.get('dur',0);phases=[{'name':m['name'],'afterTaskStartMs':(m['ts']-start)/1000} for m in marks if m['tid']==tid and start<=m['ts']<end]
 prior=sorted([m for m in marks if m['tid']==tid and m['ts']<start],key=lambda m:m['ts'])
 output['longWorkerTasks'].append({'role':roles[tid],'ms':e.get('dur',0)/1000,'afterStartMs':(start-a)/1000,'priorPhase':prior[-1]['name'] if prior else None,'phases':phases})
for task in output['longWorkerTasks'][:3]:
 start=a+task['afterStartMs']*1000;end=start+task['ms']*1000;own=collections.Counter();ancestry=collections.Counter()
 for p in profiles.values():
  if not any('role='+task['role'] in n['callFrame'].get('url','') for n in p['nodes'].values()):continue
  for t,node,delta in p['samples']:
   if not(start<=t<end):continue
   own[mapped(p['nodes'][node]['callFrame'])]+=delta/1000;seen=set()
   while node in p['nodes']:
    n=p['nodes'][node];seen.add(mapped(n['callFrame']));node=n.get('parent')
   for name in seen:ancestry[name]+=delta/1000
 task['selfSamplesMs']=own.most_common(12);task['inclusiveSamplesMs']=ancestry.most_common(25)
json.dump(output,open(base+'/profile-summary.json','w'),indent=2)
print(json.dumps(output,indent=2))
