export default {
	project: "alkalye",
	worktrees: {
		dir: "../alkalye.worktrees",
		setup: "bun scripts/work-setup.ts",
	},
	commands: {
		web: {
			run: 'astro dev --port "$PORT" --host "$HOST"',
			autoStart: true,
			route: true,
		},
	},
}
