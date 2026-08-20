import { isMac } from "./platform"

export {
	getCodeMirrorShortcut,
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
		default: { key: "ArrowUp", modifiers: ["Alt", "Mod"] },
	},
	{
		id: "moveLineDown",
		default: { key: "ArrowDown", modifiers: ["Alt", "Mod"] },
	},
	{ id: "indent", default: { key: "Tab" } },
	{ id: "outdent", default: { key: "Tab", modifiers: ["Shift"] } },
	{ id: "contextAction", default: { key: "Space", modifiers: ["Ctrl"] } },
	{ id: "find", default: { key: "f", modifiers: ["Mod"] } },
	{ id: "findNext", default: { key: "F3" } },
	{ id: "findPrevious", default: { key: "F3", modifiers: ["Shift"] } },
	{ id: "goToFindMatch", default: { key: "Enter", modifiers: ["Mod"] } },
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
