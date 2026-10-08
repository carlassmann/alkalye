import os,subprocess,re,time,json,hashlib,urllib.request
root='/tmp/alkalye-terminal-projected';order=['baseline','candidate','candidate','baseline','baseline','candidate'];counts={'baseline':0,'candidate':0};manifest=[]
for arm in order:
 counts[arm]+=1;n=counts[arm];folder=root+'/'+arm;env=os.environ.copy();env['WORK_STATE_ROOT']='/tmp/alkalye-terminal-projected-work-'+arm
 subprocess.run(['git','init','-b','codex/terminal-projected-'+arm],cwd=folder,capture_output=True,check=True)
 subprocess.run(['work','run','web'],cwd=folder,env=env,capture_output=True,check=True)
 url=None;deadline=time.time()+20
 try:
  while time.time()<deadline:
   logs=subprocess.run(['work','logs','web'],cwd=folder,env=env,capture_output=True,text=True,check=True).stdout
   urls=re.findall(r'http://localhost:\d+/',logs)
   if urls:
    try:
     with urllib.request.urlopen(urls[-1],timeout=.3) as response:
      if response.status==200:url=urls[-1];break
    except Exception:pass
   time.sleep(.1)
  if not url:raise Exception('Managed observable server URL unavailable')
  output=root+'/'+arm+'-human-'+str(n)+'.json';hashes={}
  for name in ['src/shared/crdt.ts','worker-session.ts','browser-fixture.ts','sustained.ts','assets/worker.js','assets/browser-fixture.js']:
   hashes[name]=hashlib.sha256(open(folder+'/'+name,'rb').read()).hexdigest()
  print('START',arm,n,url,flush=True)
  with open(output+'.log','w') as log:
   result=subprocess.run(['bun','sustained.ts',url+'?size=1048576',output,'human-peer'],cwd=folder,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=120)
  manifest.append({'arm':arm,'trial':n,'url':url,'output':output,'exit':result.returncode,'hashes':hashes})
  json.dump(manifest,open(root+'/manifest.json','w'),indent=2)
  print('DONE',arm,n,result.returncode,flush=True)
  if result.returncode:break
 finally:
  subprocess.run(['work','stop','web'],cwd=folder,env=env,capture_output=True)
