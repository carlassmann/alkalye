import subprocess,os,json,time,pathlib,statistics
root=pathlib.Path('/tmp/alkalye-peer-run-compare')
for arm in ['base','candidate']: subprocess.run(['git','init','-q'],cwd=root/arm,check=True)
phases=[('oracle2','candidate')]+[(str(i),arm) for i,arms in enumerate([['base','candidate'],['candidate','base'],['base','candidate']]) for arm in arms]
for trial,arm in phases:
 label=trial+'-'+arm;cwd=root/arm;folder=root/label;folder.mkdir(exist_ok=True)
 env=os.environ.copy();env['WORK_STATE_ROOT']=str(folder/'work')
 (cwd/'work.config.js').write_text('export default {project:"peer-run-'+label+'",commands:{server:{run:"bun experiments/performance/twenty-writer-http/server.ts '+str(folder/'data')+'",route:false,portless:false}}}')
 start=subprocess.run(['work','run','server'],cwd=cwd,env=env,text=True,capture_output=True,check=True)
 print('START',label,start.stdout.strip(),flush=True)
 try:
  deadline=time.monotonic()+10
  while True:
   logs=subprocess.run(['work','logs','server'],cwd=cwd,env=env,text=True,capture_output=True,check=True).stdout
   if 'server-ready' in logs:break
   if time.monotonic()>deadline:raise RuntimeError('Server readiness deadline')
   time.sleep(.02)
  driver='oracle.ts' if trial.startswith('oracle') else 'experiment.ts'
  with open(folder/'driver.log','w') as log:
   run=subprocess.run(['bun','experiments/performance/twenty-writer-http/'+driver,'http://127.0.0.1:4470',str(folder/'results.json')],cwd=cwd,env=env,stdout=log,stderr=log,timeout=120)
  if run.returncode:raise RuntimeError('Driver failure '+label)
  boundaries=[json.loads(line) for line in (folder/'driver.log').read_text().splitlines() if line.startswith('{')]
  finish=boundaries[-1]['unixMs'];deadline=time.monotonic()+3
  while True:
   logs=subprocess.run(['work','logs','server'],cwd=cwd,env=env,text=True,capture_output=True,check=True).stdout
   samples=[json.loads(l) for l in logs.splitlines() if l.startswith('{') and 'server-resource-sample' in l]
   if samples and samples[-1]['unixMs']>=finish:break
   if time.monotonic()>deadline:raise RuntimeError('Resource sample deadline')
   time.sleep(.02)
  (folder/'resources.log').write_text(logs)
  r=json.loads((folder/'results.json').read_text());a=boundaries[0]['unixMs'];b=finish
  before=max((s for s in samples if s['unixMs']<=a),key=lambda s:s['unixMs']);after=min((s for s in samples if s['unixMs']>=b),key=lambda s:s['unixMs'])
  r['serverResources']={'leadMs':a-before['unixMs'],'lagMs':after['unixMs']-b,'windowMs':after['unixMs']-before['unixMs'],'userUs':after['cpu']['user']-before['cpu']['user'],'systemUs':after['cpu']['system']-before['cpu']['system'],'maxRss':max(s['rss'] for s in samples if before['unixMs']<=s['unixMs']<=after['unixMs'])}
  (folder/'results.json').write_text(json.dumps(r,indent=2))
  v=sorted(x['requestMs'] for x in r['results']);print('DONE',label,'median',statistics.median(v),'p95',v[56],'max',max(v),'duration',r['elapsedMs'],'projection',r['projectionExact'],flush=True)
 finally:subprocess.run(['work','stop','server'],cwd=cwd,env=env,text=True,capture_output=True)
