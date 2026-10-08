import json,pathlib,collections,hashlib
p=pathlib.Path('/tmp/alkalye-rich-undo-residual');events=json.loads((p/'candidate-0-undo.trace.json').read_text())['traceEvents'];m={e['name']:e for e in events if e.get('name') in ['undo:start','undo:end']};a,b=m['undo:start'],m['undo:end'];thread=a['pid'],a['tid'];tasks=[e for e in events if e.get('name')=='RunTask' and e.get('ph')=='X' and (e.get('pid'),e.get('tid'))==thread and e['ts']<=b['ts'] and e['ts']+e.get('dur',0)>=a['ts']];initial=max((e for e in tasks if e['ts']<=a['ts']<=e['ts']+e.get('dur',0)),key=lambda e:e.get('dur',0));target=max(tasks,key=lambda e:e.get('dur',0));start,end=target['ts'],target['ts']+target.get('dur',0)
groups={}
for e in sorted(events,key=lambda e:e.get('ts',0)):
 if e.get('name') not in ['Profile','ProfileChunk']:continue
 key=e['pid'],e.get('id');g=groups.setdefault(key,{'nodes':{},'tid':e['tid'],'time':0,'self':collections.Counter(),'inclusive':collections.Counter()});d=e.get('args',{}).get('data',{})
 if e['name']=='Profile':g['time']=d.get('startTime',e['ts']);continue
 cpu=d.get('cpuProfile',{})
 for n in cpu.get('nodes',[]):g['nodes'][n['id']]=n
 for ident,delta in zip(cpu.get('samples',[]),d.get('timeDeltas',[])):
  g['time']+=delta
  if not start<=g['time']<=end:continue
  g['self'][ident]+=delta;seen=set();ancestor=ident
  while ancestor and ancestor not in seen:
   seen.add(ancestor);g['inclusive'][ancestor]+=delta;ancestor=g['nodes'].get(ancestor,{}).get('parent')
profiles=[]
for (pid,_),g in groups.items():
 if not g['self']:continue
 profiles.append({'main':(pid,g['tid'])==thread,'sampledTargetTaskSelfMs':sum(g['self'].values())/1000,'self':[{'frame':g['nodes'].get(i,{}).get('callFrame',{}),'selfMs':v/1000,'inclusiveMs':g['inclusive'][i]/1000} for i,v in g['self'].most_common(25)],'inclusive':[{'frame':g['nodes'].get(i,{}).get('callFrame',{}),'selfMs':g['self'][i]/1000,'inclusiveMs':v/1000} for i,v in g['inclusive'].most_common(30)]})
r={'cpuSampling':True,'undoInitiatingTaskMs':initial.get('dur',0)/1000,'sampledTargetTaskMs':target.get('dur',0)/1000,'targetStartRelativeMs':(start-a['ts'])/1000,'allTaskMaxMs':max(e.get('dur',0)/1000 for e in tasks),'deferredMaxMs':max(e.get('dur',0)/1000 for e in tasks if e is not initial),'profiles':profiles,'traceSha256':hashlib.sha256((p/'candidate-0-undo.trace.json').read_bytes()).hexdigest()};(p/'sampled-analysis.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
