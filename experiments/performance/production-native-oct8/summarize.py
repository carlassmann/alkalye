import json,glob,os,statistics
root='/tmp/alkalye-prod-current-oct8';data=json.load(open(root+'/native-tasks-final-core.json'));out=[]
for r in data['results']+[dict(f.get('partial',{}),kind=f['kind'],name=f['name'],position=f['position'],trial=f['trial'],failedStage=f['stage']) for f in data['failures'] if f.get('partial',{}).get('trace')]:
 p=r['trace'];d=json.load(open(p));events=d.get('traceEvents',d) if isinstance(d,dict) else d
 marks={x['name']:x for x in events if x.get('name') in ['production:key:start','production:input:start','production:input:end']};a=marks['production:key:start'];b=marks['production:input:end'];i=marks['production:input:start'];thread=(a['pid'],a['tid'])
 tasks=[x for x in events if x.get('name')=='RunTask' and x.get('ph')=='X' and (x.get('pid'),x.get('tid'))==thread and x['ts']<=b['ts'] and x['ts']+x.get('dur',0)>=a['ts']]
 initial=[x for x in tasks if x['ts']<=a['ts']<=x['ts']+x.get('dur',0) or x['ts']<=i['ts']<=x['ts']+x.get('dur',0)]
 top=sorted(tasks,key=lambda x:x.get('dur',0),reverse=True)[:3]
 largest=[]
 for t in top:
  children=[x for x in events if x.get('ph')=='X' and (x.get('pid'),x.get('tid'))==thread and x.get('ts',0)>=t['ts'] and x.get('ts',0)+x.get('dur',0)<=t['ts']+t.get('dur',0) and x.get('name') in ['FunctionCall','EventDispatch','Layout','Paint','MinorGC','MajorGC','TimerFire','FireAnimationFrame']]
  largest.append({'startRelativeMs':(t['ts']-a['ts'])/1000,'taskMs':t.get('dur',0)/1000,'children':[{'name':x['name'],'durationMs':x.get('dur',0)/1000,'args':x.get('args',{})} for x in sorted(children,key=lambda x:x.get('dur',0),reverse=True)[:5]]})
 o=r['observation'];out.append({'kind':r['kind'],'name':r['name'],'position':r['position'],'trial':r['trial'],'complete':not r.get('failedStage'),'failedStage':r.get('failedStage'),'inputRunTaskMs':max(x.get('dur',0)/1000 for x in initial),'aftermathMaxMs':max((x.get('dur',0)/1000 for x in tasks if x not in initial),default=0),'paintOpportunityMs':o['ready']-o['start'],'maxFrameGapMs':max(o['frames']),'eventTiming':o['eventTiming'],'trustedBefore':o['trustedBefore'],'largestTasks':largest})
json.dump(out,open(root+'/core-task-summary.json','w'),indent=2)
for kind,name in [('original','rich128'),('rewrite','rich128'),('original','long1m'),('rewrite','long1m')]:
 rows=[r for r in out if r['kind']==kind and r['name']==name];print(kind,name,'n',len(rows),'complete',sum(r['complete'] for r in rows),'input median/max',*[round(f([r['inputRunTaskMs'] for r in rows]),3) for f in [statistics.median,max]],'deferred median/max',*[round(f([r['aftermathMaxMs'] for r in rows]),3) for f in [statistics.median,max]])
