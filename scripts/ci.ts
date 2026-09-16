import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { prependedEntryCount, isChangelogEntry } from "@/shared/changelog"

let ROOT = resolve(import.meta.dirname ?? ".", "..")
let CI_TIMEOUT_MS = 15 * 60 * 1_000
let CAPTURE_TIMEOUT_MS = 60 * 1_000
let CHANGELOG_PATH = "public/changelog.json"
let SIGNOFF_INSTALL_COMMAND =
	"gh extension install basecamp/gh-signoff --pin v0.4.1"
let ciDeadline: number

function capture(command: string[]): string {
	let result = spawnSync(command[0], command.slice(1), {
		cwd: ROOT,
		encoding: "utf8",
		timeout: CAPTURE_TIMEOUT_MS,
	})
	if (result.status !== 0) {
		let reason = result.stderr?.trim() || String(result.error ?? "")
		throw new Error(`${command.join(" ")} failed: ${reason || "no output"}`)
	}
	return result.stdout.trim()
}

function run(name: string, command: string[], env = process.env) {
	process.stdout.write(`\n── ${name} ──\n\n`)
	let timeout = Math.max(ciDeadline - Date.now(), 1)
	let result = spawnSync(command[0], command.slice(1), {
		cwd: ROOT,
		env,
		stdio: "inherit",
		timeout,
	})
	if (result.status === 0) return
	if (
		result.error &&
		"code" in result.error &&
		result.error.code === "ETIMEDOUT"
	) {
		throw new Error("Local CI exceeded its 15-minute timeout")
	}
	throw new Error(`${name} failed with exit code ${result.status ?? 1}`)
}

function requireSignoffExtension() {
	let result = spawnSync("gh", ["signoff", "--help"], {
		cwd: ROOT,
		stdio: "ignore",
	})
	if (result.status === 0) return
	throw new Error(
		`gh-signoff is required. Install it with:\n${SIGNOFF_INSTALL_COMMAND}`,
	)
}

function workingTreeChanges(): string {
	return capture(["git", "status", "--porcelain=v1", "--untracked-files=all"])
}

function requireCleanWorkingTree() {
	let changes = workingTreeChanges()
	if (!changes) return
	throw new Error(
		`Commit or remove working-tree changes before CI:\n${changes}`,
	)
}

function requireTestedState(testedSha: string) {
	let currentSha = capture(["git", "rev-parse", "HEAD"])
	if (currentSha !== testedSha) {
		throw new Error(
			`HEAD changed during CI: tested ${testedSha}, now ${currentSha}`,
		)
	}
	requireCleanWorkingTree()
}

function readJsonAt(ref: string, path: string): unknown {
	if (!capture(["git", "ls-tree", "--name-only", ref, path])) return undefined
	return JSON.parse(capture(["git", "show", `${ref}:${path}`]))
}

// Readers learn what changed from the changelog, so every pull request adds
// exactly one entry describing itself, and leaves published entries alone.
export function requireSingleChangelogEntry() {
	capture(["git", "fetch", "--quiet", "origin", "main"])
	let headSha = capture(["git", "rev-parse", "HEAD"])
	let mainSha = capture(["git", "rev-parse", "origin/main"])
	if (headSha === mainSha) {
		process.stdout.write("\n── Changelog entry: skipped on main ──\n")
		return
	}

	let mergeBase = capture(["git", "merge-base", "origin/main", "HEAD"])
	let base = readJsonAt(mergeBase, CHANGELOG_PATH)
	if (base === undefined) {
		process.stdout.write("\n── Changelog entry: skipped, changelog is new ──\n")
		return
	}
	let head = readChangelogFile()
	requireEveryEntryReadable(head)
	let added = prependedEntryCount(base, head)
	if (added === null) {
		throw new Error(
			`${CHANGELOG_PATH} edited, reordered or removed published entries. Readers track entries by position, so only add new ones at the top.`,
		)
	}
	if (added !== 1) {
		throw new Error(
			`Expected exactly 1 new entry in ${CHANGELOG_PATH}, found ${added}. Describe this pull request in a single entry at the top.`,
		)
	}
	process.stdout.write("\n── Changelog entry: 1 added ──\n")
}

