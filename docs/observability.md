# Document observability

Document boundaries use Effect spans, metrics, Clock and Ref. Each browser transport and server runtime owns an isolated Effect metric registry. No metrics endpoint exposes another account's activity.

## Reading diagnostics

Settings → Startup diagnostics shows completed document operations and mean latency. Copying the diagnostic report includes these aggregates. They reset when this app session ends. The server returned by `startServer` exposes a `diagnostics` Effect for local operator integrations; the HTTP API does not expose it.

`alkalye_document_calls` counts outcomes: success, interrupted, access, conflict, storage, network, defect and failure. `alkalye_document_duration_ms` records latency in fixed buckets. Labels contain only fixed boundary, operation and outcome names. No account IDs, document IDs, text, blob names or credentials appear in these metrics.

The browser measures session acquisition, synchronization and typed document requests. Server handlers measure authorized store work. A snapshot unavailable to its caller counts as access failure. Authentication failures rejected before document handlers are not included in server document metrics. The client sees their access outcome.

## Logs and tracing

Normal edits and successful fast requests emit no logs. Offline transport failures, access denial and expected conflicts remain counters. Slow successful operations emit a warning above two seconds, at most once per operation per minute. Server storage failures emit one outage log per operation, followed by one recovery log when that operation succeeds. Logs contain bounded categories, duration and trace/span IDs; they exclude error objects that could carry document content.

Effect's native HTTP client propagates trace context; the HTTP server consumes it. Document spans supply bounded operation names and outcomes. Account headers join Effect's default authorization/cookie redaction list.

No external telemetry exporter is enabled. Native HTTP spans can contain request URLs and query strings. Before enabling an exporter, sanitize these attributes and disable tracing for authorization URLs carrying secrets. Document diagnostics do not dump native HTTP spans.

## Limits

These metrics measure boundary work, not time until text paints. Cached acquisition includes the local session's initialization; it does not make an HTTP snapshot request. Calls interrupted before starting their observed body are not counted. Live presence messages and keystrokes are deliberately uninstrumented. Mean latency alone does not describe a slow tail; the histogram retains fixed buckets for operator integrations.

written with gpt-6 in codex
