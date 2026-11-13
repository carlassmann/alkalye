import { defineConfig, envField } from "astro/config"
import react from "@astrojs/react"
import vercel from "@astrojs/vercel"
import node from "@astrojs/node"
import pwa from "@vite-pwa/astro"
import tailwindcss from "@tailwindcss/vite"
import { criticalAppPreload } from "./scripts/critical-app-preload"

export default defineConfig({
	site: "https://www.alkalye.com",
	adapter:
		process.env.ALKALYE_LOCAL_PREVIEW === "1"
			? node({ mode: "standalone" })
			: vercel(),
	security: { checkOrigin: false },
	devToolbar: { enabled: false },
	// Omny currently renders its provider privacy links relative to the host site.
	redirects: {
		"/legal/privacy": {
			destination: "https://my.syntwin.ai/legal/privacy",
			status: 302,
		},
		"/de/legal/privacy": {
			destination: "https://my.syntwin.ai/de/legal/privacy",
			status: 302,
		},
	},
	i18n: {
		locales: ["en", "de"],
		defaultLocale: "en",
		routing: { prefixDefaultLocale: false },
	},
	vite: {
		optimizeDeps: { exclude: ["jazz-tools", "jazz-wasm"] },
		ssr: { external: ["jazz-napi", "jazz-tools"] },
		server: { allowedHosts: getWorkAllowedHosts() },
		build: {
			rollupOptions: {
				output: {
					onlyExplicitManualChunks: true,
					manualChunks(id) {
						let match = id.match(/node_modules\/@tldraw\/([^/]+)/)
						if (match?.[1]) return `tldraw-${match[1]}`
						if (id.includes("/node_modules/tldraw/")) return "tldraw"
					},
				},
			},
		},
		plugins: [tailwindcss()] as any,
		resolve: {
			dedupe: [
				"prosemirror-model",
				"prosemirror-state",
				"prosemirror-transform",
				"prosemirror-view",
			],
			alias: {
				"@": new URL("./src", import.meta.url).pathname,
				"#app": new URL("./src/app", import.meta.url).pathname,
				"#www": new URL("./src/www", import.meta.url).pathname,
			},
		},
	},
	integrations: [
		criticalAppPreload(),
		react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
		pwa({
			registerType: "prompt",
			manifest: {
				id: "/app/",
				name: "Alkalye",
				short_name: "Alkalye",
				description:
					"A beautiful markdown editor, on the web. Realtime collaboration and sync, great on desktop and mobile.",
				start_url: "/app/",
				display: "standalone",
				background_color: "#ffffff",
				theme_color: "#000000",
				orientation: "portrait-primary",
				scope: "/app/",
				lang: "en",
				icons: [
					{
						src: "/icons/alkalye-icon.png",
						sizes: "512x512",
						type: "image/png",
					},
					{
						src: "/icons/alkalye-icon.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
				file_handlers: [
					{
						action: "/app/local",
						accept: {
							"text/markdown": [".md", ".markdown"],
							"text/plain": [".txt"],
						},
					},
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,woff,ttf,wasm}"],
				// The update prompt links to /changelog, so it must always come
				// from the network: a precached copy would describe the build
				// the reader is already running.
				// Passing globIgnores replaces workbox's default, which must be
				// kept or every node_modules file is swept into the precache.
				globIgnores: ["**/node_modules/**/*", "**/changelog/index.html"],
				navigateFallback: "app",
				navigateFallbackAllowlist: [/^\/app(?:\/.*)?(?:\?.*)?$/],
				maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
			},
		}),
	],
	env: {
		schema: {
			PUBLIC_SYNTWIN_ENABLED: envField.boolean({
				context: "client",
				access: "public",
				default: true,
			}),
			PUBLIC_SYNTWIN_ROOM_ID: envField.string({
				context: "client",
				access: "public",
				optional: true,
			}),
			PUBLIC_TLDRAW_LICENSE_KEY: envField.string({
				context: "client",
				access: "public",
				optional: true,
			}),
			ALKALYE_MCP_BASE_URL: envField.string({
				context: "server",
				access: "secret",
			}),
			ALKALYE_MCP_TOKEN_KEY: envField.string({
				context: "server",
				access: "secret",
			}),
			ALKALYE_OPENAI_APPS_CHALLENGE: envField.string({
				context: "server",
				access: "secret",
				optional: true,
			}),
		},
	},
})

// `work up --tailscale` serves dev over a tailnet host that Vite rejects by default
function getWorkAllowedHosts(): string[] {
	let workUrl = process.env.WORK_WEB_URL
	return workUrl ? [new URL(workUrl).hostname] : []
}
