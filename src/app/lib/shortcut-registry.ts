import { isMac } from "./platform"

export {
	getCodeMirrorShortcut,
	getAriaShortcut,
	getShortcutLabel,
	getShortcutDefinitions,
	isShortcutTargetBlocked,
	isShortcutEvent,
	replaceShortcutTokens,
}
export type { ShortcutId, ShortcutPlatform }

type ShortcutModifier = "Alt" | "Ctrl" | "Mod" | "Shift"
type ShortcutPlatform = "mac" | "other"

interface ShortcutChord {
	key: string
	modifiers?: ShortcutModifier[]
}

interface ShortcutDefinition {
	id: string
	default: ShortcutChord
	mac?: ShortcutChord
}

let shortcutDefinitions = [
	{ id: "bold", default: { key: "b", modifiers: ["Mod"] } },
	{ id: "italic", default: { key: "i", modifiers: ["Mod"] } },
	{ id: "inlineCode", default: { key: "e", modifiers: ["Mod"] } },
	{ id: "link", default: { key: "k", modifiers: ["Mod"] } },
	{ id: "image", default: { key: "k", modifiers: ["Alt", "Mod"] } },
	{
		id: "strikethrough",
		default: { key: "x", modifiers: ["Mod", "Shift"] },
	},
	{ id: "heading1", default: { key: "1", modifiers: ["Alt", "Mod"] } },
	{ id: "heading2", default: { key: "2", modifiers: ["Alt", "Mod"] } },
	{ id: "heading3", default: { key: "3", modifiers: ["Alt", "Mod"] } },
	{ id: "heading4", default: { key: "4", modifiers: ["Alt", "Mod"] } },
	{ id: "heading5", default: { key: "5", modifiers: ["Alt", "Mod"] } },
	{ id: "heading6", default: { key: "6", modifiers: ["Alt", "Mod"] } },
	{ id: "body", default: { key: "0", modifiers: ["Alt", "Mod"] } },
	{ id: "bulletList", default: { key: "l", modifiers: ["Alt", "Mod"] } },
	{ id: "orderedList", default: { key: "o", modifiers: ["Alt", "Mod"] } },
	{
		id: "taskList",
		default: { key: "l", modifiers: ["Alt", "Mod", "Shift"] },
	},
	{ id: "toggleTask", default: { key: "x", modifiers: ["Alt", "Mod"] } },
	{
		id: "sortTasks",
		default: { key: "x", modifiers: ["Alt", "Mod", "Shift"] },
	},
	{ id: "blockquote", default: { key: "q", modifiers: ["Alt", "Mod"] } },
	{ id: "codeBlock", default: { key: "c", modifiers: ["Alt", "Mod"] } },
	{ id: "comment", default: { key: "m", modifiers: ["Alt", "Mod"] } },
	{
		id: "moveLineUp",
		default: { key: "ArrowUp", modifiers: ["Alt"] },
	},
	{
		id: "moveLineDown",
		default: { key: "ArrowDown", modifiers: ["Alt"] },
	},
	{
		id: "duplicateLineUp",
		default: { key: "ArrowUp", modifiers: ["Alt", "Shift"] },
	},
	{
		id: "duplicateLineDown",
		default: { key: "ArrowDown", modifiers: ["Alt", "Shift"] },
	},
	{
		id: "addCursorAbove",
		default: { key: "ArrowUp", modifiers: ["Alt", "Mod"] },
	},
	{
		id: "addCursorBelow",
		default: { key: "ArrowDown", modifiers: ["Alt", "Mod"] },
	},
	{ id: "deleteLine", default: { key: "k", modifiers: ["Mod", "Shift"] } },
	{ id: "insertLineBelow", default: { key: "Enter", modifiers: ["Mod"] } },
	{
		id: "insertLineAbove",
		default: { key: "Enter", modifiers: ["Mod", "Shift"] },
	},
	{
		id: "selectLine",
		default: { key: "l", modifiers: ["Alt"] },
		mac: { key: "l", modifiers: ["Ctrl"] },
	},
	{ id: "indentSelection", default: { key: "]", modifiers: ["Mod"] } },
	{ id: "outdentSelection", default: { key: "[", modifiers: ["Mod"] } },
	{ id: "indent", default: { key: "Tab" } },
	{ id: "outdent", default: { key: "Tab", modifiers: ["Shift"] } },
	{ id: "contextAction", default: { key: "Space", modifiers: ["Ctrl"] } },
	{ id: "find", default: { key: "f", modifiers: ["Mod"] } },
	{ id: "replace", default: { key: "h", modifiers: ["Mod"] } },
	{ id: "findNext", default: { key: "g", modifiers: ["Mod"] } },
	{ id: "findPrevious", default: { key: "g", modifiers: ["Mod", "Shift"] } },
	{
		id: "goToFindMatch",
		default: { key: "Enter", modifiers: ["Alt", "Mod"] },
	},
	{
		id: "commandPalette",
		default: { key: "p", modifiers: ["Mod", "Shift"] },
	},
	{ id: "selectNextOccurrence", default: { key: "d", modifiers: ["Mod"] } },
	{
		id: "selectAllOccurrences",
		default: { key: "l", modifiers: ["Mod", "Shift"] },
	},
	{
		id: "expandSelection",
		default: { key: "ArrowRight", modifiers: ["Alt", "Shift"] },
	},
	{
		id: "shrinkSelection",
		default: { key: "ArrowLeft", modifiers: ["Alt", "Shift"] },
	},
	{ id: "hardBreak", default: { key: "Enter", modifiers: ["Shift"] } },
	{ id: "rawPaste", default: { key: "v", modifiers: ["Mod", "Shift"] } },
	{ id: "preview", default: { key: "r", modifiers: ["Alt", "Mod"] } },
	{
		id: "leftSidebar",
		default: { key: "e", modifiers: ["Mod", "Shift"] },
	},
	{ id: "rightSidebar", default: { key: ".", modifiers: ["Mod"] } },
	{
		id: "focusMode",
		default: { key: "f", modifiers: ["Mod", "Shift"] },
	},
	{ id: "print", default: { key: "p", modifiers: ["Mod"] } },
	{ id: "save", default: { key: "s", modifiers: ["Mod"] } },
	{ id: "saveAs", default: { key: "s", modifiers: ["Mod", "Shift"] } },
	{ id: "undo", default: { key: "z", modifiers: ["Mod"] } },
	{
		id: "redo",
		default: { key: "y", modifiers: ["Mod"] },
		mac: { key: "z", modifiers: ["Mod", "Shift"] },
	},
	{ id: "cut", default: { key: "x", modifiers: ["Mod"] } },
	{ id: "copy", default: { key: "c", modifiers: ["Mod"] } },
	{ id: "paste", default: { key: "v", modifiers: ["Mod"] } },
] as const satisfies readonly ShortcutDefinition[]

