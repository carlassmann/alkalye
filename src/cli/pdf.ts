import { spawn } from "node:child_process"
import {
	access,
	copyFile,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises"
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
		let pdfPath = join(workDir, "document.pdf")
		await writeFile(htmlPath, params.html, "utf8")
		await runChrome(
			chrome,
			[
				"--headless",
				"--disable-gpu",
				"--no-first-run",
				"--no-default-browser-check",
				"--no-pdf-header-footer",
				// Lets the page finish async work (font loading, slide fitting)
				// before Chrome prints; without it slides print unfitted.
				"--virtual-time-budget=10000",
				`--user-data-dir=${join(workDir, "profile")}`,
				`--print-to-pdf=${pdfPath}`,
				pathToFileURL(htmlPath).href,
			],
			params.timeoutMs,
		)
		// Chrome exits 0 even when it cannot write, so the PDF is checked
		// before it replaces anything at the destination.
		await assertPdf(pdfPath)
		await copyFile(pdfPath, resolve(params.outputPath)).catch(error => {
			throw new FilesystemError({
				message: `Cannot write ${params.outputPath}: ${error instanceof Error ? error.message : String(error)}`,
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

async function assertPdf(path: string) {
	let bytes = await readFile(path).catch(() => null)
	if (bytes?.subarray(0, 5).toString("latin1") === "%PDF-") return
	throw new FilesystemError({ message: "Chrome did not produce a PDF" })
}
