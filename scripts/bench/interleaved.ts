import { execFileSync, spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { z } from "zod"
import { summary } from "./metrics"

let head = execFileSync("git", ["rev-parse", "HEAD"], {
	encoding: "utf8",
}).trim()
let results: Record<string, Record<string, number[]>> = { classic: {}, v2: {} }
for (let serviceWorkersOnly of [false, true]) {
	for (let run = 1; run <= 5; run++) {
		for (let label of ["classic", "v2"]) {
			execFileSync(
				"work",
				["restart", label === "classic" ? "sync" : "v2", "--tailscale"],
				{ cwd: "/tmp/alkalye-bench-production", stdio: "inherit" },
			)
			let path = `bench/results/raw/${label}${serviceWorkersOnly ? "-sw" : ""}-${run}.json`
			let execution = spawnSync(
				"bun",
				[
					"scripts/bench/compare.ts",
					"--target",
					`https://${label}-main-alkalye-bench.cshed.carlassmann.com`,
					"--label",
					label,
					"--out",
					path,
					"--runs",
					"1",
					"--edits",
					"200",
					...(serviceWorkersOnly ? ["--sw-only"] : ["--skip-sw"]),
				],
				{
					stdio: "inherit",
					env: {
						...process.env,
						BENCH_JAZZ: label === "classic" ? "0.20.18" : "2.0.0-alpha.61",
						BENCH_GIT_HEAD: label === "classic" ? "8379d4e" : head,
						BENCH_SERVER_NOTE:
							label === "classic"
								? "Node production + jazz-run 0.20.19, 32GB heap"
								: "Node production + isolated SQLite",
					},
				},
			)
			let data = JSON.parse(await readFile(path, "utf8"))
			if (execution.error || data.completedRuns !== 1)
				throw new Error(`Incomplete ${label} run ${run}`)
			if (execution.status !== 0) process.exitCode = 1
			for (let [name, metric] of Object.entries(data.metrics)) {
				if (
					serviceWorkersOnly !==
					(name === "returningSwListMs" || name === "offlineSwLargeOpenMs")
				)
					continue
				let values = z.object({ samples: z.array(z.number()) }).parse(metric)
				;(results[label]![name] ??= []).push(...values.samples)
			}
		}
	}
}
for (let label of ["classic", "v2"]) {
	let runs = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			readFile(`bench/results/raw/${label}-${index + 1}.json`, "utf8").then(
				text => JSON.parse(text),
			),
		),
	)
	let serviceWorkerRuns = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			readFile(`bench/results/raw/${label}-sw-${index + 1}.json`, "utf8").then(
				text => JSON.parse(text),
			),
		),
	)

	await writeFile(
		`bench/results/raw/${label}.json`,
		JSON.stringify(
			{
				...runs[0],
				config: { ...runs[0].config, runs: 5 },
				completedRuns: 5,
				runLoads: runs.flatMap((run, index) =>
					run.runLoads.map((load: object) => ({ ...load, run: index + 1 })),
				),
				syncDiagnostics: runs.flatMap(run => run.syncDiagnostics),
				scenarioFailures: [
					...runs
						.flatMap(run => run.scenarioFailures)
						.filter(
							(failure: { scenario: string }) =>
								failure.scenario !== "returningServiceWorker" &&
								failure.scenario !== "offlineServiceWorker",
						),
					...serviceWorkerRuns.flatMap(run => run.scenarioFailures),
				],
				excludedPostReplaySwFailures: runs
					.flatMap(run => run.scenarioFailures)
					.filter(
						(failure: { scenario: string }) =>
							failure.scenario === "returningServiceWorker" ||
							failure.scenario === "offlineServiceWorker",
					),
				serviceWorkerRuns,
				metrics: Object.fromEntries(
					Object.entries(results[label]!).map(([name, samples]) => [
						name,
						summary(samples),
					]),
				),
				individualRuns: runs,
			},
			null,
			"\t",
		) + "\n",
	)
}
