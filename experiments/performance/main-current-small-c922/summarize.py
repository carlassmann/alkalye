"""Unrun adapter of production-native-oct8/summarize.py; no CPU sampling."""
import json
import pathlib
import sys


def union_ms(events, names, start, end):
    intervals = sorted(
        (max(start, item["ts"]), min(end, item["ts"] + item.get("dur", 0)))
        for item in events
        if item.get("ph") == "X" and item.get("name") in names
        and item.get("ts", 0) < end
        and item.get("ts", 0) + item.get("dur", 0) > start
    )
    total = 0
    last = start
    for low, high in intervals:
        low = max(low, last)
        if high > low:
            total += high - low
            last = high
    return total / 1000


rows = json.loads(pathlib.Path(sys.argv[1]).read_text())
summary = []
for row in rows:
    result = {key: row.get(key) for key in ["version", "commit", "cell", "trial", "status", "stage", "error"]}
    result["gates"] = {key: bool(row.get(key)) for key in ["seedReceipt", "editedReceipt", "undoReceipt"]}
    trace = pathlib.Path(row.get("trace", "missing"))
    if not trace.is_file():
        result["traceStatus"] = "unavailable"
        summary.append(result)
        continue
    decoded = json.loads(trace.read_text())
    events = decoded.get("traceEvents", []) if isinstance(decoded, dict) else decoded
    marks = {event["name"]: event for event in events if event.get("name") in ["interaction:start", "interaction:ready", "interaction:end"]}
    if "interaction:start" not in marks or "interaction:end" not in marks:
        result["traceStatus"] = "incomplete-window"
        summary.append(result)
        continue
    first, end = marks["interaction:start"], marks["interaction:end"]
    start, finish = first["ts"], end["ts"]
    thread = (first.get("pid"), first.get("tid"))
    main = [event for event in events if (event.get("pid"), event.get("tid")) == thread]
    tasks = [event for event in main if event.get("ph") == "X" and event.get("name") == "RunTask" and event.get("ts", 0) <= finish and event.get("ts", 0) + event.get("dur", 0) >= start]
    initial = [event for event in tasks if event["ts"] <= start <= event["ts"] + event.get("dur", 0)]
    aftermath = [event for event in tasks if event not in initial]
    result.update({
        "traceStatus": "complete-window",
        "initialEnclosingTaskMs": max((event.get("dur", 0) / 1000 for event in initial), default=None),
        "aftermathMaxTaskMs": max((event.get("dur", 0) / 1000 for event in aftermath), default=None),
        "windowMaxTaskMs": max((event.get("dur", 0) / 1000 for event in tasks), default=None),
        "presentationOpportunityMs": (marks["interaction:ready"]["ts"] - start) / 1000 if "interaction:ready" in marks else None,
        "layoutUnionMs": union_ms(main, ["Layout"], start, finish),
        "paintUnionMs": union_ms(main, ["Paint"], start, finish),
        "gcUnionMs": union_ms(main, ["MinorGC", "MajorGC", "V8.GCScavenger", "V8.GCCompactor"], start, finish),
        "largestTasks": [{"relativeStartMs": (event["ts"] - start) / 1000, "durationMs": event.get("dur", 0) / 1000} for event in sorted(tasks, key=lambda event: event.get("dur", 0), reverse=True)[:5]],
        "eventTiming": row.get("observation", {}).get("probe", {}).get("eventTiming", []),
    })
    summary.append(result)
pathlib.Path(sys.argv[2]).write_text(json.dumps(summary, indent=2) + "\n")