type ShortcutId = (typeof shortcutDefinitions)[number]["id"]

function getCodeMirrorShortcut(id: ShortcutId): { key: string; mac?: string } {
	let definition = findShortcut(id)
	return {
		key: toCodeMirrorKey(definition.default),
		mac: definition.mac ? toCodeMirrorKey(definition.mac) : undefined,
	}
}

function getShortcutLabel(
	id: ShortcutId,
	platform: ShortcutPlatform = isMac ? "mac" : "other",
): string {
	let chord = getChord(findShortcut(id), platform)
	let modifierOrder: ShortcutModifier[] =
		platform === "mac"
			? ["Alt", "Ctrl", "Mod", "Shift"]
			: ["Mod", "Ctrl", "Alt", "Shift"]
	let modifiers = [...(chord.modifiers ?? [])].sort(
		(a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b),
	)
	let labels = modifiers.map(modifier => formatModifier(modifier, platform))
	let key = formatKey(chord.key)
	return platform === "mac" ? labels.join("") + key : [...labels, key].join("+")
}

function getShortcutDefinitions() {
	return shortcutDefinitions
}

function getAriaShortcut(
	id: ShortcutId,
	platform: ShortcutPlatform = isMac ? "mac" : "other",
): string {
	let chord = getChord(findShortcut(id), platform)
	let modifiers = (chord.modifiers ?? []).map(modifier => {
		if (modifier === "Mod") return platform === "mac" ? "Meta" : "Control"
		if (modifier === "Ctrl") return "Control"
		return modifier
	})
	return [...modifiers, ariaKey(chord.key)].join("+")
}

