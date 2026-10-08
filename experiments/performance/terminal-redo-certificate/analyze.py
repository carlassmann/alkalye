import collections
import hashlib
import json
from pathlib import Path
import statistics

root = Path('/tmp/alkalye-redo-benchmark')
rows = []

def analyze(path, start_name, end_name, input_name=None):
    raw = Path(path).read_bytes()
    events = json.loads(raw)['traceEvents']
    marks = {event['name']: event for event in events if event.get('name') in [start_name, end_name, input_name]}
    start, end = marks[start_name], marks[end_name]
    thread = start['pid'], start['tid']
    relevant = [event for event in events if event.get('ph') == 'X' and (event.get('pid'), event.get('tid')) == thread and event.get('ts', 0) <= end['ts'] and event.get('ts', 0) + event.get('dur', 0) >= start['ts']]
    tasks = [event for event in relevant if event.get('name') == 'RunTask']
    initiating = [event for event in tasks if event['ts'] <= start['ts'] <= event['ts'] + event.get('dur', 0) or input_name and event['ts'] <= marks[input_name]['ts'] <= event['ts'] + event.get('dur', 0)]
    intervals = sorted((max(event['ts'], start['ts']), min(event['ts'] + event.get('dur', 0), end['ts'])) for event in tasks)
    union = []
    for left, right in intervals:
        if union and left <= union[-1][1]:
            union[-1] = union[-1][0], max(union[-1][1], right)
        else:
            union.append((left, right))
    def largest(values):
        return max((event.get('dur', 0) / 1000 for event in values), default=0)
    top = max(tasks, key=lambda event: event.get('dur', 0))
    children = [event for event in relevant if event.get('name') in ['FunctionCall', 'RunMicrotasks', 'MajorGC', 'MinorGC', 'Layout', 'Paint', 'TimerFire', 'EventDispatch'] and event['ts'] >= top['ts'] and event['ts'] + event.get('dur', 0) <= top['ts'] + top.get('dur', 0)]
    return {
        'trace': str(path), 'sha256': hashlib.sha256(raw).hexdigest(),
        'mainThread': thread, 'windowMs': (end['ts'] - start['ts']) / 1000,
        'initiatingTaskMs': largest(initiating), 'largestTaskMs': largest(tasks),
        'aftermathTaskMs': largest([event for event in tasks if event not in initiating]),
        'taskCountOver833': sum(event.get('dur', 0) > 8333.333 for event in tasks),
        'busyUnionMs': sum(right - left for left, right in union) / 1000,
        'layoutTotalMs': sum(event.get('dur', 0) for event in relevant if event.get('name') == 'Layout') / 1000,
        'paintTotalMs': sum(event.get('dur', 0) for event in relevant if event.get('name') == 'Paint') / 1000,
        'majorGcMaxMs': largest([event for event in relevant if event.get('name') == 'MajorGC']),
        'minorGcMaxMs': largest([event for event in relevant if event.get('name') == 'MinorGC']),
        'largestTaskBreakdown': {
            'relativeMs': (top['ts'] - start['ts']) / 1000,
            'taskMs': top.get('dur', 0) / 1000,
            'childrenInclusiveNotAdditive': [{'name': event['name'], 'durationMs': event.get('dur', 0) / 1000, 'args': event.get('args', {})} for event in sorted(children, key=lambda event: event.get('dur', 0), reverse=True)[:8]],
        },
    }

for arm in ['baseline', 'candidate']:
 cells=[]
 for trial in range(3):
  state=json.loads((root/f'result-{arm}-{trial}.json').read_text())
  cells.append({'arm':arm,'trial':trial,'redo':analyze(root/f'redo-{arm}-{trial}.trace.json','redo:start','redo:end'),'state':state})
 rows.extend(cells)
summaries=[]
for arm in ['baseline','candidate']:
 cells=[row for row in rows if row['arm']==arm]
 summary={'arm':arm,'n':len(cells)}
 for key in ['initiatingTaskMs','aftermathTaskMs','largestTaskMs','busyUnionMs','layoutTotalMs','paintTotalMs','majorGcMaxMs','minorGcMaxMs','taskCountOver833']:
  summary[key]={'median':statistics.median(row['redo'][key] for row in cells),'max':max(row['redo'][key] for row in cells)}
 summary['sampledMainHeapUsed']={'median':statistics.median(row['state']['state']['observation']['heap']['used'] for row in cells),'max':max(row['state']['state']['observation']['heap']['used'] for row in cells)}
 summaries.append(summary)
bundles=[]
for arm,path in [('baseline',root/'baseline/dist/app.js'),('candidate',Path('/tmp/alkalye-terminal-redo/candidate/dist/app.js'))]:
 data=path.read_bytes();bundles.append({'arm':arm,'entryBytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
output={'rows':rows,'summaries':summaries,'bundles':bundles}
(root/'analysis.json').write_text(json.dumps(output,indent=2))
print(json.dumps({'summaries':summaries,'bundles':bundles},indent=2))
