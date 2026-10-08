import json,sys,statistics
path=sys.argv[1]
row=json.load(open(path))[0]
events=json.load(open(path+'.trace.json'))['traceEvents']
marks={e['name']:e for e in events if e.get('name','').startswith('sustained:')}
a,b=marks['sustained:start']['ts'],marks['sustained:aftermath']['ts']
pid,tid=marks['sustained:start']['pid'],marks['sustained:start']['tid']
tasks=[e for e in events if e.get('name')=='RunTask' and e.get('ph')=='X' and e.get('pid')==pid and e.get('tid')==tid and e['ts']<b and e['ts']+e.get('dur',0)>a]
inputs=[e for e in events if e.get('name')=='sustained:input']
input_tasks={ (e['ts'],e.get('dur',0)):e for marker in inputs for e in tasks if e['ts']<=marker['ts']<e['ts']+e.get('dur',0)}
workerids={e['tid'] for e in events if e.get('ph')=='M' and e.get('name')=='thread_name' and 'Worker' in e.get('args',{}).get('name','')}
wt=[e.get('dur',0)/1000 for e in events if e.get('name')=='RunTask' and e.get('ph')=='X' and e.get('pid')==pid and e.get('tid') in workerids and a<=e['ts']<b]
obs=row['observation']; times=[v['time'] for v in obs['inputs']];gaps=[y-x for x,y in zip(times,times[1:])]
gauges=obs['gauges']; sent=row['sent']['time']; drained=next((x['time'] for x in gauges if x['time']>=sent and x['pending']==0 and x['sequence']==x['acknowledged']),None)
def stats(values):
 values=sorted(values)
 return {'n':len(values),'median':statistics.median(values) if values else None,'p95':values[max(0,int(len(values)*.95+.999)-1)] if values else None,'max':max(values) if values else None}
summary={'arm':row['arm'],'geometry':row['geometry'],'trustedInputs':sum(x['trusted'] for x in obs['inputs']),'inputSpacingMs':stats(gaps),'inputEnclosingMainTasksMs':stats([e.get('dur',0)/1000 for e in input_tasks.values()]),'allMainTasksMs':stats([e.get('dur',0)/1000 for e in tasks]),'workerTasksMs':stats(wt),'frameGapsMs':stats(obs['frames']),'maxQueueDepth':max(x['pending'] for x in gauges),'maxAckLag':max(x['sequence']-x['acknowledged'] for x in gauges),'maxQueuedInsertedCharacters':max(x['inserted'] for x in gauges),'postSentDrainUpperBoundMs':drained-sent if drained else None,'mainHeapStartBytes':gauges[0].get('heap'),'mainHeapEndBytes':obs.get('heap'),'mainHeapPeakBytes':max(x.get('heap',0) for x in gauges),'sent':row['sent'],'finalGauge':obs['final'],'finish':row['finish'],'topMainTasks':[{'ms':e.get('dur',0)/1000,'afterStartMs':(e['ts']-a)/1000} for e in sorted(tasks,key=lambda e:e.get('dur',0),reverse=True)[:5]]}
json.dump(summary,open(path+'.summary.json','w'),indent=2)
print(json.dumps(summary,indent=2))
