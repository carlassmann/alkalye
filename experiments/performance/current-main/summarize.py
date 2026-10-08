import json,glob,os,statistics,hashlib
root='/tmp/alkalye-fresh-matrix'
def union(intervals):
 total=0;end=-1
 for a,b in sorted(intervals):
  total+=max(0,b-max(a,end));end=max(end,b)
 return total/1000
rows=[]
for p in glob.glob(root+'/*.trace.json'):
 if not any(x in os.path.basename(p) for x in ['burst-','multicursor-traced-','journeys-traced-','scroll-']):continue
 data=json.load(open(p)); events=data['traceEvents'];marks=[e for e in events if e.get('name') in ['benchmark:continuous:start','matrix:multicursor:start','matrix:journey:start','critical:scroll:start']]
 if not marks:continue
 m=marks[0];pid=m['pid'];tid=m['tid'];start=m['ts'];ends=[e['ts'] for e in events if e.get('name') in ['benchmark:continuous:end','matrix:multicursor:end','matrix:journey:end','critical:scroll:end'] and e['ts']>=start]
 end=ends[-1] if ends else max(e.get('ts',0)+e.get('dur',0) for e in events)
 xs=[e for e in events if e.get('ph')=='X' and e.get('pid')==pid and e.get('tid')==tid and e.get('ts',0)+e.get('dur',0)>=start and e.get('ts',0)<=end]
 tasks=[e for e in xs if e['name']=='RunTask'];first=[e for e in tasks if e['ts']<=start<=e['ts']+e.get('dur',0)]
 def phases(name):return union([(max(start,e['ts']),min(end,e['ts']+e.get('dur',0))) for e in xs if e['name']==name])
 largest=sorted(tasks,key=lambda e:e.get('dur',0),reverse=True)[:3]
 rows.append({'file':os.path.basename(p),'sha256':hashlib.sha256(open(p,'rb').read()).hexdigest(),'windowMs':(end-start)/1000,'firstEnclosingTaskMs':max([e.get('dur',0)/1000 for e in first],default=None),'largestTaskMs':max([e.get('dur',0)/1000 for e in tasks],default=None),'tasksOver8_33':sum(e.get('dur',0)>8333 for e in tasks),'layoutUnionMs':phases('Layout'),'paintUnionMs':phases('Paint'),'gcUnionMs':union([(max(start,e['ts']),min(end,e['ts']+e.get('dur',0))) for e in xs if 'GC' in e['name'] or 'Scavenge' in e['name']]),'largestTaskChildren': [{'durationMs':e.get('dur',0)/1000,'offsetMs':(e['ts']-start)/1000,'children':[{'name':x['name'],'durationMs':x.get('dur',0)/1000,'functionName':x.get('args',{}).get('data',{}).get('functionName','')} for x in xs if x['name'] in ['FunctionCall','EventDispatch','Layout','Paint','MajorGC','MinorGC'] and e['ts']<=x['ts'] and x['ts']+x.get('dur',0)<=e['ts']+e.get('dur',0)][:15]} for e in largest]})
json.dump(rows,open(root+'/trace-summary.json','w'),indent=2)
for prefix in ['burst','multicursor-traced','journeys-traced','scroll']:
 subset=[r for r in rows if r['file'].startswith(prefix)]
 for version in ['original','rewrite']:
  s=[r for r in subset if version in r['file']]
  if s: print(prefix,version,len(s),'largestTask median/max',statistics.median(r['largestTaskMs'] or 0 for r in s),max(r['largestTaskMs'] or 0 for r in s),'first median/max',statistics.median(r['firstEnclosingTaskMs'] or 0 for r in s),max(r['firstEnclosingTaskMs'] or 0 for r in s))
