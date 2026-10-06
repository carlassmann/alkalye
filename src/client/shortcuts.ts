interface Shortcut {
	id: string
	action: string
	key: string
	mod?: boolean
	alt?: boolean
	shift?: boolean
}
let shortcuts: Shortcut[] = [
	{ id: "undo", action: "undo", key: "z", mod: true },
	{ id: "redo", action: "redo", key: "z", mod: true, shift: true },
	{ id: "redoAlternate", action: "redo", key: "y", mod: true },
	{ id: "bold", action: "bold", key: "b", mod: true },
	{ id: "italic", action: "italic", key: "i", mod: true },
	{ id: "inlineCode", action: "code", key: "e", mod: true },
	{ id: "link", action: "link", key: "k", mod: true },
	{ id: "image", action: "asset", key: "k", mod: true, alt: true },
	{ id: "strikethrough", action: "strike", key: "x", mod: true, shift: true },
	...[1, 2, 3, 4, 5, 6].map(level => ({
		id: `heading${level}`,
		action: `h${level}`,
		key: String(level),
		mod: true,
		alt: true,
	})),
	{ id: "body", action: "body", key: "0", mod: true, alt: true },
	{ id: "bulletList", action: "bullet", key: "l", mod: true, alt: true },
	{ id: "orderedList", action: "ordered", key: "o", mod: true, alt: true },
	{
		id: "taskList",
		action: "task",
		key: "l",
		mod: true,
		alt: true,
		shift: true,
	},
	{ id: "toggleTask", action: "complete", key: "x", mod: true, alt: true },
	{
		id: "sortTasks",
		action: "sort-tasks",
		key: "x",
		mod: true,
		alt: true,
		shift: true,
	},
	{ id: "blockquote", action: "quote", key: "q", mod: true, alt: true },
	{ id: "codeBlock", action: "code-block", key: "c", mod: true, alt: true },
	{ id: "comment", action: "comment", key: "m", mod: true, alt: true },
	{ id: "find", action: "find", key: "f", mod: true },
	{ id: "replace", action: "find", key: "h", mod: true },
	{ id: "findNext", action: "find-next", key: "g", mod: true },
	{
		id: "findPrevious",
		action: "find-previous",
		key: "g",
		mod: true,
		shift: true,
	},
	{ id: "commandPalette", action: "palette", key: "p", mod: true, shift: true },
	{
		id: "documentOutline",
		action: "outline",
		key: "o",
		mod: true,
		shift: true,
	},
	{ id: "preview", action: "toggle-preview", key: "r", mod: true, alt: true },
	{ id: "leftSidebar", action: "library", key: "e", mod: true, shift: true },
	{ id: "rightSidebar", action: "toggle-tools", key: ".", mod: true },
	{ id: "focusMode", action: "focus", key: "f", mod: true, shift: true },
	{ id: "print", action: "print", key: "p", mod: true },
	{ id: "save", action: "save", key: "s", mod: true },
	{ id: "saveAs", action: "save-as", key: "s", mod: true, shift: true },
]

export function shortcutAction(
	event: Pick<
		KeyboardEvent,
		| "defaultPrevented"
		| "isComposing"
		| "code"
		| "key"
		| "metaKey"
		| "ctrlKey"
		| "altKey"
		| "shiftKey"
	>,
	platform = typeof navigator === "undefined"
		? "other"
		: /Mac/i.test(navigator.platform)
			? "mac"
			: "other",
) {
	if (event.defaultPrevented || event.isComposing) return
	let key =
		platform === "mac" &&
		event.altKey &&
		/^(Key[A-Z]|Digit[0-9])$/.test(event.code)
			? event.code.replace(/^(Key|Digit)/, "").toLowerCase()
			: event.key.toLowerCase()
	return shortcuts.find(
		shortcut =>
			shortcut.key === key &&
			Boolean(shortcut.mod) === (event.metaKey || event.ctrlKey) &&
			Boolean(shortcut.alt) === event.altKey &&
			Boolean(shortcut.shift) === event.shiftKey,
	)?.action
}

export function actionShortcutLabel(action: string, platform: string) {
	let clipboard = { cut: "X", "copy-text": "C", paste: "V" }
	if (action === "cut" || action === "copy-text" || action === "paste")
		return (platform === "mac" ? "⌘" : "Ctrl+") + clipboard[action]
	let shortcut = shortcuts.find(shortcut => shortcut.action === action)
	return shortcut ? shortcutLabel(shortcut.id, platform) : undefined
}

export function shortcutLabel(id: string, platform = "mac") {
	let shortcut = shortcuts.find(shortcut => shortcut.id === id)
	if (!shortcut) return id
	let keys = [
		shortcut.alt ? (platform === "mac" ? "⌥" : "Alt") : "",
		shortcut.mod ? (platform === "mac" ? "⌘" : "Ctrl") : "",
		shortcut.shift ? (platform === "mac" ? "⇧" : "Shift") : "",
		shortcut.key.toUpperCase(),
	].filter(Boolean)
	return keys.join(platform === "mac" ? "" : "+")
}

export function replaceShortcutTokens(source: string) {
	return source.replace(
		/\{\{shortcut:([\w]+):(mac|other)\}\}/g,
		(_token, id: string, platform: string) => shortcutLabel(id, platform),
	)
}

export function keyboardShortcuts(platform: string) {
	return shortcuts.map(shortcut => ({
		keys: shortcutLabel(shortcut.id, platform),
		label: shortcut.id
			.replace(/([a-z])([A-Z])/g, "$1 $2")
			.replace(/^./, value => value.toUpperCase()),
	}))
}
