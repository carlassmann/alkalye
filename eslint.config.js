import js from "@eslint/js"
import tseslint from "@typescript-eslint/eslint-plugin"
import tsparser from "@typescript-eslint/parser"
import reactHooks from "eslint-plugin-react-hooks"
import react from "eslint-plugin-react"
import globals from "globals"
import astro from "eslint-plugin-astro"
import { plugin as localPlugin } from "./eslint-local-rules/index.js"

let commonRules = {
	"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
	"@typescript-eslint/no-explicit-any": "error",
}

let reactRules = {
	...react.configs.recommended.rules,
	...reactHooks.configs.recommended.rules,
	"react/react-in-jsx-scope": "off",
}

let browserGlobals = {
	...globals.browser,
	...globals.serviceworker,
	React: "readonly",
}

export default [
	js.configs.recommended,
	{
		files: ["src/**/*.{ts,tsx,js,jsx}"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { ecmaVersion: "latest", sourceType: "module", jsx: true },
			globals: browserGlobals,
		},
		plugins: {
			"@typescript-eslint": tseslint,
			"react-hooks": reactHooks,
			react,
			local: localPlugin,
		},
		rules: {
			...tseslint.configs.recommended.rules,
			...reactRules,
			...commonRules,
			"local/exported-top-down": "warn",
		},
		settings: { react: { version: "detect" } },
	},
	{
		// Features expose a public surface via their barrel (index.ts).
		// App-level code (widgets, screens, parts, hooks, routes,
		// top-level components) must go through it.
		//
		// Exceptions — these layers legitimately reach past barrels:
		// - src/app/features/<self>/**: a feature reaches its own internals.
		// - src/app/features/*/lib/**: internal cross-feature plumbing.
		//   Lib code often touches schemas + leaf operations, where
		//   barrels would create load cycles or pull in browser-only code.
		// - src/schema/**: composes per-feature schemas; barrels cycle.
		// - src/cli/**: Node runtime; needs surgical imports.
		files: ["src/**/*.{ts,tsx}"],
		ignores: ["src/app/features/*/**", "src/schema/**", "src/cli/**"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: [
								"@/app/features/*/lib/*",
								"@/app/features/*/widgets/*",
								"@/app/features/*/screens/*",
								"@/app/features/*/parts/*",
								"@/app/features/*/hooks/*",
							],
							message:
								"Import from the feature barrel (@/app/features/<feature>). Deep paths bypass the public interface.",
						},
					],
				},
			],
		},
	},
	{
		// Cross-feature discipline for app-level layers inside a feature.
		// widgets, screens, parts, hooks may only reach other features
		// through their barrel (index.ts).
		files: [
			"src/app/features/*/widgets/**/*.{ts,tsx}",
			"src/app/features/*/screens/**/*.{ts,tsx}",
			"src/app/features/*/parts/**/*.{ts,tsx}",
			"src/app/features/*/hooks/**/*.{ts,tsx}",
		],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: [
								"@/app/features/*/lib/*",
								"@/app/features/*/widgets/*",
								"@/app/features/*/screens/*",
								"@/app/features/*/parts/*",
								"@/app/features/*/hooks/*",
							],
							message:
								"Import from the feature barrel (@/app/features/<feature>). Deep paths bypass the public interface.",
						},
					],
				},
			],
		},
	},
	{
		// Lib-to-lib cross-feature: may reach into other features' lib/
		// (for schemas, leaf ops) but NOT into widgets/screens/parts/hooks.
		files: ["src/app/features/*/lib/**/*.{ts,tsx}"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: [
								"@/app/features/*/widgets/*",
								"@/app/features/*/screens/*",
								"@/app/features/*/parts/*",
								"@/app/features/*/hooks/*",
							],
							message:
								"Lib code may cross-feature into lib/, but not into widgets/screens/parts/hooks. Use the barrel or move the dependency to lib/.",
						},
					],
				},
			],
		},
	},
	...astro.configs.recommended,
	{
		files: ["src/**/*.astro"],
		languageOptions: {
			parser: astro.parser,
			parserOptions: { parser: tsparser, extraFileExtensions: [".astro"] },
			globals: { ...browserGlobals, Astro: "readonly" },
		},
		plugins: { "@typescript-eslint": tseslint },
		rules: { ...tseslint.configs.recommended.rules, ...commonRules },
	},
	{
		ignores: [
			"dist/",
			"build/",
			"node_modules/",
			"bench/datasets/",
			".reference/",
			"*.config.{js,mjs,ts}",
			"src/routeTree.gen.ts",
			"src/app/routeTree.gen.ts",
			".astro/",
			"eslint-local-rules/",
			".vercel/",
			".claude/",
		],
	},
]
