let commands = [
	["bun", "test", "./tests"],
	["bun", "tests/e2e.ts", "--modules"],
]
let results = await Promise.all(
	commands.map(
		command =>
			Bun.spawn(command, { stdout: "inherit", stderr: "inherit" }).exited,
	),
)
if (results.some(code => code !== 0)) process.exitCode = 1
export {}
