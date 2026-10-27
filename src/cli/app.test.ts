import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import process from "node:process"

type CliResult = {
	exitCode: number
	stdout: string
	stderr: string
}

let tempDirs: string[] = []

afterEach(async () => {
	for (let dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true })
	}
})

describe("help", () => {
	test("prints minimal root help", async () => {
		let result = await runCli(["--help"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toMatch(
			/Collaborate with alkalye\.com from the CLI\./,
		)
		expect(result.stdout).toMatch(/Built for scripts and AI agents\./)
		expect(result.stdout).not.toMatch(/doc doc share/)
	})

	test("prints leaf command help for doc create", async () => {
		let result = await runCli(["doc", "create", "--help"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toMatch(/Create a document/)
		expect(result.stdout).toMatch(/--content/)
		expect(result.stdout).toMatch(/--stdin/)
		expect(result.stdout).toMatch(/--scope/)
		expect(result.stdout).not.toMatch(/\[0;1m/) // no ANSI from Effect
	})

	test("prints leaf command help for doc rename", async () => {
		let result = await runCli(["doc", "rename", "--help"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toMatch(/--title/)
	})

	test("prints freshness options for doc content", async () => {
		let result = await runCli(["doc", "content", "--help"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toMatch(/--offline/)
		expect(result.stdout).toMatch(/--local/)
		expect(result.stdout).toMatch(/--stale-ok/)
	})

	test("prints leaf command help for doc comment add", async () => {
		let result = await runCli(["doc", "comment", "add", "--help"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toMatch(/--body/)
		expect(result.stdout).toMatch(/--quote/)
		expect(result.stdout).toMatch(/--from/)
		expect(result.stdout).toMatch(/--to/)
	})

	test("prints leaf command help for space share create", async () => {
		let result = await runCli(["space", "share", "create", "--help"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toMatch(/Create an invite link/)
		expect(result.stdout).toMatch(/--role/)
	})

	test("prints leaf command help for auth signup", async () => {
		let result = await runCli(["auth", "signup", "--help"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toMatch(/Create account/)
		expect(result.stdout).toMatch(/--name/)
		expect(result.stdout).toMatch(/--passphrase-stdin/)
	})

	test("prints leaf command help for doc export", async () => {
		let result = await runCli(["doc", "export", "--help"])

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toMatch(/--pdf/)
		expect(result.stdout).toMatch(/--file/)
		expect(result.stdout).toMatch(/--theme/)
		expect(result.stdout).toMatch(/--layout/)
		expect(result.stdout).toMatch(/--aspect/)
	})

	test("root help includes --quiet option", async () => {
		let result = await runCli(["--help"])

		expect(result.stdout).toMatch(/--quiet/)
	})
})

describe("errors", () => {
	test("reports logged out whoami cleanly", async () => {
		let result = await runCli(["auth", "whoami"], {
			ALKALYE_SYNC_PEER: "ws://localhost",
		})

		expect(result.exitCode).toBe(3)
		expect(result.stderr.trim()).toBe("Not logged in")
		expect(result.stderr).not.toMatch(/UnknownException/)
		expect(result.stderr).not.toMatch(/Effect\.tryPromise/)
	})

	test("reports config discovery failure cleanly", async () => {
		let result = await runCli(["auth", "whoami"], {
			ALKALYE_SERVER: "http://127.0.0.1:9",
		})

		expect(result.exitCode).toBe(7)
		expect(result.stderr).toMatch(/\/\.well-known\/alkalye-cli\.json/)
		expect(result.stderr).not.toMatch(/UnknownException/)
	})

	test("doc export without a source returns exit code 2", async () => {
		let result = await runCli(["doc", "export", "--pdf", "out.pdf"], {
			ALKALYE_SYNC_PEER: "ws://localhost",
		})

		expect(result.exitCode).toBe(2)
		expect(result.stderr).toMatch(/doc ID or --file/)
	})

	test("missing content source returns exit code 2", async () => {
		let result = await runCli(["doc", "create"], {
			ALKALYE_SYNC_PEER: "ws://localhost",
		})

		expect(result.exitCode).toBe(2)
		expect(result.stderr).toMatch(/--content/)
	})
})

describe("quiet", () => {
	test("--quiet suppresses stdout on auth error", async () => {
		let result = await runCli(["auth", "whoami", "--quiet"], {
			ALKALYE_SYNC_PEER: "ws://localhost",
		})

		expect(result.exitCode).toBe(3)
		expect(result.stdout.trim()).toBe("")
	})

	test("--quiet still outputs errors to stderr", async () => {
		let result = await runCli(["auth", "whoami", "--quiet"], {
			ALKALYE_SYNC_PEER: "ws://localhost",
		})

		expect(result.stderr).toMatch(/Not logged in/)
	})
})

describe("command identity", () => {
	test("sync flush reports its own command name in json errors", async () => {
		let result = await runCli(["sync", "flush", "--json"], {
			ALKALYE_SYNC_PEER: "ws://localhost",
		})

		expect(result.exitCode).toBe(3)
		expect(result.stderr).toMatch(/"command": "sync\.flush"/)
	})
})

async function runCli(
	args: string[],
	env: Record<string, string> = {},
): Promise<CliResult> {
	let home = await mkdtemp(join(tmpdir(), "alkalye-cli-test-"))
	tempDirs.push(home)

	return await new Promise((resolve, reject) => {
		let proc = spawn("bun", ["cli.ts", ...args], {
			cwd: process.cwd(),
			env: {
				...process.env,
				ALKALYE_CLI_HOME: home,
				...env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		})

		let stdout = ""
		let stderr = ""

		proc.stdout.on("data", chunk => {
			stdout += chunk.toString()
		})

		proc.stderr.on("data", chunk => {
			stderr += chunk.toString()
		})

		proc.on("error", reject)
		proc.on("close", code => {
			resolve({
				exitCode: code ?? 1,
				stdout,
				stderr,
			})
		})
	})
}