// Without this, a malformed new entry is reported as if the author had edited
// somebody else's published entry.
function requireEveryEntryReadable(head: unknown) {
	if (!Array.isArray(head)) {
		throw new Error(`${CHANGELOG_PATH} must be an array of entries.`)
	}
	let unreadable = head.flatMap((entry, index) =>
		isChangelogEntry(entry) ? [] : [index],
	)
	if (unreadable.length === 0) return
	throw new Error(
		`${CHANGELOG_PATH} has unreadable entries at position ${unreadable.join(", ")}. Every entry needs an ISO date (2026-09-16), a title, and at least one note.`,
	)
}

function readChangelogFile(): unknown {
	let contents = readFileSync(resolve(ROOT, CHANGELOG_PATH), "utf8")
	try {
		return JSON.parse(contents)
	} catch (error) {
		let message = error instanceof Error ? error.message : String(error)
		throw new Error(`${CHANGELOG_PATH} is not valid JSON: ${message}`)
	}
}

function previewUrl(): string {
	let provided = process.env.CI_BASE_URL?.trim()
	if (provided) return new URL(provided).toString()
	let routed = capture(["work", "urls"])
	for (let line of routed.split("\n")) {
		let [, command, url] = line.trim().split(/\s+/)
		if (command === "web" && /^https?:\/\//.test(url ?? "")) return url
	}
	throw new Error("work did not provide a web URL. Set CI_BASE_URL instead.")
}

function webIsReady(url: string): boolean {
	return (
		spawnSync(
			"curl",
			["--fail", "--silent", "--insecure", "--max-time", "10", url],
			{
				cwd: ROOT,
				stdio: "ignore",
			},
		).status === 0
	)
}

async function requireReadyPreview(url: string) {
	let deadline = Date.now() + 45_000
	while (Date.now() < deadline) {
		if (webIsReady(url)) return
		await delay(1_000)
	}
	throw new Error(`${url} did not become ready. Inspect \`work logs web\`.`)
}

// Only failures after the suite starts describe the commit; setup and policy
// errors would otherwise leave a permanent red mark on healthy code.
function reportFailure(testedSha: string) {
	process.stderr.write(`\nReporting failed CI for ${testedSha}\n`)
	let result = spawnSync(
		"gh",
		[
			"signoff",
			"fail",
			"--commit",
			testedSha,
			"--description",
			"Local CI failed",
		],
		{ cwd: ROOT, stdio: "inherit", timeout: 30_000 },
	)
	if (result.status !== 0) {
		process.stderr.write(
			`Could not report failure. Push ${testedSha} before running CI.\n`,
		)
	}
}

async function main() {
	let testedSha: string | undefined
	let suiteStarted = false
	try {
		requireSignoffExtension()
		requireCleanWorkingTree()
		testedSha = capture(["git", "rev-parse", "HEAD"])
		ciDeadline = Date.now() + CI_TIMEOUT_MS

		requireSingleChangelogEntry()
		suiteStarted = true
		run("Install dependencies", ["bun", "install", "--frozen-lockfile"])
		requireTestedState(testedSha)

		let ciEnvironment = { ...process.env, CI: "1" }
		run(
			"Static checks, types and unit tests",
			["bun", "run", "check"],
			ciEnvironment,
		)
		// `bun run build` reruns astro check, which `bun run check` just did.
		run("Production build", ["bunx", "astro", "build"], ciEnvironment)
		run("Install browser", [
			"bunx",
			"playwright",
			"install",
			"--only-shell",
			"chromium",
		])

		if (!process.env.CI_BASE_URL?.trim()) {
			run("Restart local sync", ["work", "restart", "sync"])
			run("Restart local web", ["work", "restart", "web"])
		}
		let url = previewUrl()
		await requireReadyPreview(url)
		run("End-to-end tests", ["bun", "run", "test:e2e", "--", "--forbid-only"], {
			...ciEnvironment,
			PLAYWRIGHT_BASE_URL: url,
		})

		requireTestedState(testedSha)
		run("Sign off tested commit", ["gh", "signoff", "--commit", testedSha])
		process.stdout.write(`\n✓ Local CI passed and signed off ${testedSha}\n`)
	} catch (error) {
		if (testedSha && suiteStarted) reportFailure(testedSha)
		let message = error instanceof Error ? error.message : String(error)
		process.stderr.write(`\n✗ ${message}\n`)
		process.exitCode = 1
	}
}

if (import.meta.main) await main()
