import { defineConfig, devices } from "@playwright/test"

let appUrl = process.env.PLAYWRIGHT_BASE_URL ?? "https://alkalye.localhost"

export default defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	expect: {
		timeout: 10_000,
	},
	fullyParallel: true,
	workers: process.env.CI ? 2 : undefined,
	retries: process.env.CI ? 2 : 0,
	reporter: "list",
	use: {
		baseURL: appUrl,
		ignoreHTTPSErrors: true,
		trace: "on-first-retry",
		permissions: ["clipboard-read", "clipboard-write"],
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
})
