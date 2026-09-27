import { readFileSync } from "node:fs"
import console from "node:console"
import { URL } from "node:url"

function load(label, suffix = "") {
	return JSON.parse(
		readFileSync(
			new URL(`evidence/${label}${suffix}.json`, import.meta.url),
			"utf8",
		),
	)
}
function statistic(rows, key, quantile = 0.5) {
	let values = rows.map(row => row[key]).sort((a, b) => a - b)
	return values[Math.ceil(values.length * quantile) - 1]
}
function format(before, after) {
	return `${before.toFixed(0)} → ${after.toFixed(0)} (${((after / before - 1) * 100).toFixed(1)}%)`
}
for (let cpu of [1, 4])
	for (let mode of ["cold-http", "cached-http", "service-worker"]) {
		let before = load("baseline").filter(r => r.cpu === cpu && r.mode === mode)
		let after = load("changed").filter(r => r.cpu === cpu && r.mode === mode)
		console.log(
			`| ${cpu}× ${mode} | ${["ready", "uncovered", "interactive"].flatMap(key => [0.5, 0.95].map(q => format(statistic(before, key, q), statistic(after, key, q)))).join(" | ")} |`,
		)
	}
for (let suffix of ["-switch", "-features", "-video", "-import"]) {
	let before = load("baseline", suffix),
		after = load("changed", suffix)
	for (let group of new Set(before.map(r => r.feature ?? r.cpu ?? "video"))) {
		let b = before.filter(r => (r.feature ?? r.cpu ?? "video") === group),
			a = after.filter(r => (r.feature ?? r.cpu ?? "video") === group)
		for (let key of suffix === "-switch" ? ["ready", "interactive"] : ["ms"])
			console.log(
				suffix,
				group,
				key,
				...[0.5, 0.95].map(q =>
					format(statistic(b, key, q), statistic(a, key, q)),
				),
			)
	}
}
for (let key of ["encoded", "decoded"]) {
	let sums = ["baseline", "changed"].map(label =>
		load(label)[0].resources.reduce((sum, r) => sum + r[key], 0),
	)
	console.log(key, format(...sums))
}
