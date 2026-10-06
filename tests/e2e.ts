import { mkdir, mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { build } from "../build"

let fullSuite = [
	"tests/browser-native-eventlog.ts",
	"tests/browser-document-api.ts",
	"tests/browser-document-app.ts",
	"tests/browser-native-tools.ts",
	"tests/browser-native-portability.ts",
	"tests/browser-native-invitations.ts",
	"tests/browser-document-sharing.ts",
	"tests/browser-library-filters.ts",
	"tests/browser-native-folders.ts",
	"tests/browser-native-commands.ts",
	"tests/browser-storage.ts",
	"tests/browser-motion.ts",
	"tests/browser-floating-actions.ts",
	"tests/browser-editor-context-menu.ts",
	"tests/browser-editor-prettification.ts",
	"tests/browser-ui-parity.ts",
	"tests/browser-ui-leftovers.ts",
	"tests/browser-sidebar-menus.ts",
	"tests/browser-dialog.ts",
	"tests/browser-toasts.ts",
	"tests/browser-screen-parity.ts",
	"tests/browser-presentation-state.ts",
	"tests/browser-workspace-deletion.ts",
	"tests/browser-mcp.ts",
	"tests/browser-teleprompter.ts",
	"tests/browser-theme-library.ts",
	"tests/browser-laser-displays.ts",
	"tests/browser-workspace-avatars.ts",
	"tests/browser-whiteboard.ts",
	"tests/browser-live-polling.ts",
	"tests/browser-live-network-fallback.ts",
]
let moduleSuite = [
	"tests/browser-document-api.ts",
	"tests/browser-native-eventlog.ts",
	"tests/browser-storage.ts",
]
let mode = Bun.argv.includes("--modules")
	? "modules"
	: Bun.argv.includes("--full")
		? "full"
		: "fast"
let selected = Bun.argv
	.filter(argument => argument.startsWith("--suite="))
	.map(argument => argument.slice(8))
if (selected.length) mode = "selected"
let suites = selected.length
	? [...fullSuite, "tests/browser-fast-app.ts"].filter(path =>
			selected.some(
				name => path === name || path === `tests/browser-${name}.ts`,
			),
		)
	: mode === "modules"
		? moduleSuite
		: mode === "full"
			? fullSuite
			: ["tests/browser-fast-app.ts"]
if (!suites.length) throw new Error("No browser suites matched")
let requestedWorkers = Number(process.env.TEST_WORKERS ?? "2")
if (
	!Number.isInteger(requestedWorkers) ||
	requestedWorkers < 1 ||
	requestedWorkers > 4
)
	throw new Error("TEST_WORKERS must be between 1 and 4")
let directory = await mkdtemp(join(tmpdir(), "alkalye-browser-run-"))
let assets = process.env.ALKALYE_TEST_ASSETS ?? join(directory, "assets")
let developmentAssets = join(directory, "development-assets")
let logs = join("test-results", `${mode}-${Date.now()}`)
let failures: string[] = []
let next = 0
let stopping = false
let running = new Set<number>()
for (let signal of ["SIGINT", "SIGTERM"])
	process.once(signal, () => {
		stopping = true
		process.exitCode = signal === "SIGINT" ? 130 : 143
		for (let pid of running) stopProcessGroup(pid)
	})
let started = performance.now()
try {
	await mkdir(logs, { recursive: true })
	if (mode !== "modules" && !process.env.ALKALYE_TEST_ASSETS)
		await build(assets)
	if (suites.includes("tests/browser-ui-parity.ts"))
		await build(developmentAssets, true)
	await Promise.all(
		Array.from(
			{ length: Math.min(requestedWorkers, suites.length) },
			runWorker,
		),
	)
	console.log(
		`${mode}: ${suites.length} suites, ${failures.length} failed, ${((performance.now() - started) / 1000).toFixed(1)}s`,
	)
	if (failures.length) process.exitCode = 1
} finally {
	await rm(directory, { recursive: true, force: true })
}

async function runWorker() {
	while (!stopping && next < suites.length) {
		let path = suites[next++]
		if (!path) return
		let start = performance.now()
		let log = join(logs, path.split("/").at(-1) + ".log")
		let output = await open(log, "w")
		let child = Bun.spawn(["bun", path], {
			stdout: output.fd,
			stderr: output.fd,
			detached: true,
			env: {
				...process.env,
				...(mode === "modules"
					? {}
					: {
							ALKALYE_TEST_ASSETS:
								path === "tests/browser-ui-parity.ts"
									? developmentAssets
									: assets,
						}),
			},
		})
		running.add(child.pid)
		let expired = false
		let timeout = setTimeout(() => {
			expired = true
			console.error(`${path}: exceeded five minutes`)
			stopProcessGroup(child.pid)
		}, 300000)
		let code = await child.exited
		clearTimeout(timeout)
		running.delete(child.pid)
		await output.close()
		if (expired) code = 1

		console.log(
			`${code ? "FAIL" : "PASS"} ${path} (${((performance.now() - start) / 1000).toFixed(1)}s)`,
		)
		if (code) {
			failures.push(path)
			console.error(
				(await Bun.file(log).text()).slice(-12000),
				`Full log: ${log}`,
			)
		}
	}
}

function stopProcessGroup(pid: number) {
	try {
		process.kill(-pid, "SIGTERM")
		setTimeout(() => {
			if (running.has(pid))
				try {
					process.kill(-pid, "SIGKILL")
				} catch {}
		}, 3000).unref()
	} catch {}
}
