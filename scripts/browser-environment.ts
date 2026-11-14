import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export { configureBrowserEnvironment }

function configureBrowserEnvironment() {
	if (process.platform !== "linux") return

	// Playwright puts Chromium shared memory in TMPDIR. A tmpfs user quota can
	// reject allocations even when df reports gigabytes of free space.
	let directory =
		process.env.TMPDIR ||
		join(
			process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
			"alkalye",
			"playwright-tmp",
		)
	mkdirSync(directory, { recursive: true })
	process.env.TMPDIR = directory
}
