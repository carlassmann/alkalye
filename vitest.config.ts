import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(import.meta.dirname, "src"),
			"astro:env/client": resolve(
				import.meta.dirname,
				"src/test-stubs/astro-env-client.ts",
			),
			"astro:env/server": resolve(
				import.meta.dirname,
				"src/test-stubs/astro-env-server.ts",
			),
			// vite-plugin-pwa isn't wired into vitest. Point its virtual
			// module at a stub so dynamic imports in src/app/lib/pwa.tsx
			// resolve cleanly in tests.
			"virtual:pwa-register": resolve(
				import.meta.dirname,
				"src/test-stubs/pwa-register.ts",
			),
		},
	},
	test: {
		exclude: ["node_modules", ".reference", "e2e"],
		include: ["src/**/*.test.ts"],
		environment: "jsdom",
		setupFiles: ["./src/test-setup.ts"],
		sequence: {
			shuffle: false,
		},
	},
})
