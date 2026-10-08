import json,pathlib,statistics
root=pathlib.Path('/tmp/alkalye-durable-undo-refresh')
def union(intervals):
 total=0; last=None
 for low,high in sorted(intervals):
  if last is not None: low=max(low,last)
  if high>low:total+=high-low;last=high
 return total/1000
rows=[]
for spec in json.loads((root/'phases.json').read_text()):
 row=json.loads(pathlib.Path(spec['results']).read_text())[0]
 for phase,obskey,tracekey in [('input','observation','trace'),('undo','undoObservation','undoTrace'),('redo','redoObservation','redoTrace')]:
  obs=row[obskey];probe=obs['probe'];decoded=json.loads(pathlib.Path(row[tracekey]).read_text());ev=decoded['traceEvents']
  start=next(x for x in ev if x.get('name')=='interaction:start');end=next(x for x in ev if x.get('name')=='interaction:end');a,b=start['ts'],end['ts'];thread=(start['pid'],start['tid'])
  events=[x for x in ev if (x.get('pid'),x.get('tid'))==thread and x.get('ph')=='X' and x.get('ts',0)<b and x.get('ts',0)+x.get('dur',0)>a]
  tasks=[x for x in events if x['name']=='RunTask'];initial=[x for x in tasks if x['ts']<=a<=x['ts']+x['dur']]
  def work(names):return union([(max(a,x['ts']),min(b,x['ts']+x['dur'])) for x in events if x['name'] in names])
  marks=obs.get('timeline',[]);target=2048 if phase=='undo' else 2049
  assignment=next((x['time'] for x in marks if x['name']=='editor:source-assigned' and (x.get('detail') or {}).get('characters')==target),None)
  rendered=next((x['time'] for x in marks if x['name']=='editor:viewport-rendered' and (x.get('detail') or {}).get('characters')==target),None)
  completion=next((x['time'] for x in marks if x['name']=='undo:completion-refresh-start'),None)
  rows.append({'arm':row['version'],'trial':row['trial'],'pair':int(spec['label'].split('-')[-1]),'phase':phase,'status':row['status'],'initialTaskMs':max(x['dur']/1000 for x in initial),'aftermathMaxTaskMs':max((x['dur']/1000 for x in tasks if x not in initial),default=0),'windowMaxTaskMs':max(x['dur']/1000 for x in tasks),'taskUnionMs':work(['RunTask']),'layoutUnionMs':work(['Layout']),'paintUnionMs':work(['Paint']),'gcUnionMs':work(['MinorGC','MajorGC']),'probeReadyMs':probe['ready']-probe['start'],'sourceAssignedMs':None if assignment is None else assignment-probe['start'],'viewportReturnedMs':None if rendered is None else rendered-probe['start'],'sourceAfterCompletionMs':None if assignment is None or completion is None else assignment-completion,'renderAfterCompletionMs':None if rendered is None or completion is None else rendered-completion,'heapStartBytes':probe.get('heapStart'),'heapEndBytes':probe.get('heapEnd')})
(root/'summary.json').write_text(json.dumps(rows,indent=2)+'\n')
for phase in ['input','undo','redo']:
 for arm in ['baseline','candidate']:
  r=[x for x in rows if x['phase']==phase and x['arm']==arm]
  print(phase,arm,{k:{'median':round(statistics.median([x[k] for x in r if x[k] is not None]),3),'max':round(max(x[k] for x in r if x[k] is not None),3)} for k in ['initialTaskMs','windowMaxTaskMs','taskUnionMs','layoutUnionMs','paintUnionMs','gcUnionMs','probeReadyMs','sourceAssignedMs','sourceAfterCompletionMs','renderAfterCompletionMs'] if any(x[k] is not None for x in r)})
