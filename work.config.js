export default {
	project: "alkalye",
	worktrees: { dir: "../alkalye.worktrees", setup: "bun install" },
	commands: {
		web: { run: "bun src/server/index.ts", autoStart: true, route: true },
	},
}
