export default {
	project: "alkalye",
	worktrees: {
		dir: "../alkalye.worktrees",
		setup: "bun scripts/work-setup.ts",
	},
	commands: {
		sync: {
			run: 'bunx jazz-run sync --port "$PORT" --host "$HOST"',
			autoStart: true,
			route: true,
		},
		web: {
			run: 'PUBLIC_JAZZ_SYNC_SERVER="$WORK_SYNC_WS_URL" astro dev --port "$PORT" --host "$HOST"',
			autoStart: true,
			route: true,
		},
	},
}
