import { execFileSync, spawnSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { z } from "zod"
import { summary } from "./metrics"

let head = execFileSync("git", ["rev-parse", "HEAD"], {
	encoding: "utf8",
}).trim()
let prefix = process.env.BENCH_RESULT_PREFIX ?? ""
let setups = {
	classic: {
		target:
			process.env.BENCH_CLASSIC_TARGET ??
			"https://classic-main-alkalye-bench.cshed.carlassmann.com",
		workRoot:
			process.env.BENCH_CLASSIC_WORK_ROOT ?? "/tmp/alkalye-bench-production",
		command: process.env.BENCH_CLASSIC_COMMAND ?? "sync",
	},
	v2: {
		target:
			process.env.BENCH_V2_TARGET ??
			"https://v2-main-alkalye-bench.cshed.carlassmann.com",
		workRoot: process.env.BENCH_V2_WORK_ROOT ?? "/tmp/alkalye-bench-production",
		command: process.env.BENCH_V2_COMMAND ?? "v2",
	},
}
let results: Record<string, Record<string, number[]>> = { classic: {}, v2: {} }
let phases = process.env.BENCH_PHASE === "sw" ? [true] : [false, true]
if (process.env.BENCH_PHASE === "sw") {
	for (let label of Object.keys(setups)) {
		for (let run = 1; run <= 5; run++) {
			let data = JSON.parse(
				await readFile(
					`bench/results/raw/${prefix}${label}-${run}.json`,
					"utf8",
				),
			)
			for (let [name, metric] of Object.entries(data.metrics)) {
				if (name === "returningSwListMs" || name === "offlineSwLargeOpenMs")
					continue
				let values = z.object({ samples: z.array(z.number()) }).parse(metric)
				;(results[label]![name] ??= []).push(...values.samples)
			}
		}
	}
}
for (let serviceWorkersOnly of phases) {
	for (let run = 1; run <= 5; run++) {
		for (let [label, setup] of Object.entries(setups)) {
			execFileSync("work", ["restart", setup.command, "--tailscale"], {
				cwd: setup.workRoot,
				stdio: "inherit",
			})
			let path = `bench/results/raw/${prefix}${label}${serviceWorkersOnly ? "-sw" : ""}-${run}.json`
			let execution = spawnSync(
				"bun",
				[
					"scripts/bench/compare.ts",
					"--target",
					setup.target,
					"--label",
					label,
					"--out",
					path,
					"--runs",
					"1",
					"--edits",
					"200",
					...(serviceWorkersOnly ? ["--sw-only"] : ["--skip-sw"]),
					...(process.env.BENCH_LITERAL_NEWLINES === "1"
						? ["--literal-newlines"]
						: []),
				],
				{
					stdio: "inherit",
					env: {
						...process.env,
						BENCH_JAZZ: label === "classic" ? "0.20.18" : "2.0.0-alpha.61",
						BENCH_GIT_HEAD: label === "classic" ? "8379d4e" : head,
						BENCH_SERVER_NOTE:
							process.env.BENCH_SERVER_NOTE ??
							(label === "classic"
								? "Node production + jazz-run 0.20.19, 32GB heap"
								: "Node production + isolated SQLite"),
					},
				},
			)
			let data = JSON.parse(await readFile(path, "utf8"))
			if (execution.error || data.completedRuns !== 1)
				throw new Error(`Incomplete ${prefix}${label} run ${run}`)
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
			readFile(
				`bench/results/raw/${prefix}${label}-${index + 1}.json`,
				"utf8",
			).then(text => JSON.parse(text)),
		),
	)
	let serviceWorkerRuns = await Promise.all(
		Array.from({ length: 5 }, (_, index) =>
			readFile(
				`bench/results/raw/${prefix}${label}-sw-${index + 1}.json`,
				"utf8",
			).then(text => JSON.parse(text)),
		),
	)

	await writeFile(
		`bench/results/raw/${prefix}${label}.json`,
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
