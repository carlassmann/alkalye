import json,glob,statistics
out=[]
for path in glob.glob('/tmp/alkalye-worker-editor/corrected-*.json'):
 if '.trace.json' in path or path.endswith('summary.json'):continue
 for row in json.load(open(path)):
  events=json.load(open(row['trace']))['traceEvents']
  marks={e['name']:e for e in events if e.get('name','').startswith('worker:input:')}
  start=marks['worker:input:start'];end=marks['worker:input:aftermath'];durable=marks['worker:input:durable']
  pid,tid=start['pid'],start['tid'];a,b=start['ts'],end['ts']
  tasks=[e for e in events if e.get('name')=='RunTask' and e.get('ph')=='X' and e.get('pid')==pid and e.get('tid')==tid and e['ts']<b and e['ts']+e.get('dur',0)>a]
  enclosing=[e for e in tasks if e['ts']<=a<e['ts']+e.get('dur',0)]
  after=[e for e in tasks if e['ts']>a]
  layout=[e.get('dur',0)/1000 for e in events if e.get('name')=='Layout' and e.get('ph')=='X' and e.get('pid')==pid and e.get('tid')==tid and a<=e['ts']<b]
  paint=[e.get('dur',0)/1000 for e in events if e.get('name')=='Paint' and e.get('ph')=='X' and e.get('pid')==pid and e.get('tid')==tid and a<=e['ts']<b]
  workerids={e['tid'] for e in events if e.get('ph')=='M' and e.get('name')=='thread_name' and 'Worker' in e.get('args',{}).get('name','')}
  workertasks=[e.get('dur',0)/1000 for e in events if e.get('name')=='RunTask' and e.get('ph')=='X' and e.get('pid')==pid and e.get('tid') in workerids and a<=e['ts']<b]
  item={'fixture':path.rsplit('/',1)[1],'trial':row['trial'],'geometry':row['geometry'],'observation':row['observation'],'aftermath':row['aftermath'],'inputEnclosingTaskMs':max([e.get('dur',0)/1000 for e in enclosing],default=0),'largestMainTaskToAftermathMs':max([e.get('dur',0)/1000 for e in tasks],default=0),'largestDeferredMainTaskMs':max([e.get('dur',0)/1000 for e in after],default=0),'layoutTotalMs':sum(layout),'paintTotalMs':sum(paint),'largestWorkerTaskMs':max(workertasks,default=0),'taskCount':len(tasks),'driverCompletionUpperBoundMs':(durable['ts']-a)/1000}
  out.append(item)
json.dump(out,open('/tmp/alkalye-worker-editor/corrected-summary.json','w'),indent=2)
for name in sorted({r['fixture'] for r in out}):
 group=[r for r in out if r['fixture']==name]
 print(name,[(r['inputEnclosingTaskMs'],r['largestMainTaskToAftermathMs'],r['largestWorkerTaskMs']) for r in group])
