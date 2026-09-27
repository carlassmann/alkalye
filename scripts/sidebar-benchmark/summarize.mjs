import { readFileSync } from "node:fs"
import console from "node:console"

function percentile(values, fraction) {
	let sorted = [...values].sort((left, right) => left - right)
	return sorted[Math.ceil(sorted.length * fraction) - 1]
}
function summary(label, cpu, size, metric) {
	let runs = JSON.parse(
		readFileSync(
			new globalThis.URL(`./results/${label}-${cpu}.json`, import.meta.url),
			"utf8",
		),
	).filter(run => run.size === size && run.run > 0)
	let values = runs.map(run => run[metric])
	return {
		median: percentile(values, 0.5),
		p95: percentile(values, 0.95),
		n: values.length,
	}
}
console.log(
	"| Library | CPU | Document | Endpoint | Before median / p95 | After median / p95 | Median change | n each |",
)
console.log("|---|---|---|---|---:|---:|---:|---:|")
for (let [library, before, after] of [
	["5", "baseline-repeat", "changed"],
	["205", "baseline-library", "changed-library"],
])
	for (let cpu of [1, 4])
		for (let size of ["small", "large"])
			for (let metric of ["ready", "paint", "interactive"]) {
				let baseline = summary(before, cpu, size, metric)
				let changed = summary(after, cpu, size, metric)
				let percent = (changed.median / baseline.median - 1) * 100
				console.log(
					`| ${library} | ${cpu}× | ${size} | ${metric} | ${baseline.median.toFixed(1)} / ${baseline.p95.toFixed(1)} | ${changed.median.toFixed(1)} / ${changed.p95.toFixed(1)} | ${percent.toFixed(1)}% | ${baseline.n} |`,
				)
			}
