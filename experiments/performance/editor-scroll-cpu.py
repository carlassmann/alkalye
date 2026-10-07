"""Decode renderer CPU samples and union task occupancy from agent-browser traces."""
import argparse
import bisect
import collections
import json
import pathlib

parser = argparse.ArgumentParser()
parser.add_argument("trace", type=pathlib.Path)
parser.add_argument("assets", type=pathlib.Path)
parser.add_argument("output", type=pathlib.Path)
arguments = parser.parse_args()
events = json.loads(arguments.trace.read_text())["traceEvents"]
start = next(event for event in events if event.get("name") == "critical:scroll:start")
end = next(event for event in events if event.get("name") == "critical:scroll:end")
scoped = [event for event in events if event.get("pid") == start["pid"]
          and event.get("tid") == start["tid"]
          and start["ts"] <= event.get("ts", 0) <= end["ts"]]
tasks = sorted((event for event in scoped if event.get("name") == "RunTask"),
               key=lambda event: -event.get("dur", 0))[:2]
profile = next(event for event in events if event.get("name") == "Profile"
               and event["pid"] == start["pid"] and event["tid"] == start["tid"])
chunks = [event for event in events if event.get("name") == "ProfileChunk"
          and event["pid"] == profile["pid"] and event["id"] == profile["id"]]
nodes = {}
samples = []
clock = profile["args"]["data"]["startTime"]
for event in sorted(chunks, key=lambda item: item["ts"]):
    data = event["args"]["data"]
    cpu = data.get("cpuProfile", {})
    for node in cpu.get("nodes", []):
        nodes[node["id"]] = node
    for node, delta in zip(cpu.get("samples", []), data.get("timeDeltas", [])):
        clock += delta
        # Gaps between sample chunks must not become attributed function time.
        samples.append((clock, node, max(0, min(delta, 1000))))

alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
source_maps = {}


def decode_segment(segment):
    values = []
    value = shift = 0
    for character in segment:
        digit = alphabet.index(character)
        value |= (digit & 31) << shift
        if digit & 32:
            shift += 5
        else:
            values.append(-(value >> 1) if value & 1 else value >> 1)
            value = shift = 0
    return values


def location(frame):
    url = frame.get("url", "")
    name = frame.get("functionName", "")
    line = frame.get("lineNumber", -1)
    column = frame.get("columnNumber", -1)
    if not url.startswith("http://localhost:"):
        return name
    if url not in source_maps:
        mapping_path = arguments.assets / (url.rsplit("/", 1)[-1] + ".map")
        lines = None
        if mapping_path.exists():
            mapping = json.loads(mapping_path.read_text())
            source = source_line = source_column = 0
            lines = []
            for encoded in mapping["mappings"].split(";"):
                generated_column = 0
                entries = []
                for segment in encoded.split(","):
                    if not segment:
                        continue
                    values = decode_segment(segment)
                    generated_column += values[0]
                    if len(values) < 4:
                        continue
                    source += values[1]
                    source_line += values[2]
                    source_column += values[3]
                    entries.append((generated_column, mapping["sources"][source],
                                    source_line + 1, source_column + 1))
                lines.append(entries)
        source_maps[url] = lines
    lines = source_maps[url]
    if lines is None or line < 0 or line >= len(lines):
        return f"{name} {url}:{line + 1}:{column + 1}"
    entries = lines[line]
    index = bisect.bisect_right([entry[0] for entry in entries], column) - 1
    if index < 0:
        return name
    _, source, source_line, source_column = entries[index]
    return f"{name} {source}:{source_line}:{source_column}"


output = []
for task in tasks:
    own = collections.Counter()
    inclusive = collections.Counter()
    count = 0
    for timestamp, node, weight in samples:
        if not task["ts"] <= timestamp <= task["ts"] + task["dur"]:
            continue
        own[node] += weight
        count += 1
        visited = set()
        while node in nodes and node not in visited:
            visited.add(node)
            inclusive[node] += weight
            node = nodes[node].get("parent")
    output.append({
        "taskMs": task["dur"] / 1000,
        "samples": count,
        "self": [{"ms": round(weight / 1000, 3),
                  "source": location(nodes[node]["callFrame"])}
                 for node, weight in own.most_common(15)],
        "inclusive": [{"ms": round(weight / 1000, 3),
                       "source": location(nodes[node]["callFrame"])}
                      for node, weight in inclusive.most_common(24)],
    })
intervals = sorted((max(start["ts"], event["ts"]),
                    min(end["ts"], event["ts"] + event["dur"]))
                   for event in scoped if event.get("name") == "RunTask" and event.get("dur"))
merged = []
for begin, finish in intervals:
    if merged and begin <= merged[-1][1]:
        merged[-1] = (merged[-1][0], max(finish, merged[-1][1]))
    else:
        merged.append((begin, finish))
result = {"scopeMs": (end["ts"] - start["ts"]) / 1000,
          "runTaskUnionMs": sum(finish - begin for begin, finish in merged) / 1000,
          "sampledTasks": output}
arguments.output.write_text(json.dumps(result, indent=2) + "\n")
