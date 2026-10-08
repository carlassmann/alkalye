import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
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

result = json.loads((root / 'result.json').read_text())
tasks = analyze(root / 'two-writers.trace.json.txt', 'coauthor:start', 'coauthor:end', 'coauthor:input')
writers = [row for row in result['observations'] if 'writer' in row]
latencies = []
for writer in writers:
    event = writer['browser']['events'][0]
    marker = str(writer['writer'] + 1)
    for observer in writers:
        if observer['writer'] != writer['writer']:
            latencies.append({'writer': writer['writer'], 'observer': observer['writer'], 'marker': marker, 'trustedInputEpochMs': event['time'], 'observedNextFrameEpochMs': observer['browser']['seen'][marker], 'nextFrameOpportunityMs': observer['browser']['seen'][marker] - event['time']})
output = {'passed': result['passed'], 'primaryMainThread': tasks, 'peerSourceNextFrameOpportunities': latencies, 'scope': 'one two-writer pilot; not completed paint, physical refresh rate, sustained capacity or twenty browser clients'}
(root / 'analysis.json').write_text(json.dumps(output, indent=2))
print(json.dumps({'inputTaskMs':tasks['initiatingTaskMs'],'largestTaskMs':tasks['largestTaskMs'],'aftermathTaskMs':tasks['aftermathTaskMs'],'busyUnionMs':tasks['busyUnionMs'],'peerNextFrameOpportunityMs':[row['nextFrameOpportunityMs'] for row in latencies]}))
