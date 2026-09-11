import { defineConfig, envField } from "astro/config"
import react from "@astrojs/react"
import vercel from "@astrojs/vercel"
import pwa from "@vite-pwa/astro"
import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"

export default defineConfig({
	site: "https://www.alkalye.com",
	adapter: vercel(),
	security: { checkOrigin: false },
	devToolbar: { enabled: false },
	i18n: {
		locales: ["en", "de"],
		defaultLocale: "en",
		routing: { prefixDefaultLocale: false },
	},
	vite: {
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
		plugins: [
			tanstackRouter({
				target: "react",
				routesDirectory: "./src/app/routes",
				generatedRouteTree: "./src/app/routeTree.gen.ts",
			}),
			tailwindcss(),
		] as any,
		resolve: {
			alias: {
				"@": new URL("./src", import.meta.url).pathname,
				"#app": new URL("./src/app", import.meta.url).pathname,
				"#www": new URL("./src/www", import.meta.url).pathname,
			},
		},
	},
	integrations: [
		react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
		pwa({
			registerType: "prompt",
			manifest: {
				id: "/app/",
				name: "Alkalye",
				short_name: "Alkalye",
				description:
					"A beautiful markdown editor, on the web. E2E encrypted, realtime collaboration and sync, great on desktop and mobile.",
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
				globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,woff,ttf}"],
				navigateFallback: "app",
				navigateFallbackAllowlist: [/^\/app(?:\/.*)?(?:\?.*)?$/],
				maximumFileSizeToCacheInBytes: 5.5 * 1024 * 1024,
			},
		}),
	],
	env: {
		schema: {
			PUBLIC_JAZZ_SYNC_SERVER: envField.string({
				context: "client",
				access: "public",
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
			ALKALYE_MCP_ALLOWED_CLIENT_HOSTS: envField.string({
				context: "server",
				access: "secret",
				optional: true,
			}),
			ALKALYE_OPENAI_APPS_CHALLENGE: envField.string({
				context: "server",
				access: "secret",
				optional: true,
			}),
		},
	},
})