function isShortcutEvent(
	event: KeyboardEvent,
	id: ShortcutId,
	platform: ShortcutPlatform = isMac ? "mac" : "other",
): boolean {
	if (event.isComposing || event.getModifierState("AltGraph")) return false

	let chord = getChord(findShortcut(id), platform)
	let modifiers = chord.modifiers ?? []
	let expectsMeta = platform === "mac" && modifiers.includes("Mod")
	let expectsControl =
		modifiers.includes("Ctrl") ||
		(platform === "other" && modifiers.includes("Mod"))

	return (
		event.key.toLowerCase() === chord.key.toLowerCase() &&
		event.metaKey === expectsMeta &&
		event.ctrlKey === expectsControl &&
		event.altKey === modifiers.includes("Alt") &&
		event.shiftKey === modifiers.includes("Shift")
	)
}

function isShortcutTargetBlocked(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false
	if (target.closest('[role="dialog"],[data-slot="dialog-content"]'))
		return true
	if (target.closest(".cm-editor")) return false
	return Boolean(
		target.closest(
			'input,textarea,select,[contenteditable="true"],[contenteditable="plaintext-only"]',
		),
	)
}

function replaceShortcutTokens(content: string): string {
	let result = content
	for (let definition of shortcutDefinitions) {
		result = result.replaceAll(
			`{{shortcut:${definition.id}:mac}}`,
			getShortcutLabel(definition.id, "mac"),
		)
		result = result.replaceAll(
			`{{shortcut:${definition.id}:other}}`,
			getShortcutLabel(definition.id, "other"),
		)
	}
	return result
}

function findShortcut(id: ShortcutId): ShortcutDefinition {
	let definition = shortcutDefinitions.find(shortcut => shortcut.id === id)
	if (!definition) throw new Error(`Unknown shortcut: ${id}`)
	return definition
}

function getChord(
	definition: ShortcutDefinition,
	platform: ShortcutPlatform,
): ShortcutChord {
	return platform === "mac" && definition.mac
		? definition.mac
		: definition.default
}

function toCodeMirrorKey(chord: ShortcutChord): string {
	let modifiers = chord.modifiers ?? []
	return [...modifiers, chord.key].join("-")
}

function formatModifier(
	modifier: ShortcutModifier,
	platform: ShortcutPlatform,
): string {
	if (platform === "other") return modifier === "Mod" ? "Ctrl" : modifier
	if (modifier === "Mod") return "⌘"
	if (modifier === "Alt") return "⌥"
	if (modifier === "Shift") return "⇧"
	return "⌃"
}

function formatKey(key: string): string {
	if (key === "ArrowUp") return "↑"
	if (key === "ArrowDown") return "↓"
	if (key === "ArrowLeft") return "←"
	if (key === "ArrowRight") return "→"
	if (key === "Space") return "Space"
	return key.length === 1 ? key.toUpperCase() : key
}

function ariaKey(key: string): string {
	if (key === "ArrowUp") return "ArrowUp"
	if (key === "ArrowDown") return "ArrowDown"
	if (key === "ArrowLeft") return "ArrowLeft"
	if (key === "ArrowRight") return "ArrowRight"
	if (key === "Space") return "Space"
	return key.length === 1 ? key.toUpperCase() : key
}
