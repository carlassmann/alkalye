export {}

for (let path of [
	"tests/browser-native-eventlog.ts",
	"tests/browser-document-api.ts",
	"tests/browser-document-app.ts",
	"tests/browser-native-tools.ts",
	"tests/browser-native-portability.ts",
	"tests/browser-native-invitations.ts",
	"tests/browser-document-sharing.ts",
	"tests/browser-library-filters.ts",
	"tests/browser-native-folders.ts",
	"tests/browser-native-commands.ts",
	"tests/browser-storage.ts",
	"tests/browser-motion.ts",
	"tests/browser-floating-actions.ts",
	"tests/browser-editor-context-menu.ts",
	"tests/browser-editor-prettification.ts",
	"tests/browser-ui-parity.ts",
	"tests/browser-ui-leftovers.ts",
	"tests/browser-sidebar-menus.ts",
	"tests/browser-dialog.ts",
	"tests/browser-toasts.ts",
	"tests/browser-screen-parity.ts",
	"tests/browser-presentation-state.ts",
	"tests/browser-workspace-deletion.ts",
	"tests/browser-mcp.ts",
	"tests/browser-teleprompter.ts",
	"tests/browser-theme-library.ts",
	"tests/browser-laser-displays.ts",
	"tests/browser-workspace-avatars.ts",
	"tests/browser-whiteboard.ts",
]) {
	let test = Bun.spawn(["bun", path], {
		stdout: "inherit",
		stderr: "inherit",
		env: process.env,
	})
	let result = await test.exited
	if (result) process.exit(result)
}
