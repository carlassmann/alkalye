import json,os,sys
root='/tmp/alkalye-rich-undo-residual';alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
def vlq(segment):
 values=[];acc=shift=0
 for char in segment:
  number=alphabet.index(char);acc|=(number&31)<<shift
  if number&32:shift+=5
  else:values.append(-(acc>>1) if acc&1 else acc>>1);acc=shift=0
 return values
cache={}
def map(frame):
 url=frame.get('url','');asset=url.split(':4461/')[-1];p=root+'/runtime/dist/'+asset+'.map'
 if not os.path.exists(p):return None
 if p not in cache:
  d=json.load(open(p));lines=[];source=line=column=name=0
  for raw in d['mappings'].split(';'):
   generated=0;segments=[]
   for segment in raw.split(','):
    if not segment:continue
    v=vlq(segment);generated+=v[0]
    if len(v)>=4:
     source+=v[1];line+=v[2];column+=v[3]
     if len(v)>=5:name+=v[4]
     segments.append((generated,source,line,column,name))
   lines.append(segments)
  cache[p]=(d,lines)
 d,lines=cache[p];ln=frame.get('lineNumber',-1);col=frame.get('columnNumber',-1)
 if ln<0 or ln>=len(lines):return None
 segments=[x for x in lines[ln] if x[0]<=col]
 if not segments:return None
 _,source,line,column,name=segments[-1]
 return {'source':d['sources'][source],'line':line+1,'column':column+1,'name':d['names'][name] if name<len(d['names']) else ''}


data=json.load(open(root+"/sampled-analysis.json"))
for profile in data["profiles"]:
 for row in profile["self"]+profile["inclusive"]:row["mapped"]=map(row["frame"])
json.dump(data,open(root+"/sampled-analysis.json","w"),indent=2)
for profile in data["profiles"]:
 print("main",profile["main"],"sampledTargetTaskSelfMs",profile["sampledTargetTaskSelfMs"])
 for row in profile["self"][:15]:print(row["selfMs"],row["inclusiveMs"],row["frame"].get("functionName"),row["mapped"])
