import json,pathlib,statistics,hashlib
root=pathlib.Path('.');run=root/'dependencies-ready-853873b2-c3e4-4880-bbac-38e10c7f7ecb';resultpath=next(run.glob('results/*/results.json'));result=json.loads(resultpath.read_text())[0];rows=[]
for phase,key in [('input','trace'),('undo','undoTrace')]:
 p=pathlib.Path(result[key]);data=json.loads(p.read_text());events=data.get('traceEvents',[]) if isinstance(data,dict) else data
 begin=next(e for e in events if e.get('name')=='interaction:start');owner=(begin['pid'],begin['tid']);start=begin['ts'];end=next(e['ts'] for e in events if e.get('name')=='interaction:end' and (e['pid'],e['tid'])==owner and e['ts']>start)
 own=[e for e in events if (e.get('pid'),e.get('tid'))==owner and start<=e.get('ts',0)<end]
 marks=[{'name':e['name'],'ms':(e['ts']-start)/1000} for e in own if e.get('name','').startswith('undo-residual:') or e.get('name')=='interaction:ready']
 gc=[{'name':e['name'],'ms':(e['ts']-start)/1000,'durationMs':e['dur']/1000} for e in own if e.get('name')=='MinorGC' and e.get('dur')]
 tasks=[e for e in events if (e.get('pid'),e.get('tid'))==owner and e.get('name')=='RunTask' and e.get('dur') and e['ts']<end and e['ts']+e['dur']>start]
 intervals=sorted((max(start,e['ts']),min(end,e['ts']+e['dur'])) for e in tasks);busy=0;last=start
 for a,b in intervals:
  if b>last:busy+=b-max(a,last);last=b
 durations=[]
 for prefix in ['checkpoint-borrowed','checkpoint-compact','checkpoint-output','snapshot-encode','certified-token-metadata','projection-fallback']:
  openings=[]
  for m in marks:
   if m['name']=='undo-residual:'+prefix+'-start':openings.append(m['ms'])
   elif m['name']=='undo-residual:'+prefix+'-end' and openings:
    a=openings.pop(0);b=m['ms'];overlap=[g for g in gc if g['ms']<b and g['ms']+g['durationMs']>a]
    durations.append({'stage':prefix,'startMs':a,'endMs':b,'wallMs':b-a,'minorGCCount':len(overlap),'largestMinorGCSpanMs':max((g['durationMs'] for g in overlap),default=0)})
 row={'phase':phase,'status':result['status'],'traceSHA256':hashlib.sha256(p.read_bytes()).hexdigest(),'traceBytes':p.stat().st_size,'owner':owner,'markers':marks,'stages':durations,'minorGC':gc,'mainMaxTaskMs':max(e['dur']/1000 for e in tasks),'mainBusyUnionMs':busy/1000,'sourceSelection':result['observation' if phase=='input' else 'undoObservation'].get('sourceSelection')}
 rows.append(row)
 print(phase,'markers',len(marks),'maxTask',row['mainMaxTaskMs'],'busy',round(row['mainBusyUnionMs'],3))
 print('early',json.dumps([m for m in marks if m['ms']<100]))
 print('stages',json.dumps(durations))
 print('GC',len(gc),'largest',max((g['durationMs'] for g in gc),default=0),'first',next((g['ms'] for g in gc if g['durationMs']>8.33),None))
(root/'marked-analysis.json').write_text(json.dumps({'phases':rows,'receipts':{k:result[k] for k in ['seedReceipt','editedReceipt','undoReceipt']},'fixture':result['fixture']},indent=2)+'\n')
