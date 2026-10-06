import type * as Metric from "effect/Metric"

export function documentDiagnostics(
	metrics: readonly Metric.Metric.Snapshot[],
) {
	let operations = [
		"open",
		"sync",
		"create",
		"snapshot",
		"commit",
		"withdraw",
		"history",
		"action",
		"chain",
		"other",
	]
	let outcomes = [
		"success",
		"interrupted",
		"access",
		"conflict",
		"storage",
		"network",
		"defect",
		"failure",
	]
	let lines: string[] = []
	for (let operation of operations) {
		let counts: string[] = []
		for (let outcome of outcomes) {
			let count = metrics.find(
				metric =>
					metric.id === "alkalye_document_calls" &&
					metric.attributes?.operation === operation &&
					metric.attributes.outcome === outcome,
			)
			if (count?.type === "Counter" && Number(count.state.count) > 0)
				counts.push(`${count.state.count} ${outcome}`)
		}
		let latency = metrics.find(
			metric =>
				metric.id === "alkalye_document_duration_ms" &&
				metric.attributes?.operation === operation,
		)
		if (!counts.length) continue
		let timing =
			latency?.type === "Histogram" && latency.state.count > 0
				? `; mean ${Math.round(latency.state.sum / latency.state.count)} ms`
				: ""
		lines.push(`${operation}: ${counts.join(", ")}${timing}`)
	}
	return [
		"Document operations in this app session",
		...(lines.length ? lines : ["No document operations recorded."]),
	].join("\n")
}
