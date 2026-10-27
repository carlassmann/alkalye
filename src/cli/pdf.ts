import { spawn } from "node:child_process"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"
import { ConfigError, FilesystemError } from "@/cli/errors"

export { printHtmlToPdf, findChrome, chromeCandidates }

let chromeEnvVar = "ALKALYE_CHROME"

async function printHtmlToPdf(params: {
	html: string
	outputPath: string
	timeoutMs: number
}) {
	let chrome = await findChrome()
	let workDir = await mkdtemp(join(tmpdir(), "alkalye-pdf-"))
	try {
		let htmlPath = join(workDir, "document.html")
		await writeFile(htmlPath, params.html, "utf8")
		await runChrome(
			chrome,
			[
				"--headless",
				"--disable-gpu",
				"--no-first-run",
				"--no-default-browser-check",
				"--no-pdf-header-footer",
				`--user-data-dir=${join(workDir, "profile")}`,
				`--print-to-pdf=${resolve(params.outputPath)}`,
				pathToFileURL(htmlPath).href,
			],
			params.timeoutMs,
		)
		await access(resolve(params.outputPath)).catch(() => {
			throw new FilesystemError({
				message: `Chrome did not write a PDF to ${params.outputPath}`,
			})
		})
	} finally {
		await rm(workDir, { recursive: true, force: true })
	}
}

async function findChrome(
	candidates: string[] = chromeCandidates(),
): Promise<string> {
	for (let candidate of candidates) {
		let found = await access(candidate).then(
			() => true,
			() => false,
		)
		if (found) return candidate
	}
	throw new ConfigError({
		message: `PDF export needs Google Chrome or Chromium. Install it or set ${chromeEnvVar} to the browser executable.`,
	})
}

function chromeCandidates(
	env: Record<string, string | undefined> = process.env,
): string[] {
	let fromEnv = env[chromeEnvVar]
	if (fromEnv) return [fromEnv]
	let pathDirs = (env.PATH ?? "").split(":").filter(Boolean)
	return [
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		...pathDirs.flatMap(dir =>
			[
				"google-chrome",
				"google-chrome-stable",
				"chromium",
				"chromium-browser",
			].map(name => join(dir, name)),
		),
	]
}

function runChrome(executable: string, args: string[], timeoutMs: number) {
	return new Promise<void>((resolvePromise, reject) => {
		let child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] })
		let stderr = ""
		child.stderr.on("data", chunk => {
			stderr += String(chunk)
		})
		let timeout = setTimeout(() => {
			child.kill("SIGKILL")
			reject(
				new FilesystemError({
					message: `Chrome PDF export timed out after ${timeoutMs}ms`,
				}),
			)
		}, timeoutMs)
		child.on("error", error => {
			clearTimeout(timeout)
			reject(new FilesystemError({ message: error.message }))
		})
		child.on("exit", code => {
			clearTimeout(timeout)
			if (code === 0) resolvePromise()
			else
				reject(
					new FilesystemError({
						message: `Chrome exited with code ${code}: ${stderr.trim().split("\n").slice(-3).join("\n")}`,
					}),
				)
		})
	})
}
