import json,collections
root='/tmp/alkalye-fresh-matrix';events=json.load(open(root+'/mc-diagnostic-rewrite-0.trace.json'))['traceEvents'];mark=next(e for e in events if e['name']=='matrix:multicursor:start');pid=mark['pid'];tid=mark['tid'];tasks=[e for e in events if e['name']=='RunTask' and e.get('ph')=='X' and e['pid']==pid and e['tid']==tid and e['ts']>=mark['ts']];task=max(tasks,key=lambda e:e.get('dur',0));print('worst',task['dur']/1000,'offset',(task['ts']-mark['ts'])/1000)
profiles={}
for e in events:
 if e['name']=='Profile' and e['pid']==pid and e['tid']==tid:profiles[e['id']]={'time':e['args']['data']['startTime'],'nodes':{},'samples':[]}
 if e['name']=='ProfileChunk' and e['pid']==pid:
  profile=profiles.get(e['id']);data=e['args']['data'];cpu=data.get('cpuProfile',{});
  if profile is None:continue
  for node in cpu.get('nodes',[]):profile['nodes'][node['id']]=node
  for sample,delta in zip(cpu.get('samples',[]),data.get('timeDeltas',[])):
   profile['time']+=delta;profile['samples'].append((profile['time'],sample,delta))
selfs=collections.Counter();inclusive=collections.Counter();frames={};total=0
for p in profiles.values():
 for time,sample,delta in p['samples']:
  if not task['ts']<=time<=task['ts']+task['dur']:continue
  total+=delta;first=True;visited=set()
  while sample in p['nodes'] and sample not in visited:
   visited.add(sample);node=p['nodes'][sample];frame=node['callFrame'];key=json.dumps(frame,sort_keys=True);frames[key]=frame
   if first:selfs[key]+=delta;first=False
   inclusive[key]+=delta;sample=node.get('parent',-1)
rows=[{'frame':frames[k],'selfMs':selfs[k]/1000,'inclusiveMs':inclusive[k]/1000} for k in inclusive]
rows.sort(key=lambda x:x['selfMs'],reverse=True)
result={'worstTaskMs':task['dur']/1000,'offsetMs':(task['ts']-mark['ts'])/1000,'sampledMs':total/1000,'rows':rows}
json.dump(result,open(root+'/mc-diagnostic-profile.json','w'),indent=2)
for row in rows[:25]:print(row)
