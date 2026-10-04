import { object } from "./model"
import * as Schema from "effect/Schema"
import * as Struct from "effect/Struct"

export let EditorPreferencesSchema = Schema.Struct({
	lineWidth: Schema.Finite.check(
		Schema.isBetween({ minimum: 40, maximum: 120 }),
	),
	letterSpacing: Schema.Finite.check(
		Schema.isBetween({ minimum: -0.1, maximum: 0.1 }),
	),
	strikethroughDoneTasks: Schema.Boolean,
	fadeDoneTasks: Schema.Boolean,
	highlightCurrentLine: Schema.Boolean,
	smartPairs: Schema.Boolean,
	markerWrapping: Schema.Boolean,
	tabIndent: Schema.Boolean,
	smartPaste: Schema.Boolean,
	lineHeight: Schema.Finite.check(
		Schema.isBetween({ minimum: 1.2, maximum: 2.5 }),
	),
	spellcheck: Schema.Boolean,
	spellcheckLanguage: Schema.Literals(["", "de", "en"]),
	autocomplete: Schema.Boolean,
	autoSortTasks: Schema.Boolean,
	statsUnit: Schema.Literals(["words", "sentences", "tasks", "hidden"]),
	syntaxTheme: Schema.String.check(Schema.isMaxLength(100)),
	previewTheme: Schema.String.check(Schema.isMaxLength(200)),
	slideshowTheme: Schema.String.check(Schema.isMaxLength(200)),
})
export let AccountPreferencesSchema = Schema.Struct({
	name: Schema.NonEmptyString.check(Schema.isMaxLength(100)),
	appearance: Schema.Literals(["light", "dark", "system"]),
	language: Schema.Literals(["en", "de", "system"]),
	fontSize: Schema.Finite.check(Schema.isBetween({ minimum: 12, maximum: 36 })),
	editor: EditorPreferencesSchema,
})
export let PreferencePatchSchema = AccountPreferencesSchema.mapFields(
	Struct.map(Schema.optionalKey),
)
	.mapFields(fields => ({
		...fields,
		editor: Schema.optionalKey(
			EditorPreferencesSchema.mapFields(Struct.map(Schema.optionalKey)),
		),
	}))
	.check(
		Schema.makeFilter(
			patch =>
				Object.keys(patch).some(key => key !== "editor") ||
				Object.keys(patch.editor ?? {}).length > 0 ||
				"A preference change must include a field",
		),
	)
export type PreferencePatch = typeof PreferencePatchSchema.Type

export function preferenceChanges(patch: PreferencePatch) {
	let { editor, ...account } = patch
	return Object.fromEntries(
		[
			...Object.entries(account),
			...Object.entries(editor ?? {}).map(([key, value]) => [
				"editor." + key,
				value,
			]),
		].map(([key, value]) => ["preference:" + key, JSON.stringify(value)]),
	)
}

export function changedPreferences(
	before: AccountPreferences,
	after: AccountPreferences,
): PreferencePatch {
	let account = Object.fromEntries(
		Object.entries(after).filter(
			([key, value]) => key !== "editor" && value !== Reflect.get(before, key),
		),
	)
	let editor = Object.fromEntries(
		Object.entries(after.editor).filter(
			([key, value]) => value !== Reflect.get(before.editor, key),
		),
	)
	return Schema.decodeUnknownSync(PreferencePatchSchema)({
		...account,
		...(Object.keys(editor).length ? { editor } : {}),
	})
}

export type EditorPreferences = typeof EditorPreferencesSchema.Type
export function editorPreferences(value: unknown): EditorPreferences {
	let source = object(value ?? {})
	let height = Number(source.lineHeight)
	return {
		lineWidth: bounded(source.lineWidth, 65, 40, 120),
		letterSpacing: bounded(source.letterSpacing, 0, -0.1, 0.1),
		strikethroughDoneTasks: source.strikethroughDoneTasks === true,
		fadeDoneTasks: source.fadeDoneTasks === true,
		highlightCurrentLine: source.highlightCurrentLine !== false,
		smartPairs: source.smartPairs !== false,
		markerWrapping: source.markerWrapping !== false,
		tabIndent: source.tabIndent !== false,
		smartPaste: source.smartPaste !== false,
		lineHeight: Number.isFinite(height)
			? Math.max(1.2, Math.min(2.5, height))
			: 1.8,
		spellcheck: source.spellcheck !== false,
		spellcheckLanguage:
			source.spellcheckLanguage === "de" || source.spellcheckLanguage === "en"
				? source.spellcheckLanguage
				: "",
		autocomplete: source.autocomplete !== false,
		autoSortTasks: source.autoSortTasks === true,
		statsUnit:
			source.statsUnit === "sentences" ||
			source.statsUnit === "tasks" ||
			source.statsUnit === "hidden"
				? source.statsUnit
				: "words",
		syntaxTheme:
			typeof source.syntaxTheme === "string" ? source.syntaxTheme : "alkalye",
		previewTheme:
			typeof source.previewTheme === "string" ? source.previewTheme : "",
		slideshowTheme:
			typeof source.slideshowTheme === "string" ? source.slideshowTheme : "",
	}
}

export type AccountPreferences = typeof AccountPreferencesSchema.Type
export function accountPreferences(value: unknown): AccountPreferences {
	let source = object(value ?? {})
	return {
		name:
			typeof source.name === "string" && source.name.trim()
				? source.name
				: "Anonymous writer",
		appearance:
			source.appearance === "light" || source.appearance === "dark"
				? source.appearance
				: "system",
		language:
			source.language === "en" || source.language === "de"
				? source.language
				: "system",
		fontSize:
			typeof source.fontSize === "number" && Number.isFinite(source.fontSize)
				? Math.max(12, Math.min(36, source.fontSize))
				: 18,
		editor: editorPreferences(source.editor),
	}
}
export function preferenceFields(preferences: AccountPreferences) {
	let { editor, ...account } = preferences
	return Object.fromEntries(
		[
			...Object.entries(account),
			...Object.entries(editor).map(([name, value]) => [
				`editor.${name}`,
				value,
			]),
		].map(([name, value]) => [`preference:${name}`, JSON.stringify(value)]),
	)
}
export function preferencesFromFields(
	fields: Record<string, string>,
	fallback: AccountPreferences,
) {
	let values = Object.fromEntries(
		Object.entries(fields)
			.filter(([name]) => name.startsWith("preference:"))
			.flatMap(([name, value]) => {
				try {
					return [[name.slice(11), JSON.parse(value)]]
				} catch {
					return []
				}
			}),
	)
	let editor = Object.fromEntries(
		Object.entries(values)
			.filter(([name]) => name.startsWith("editor."))
			.map(([name, value]) => [name.slice(7), value]),
	)
	return accountPreferences({
		...fallback,
		...values,
		editor: { ...fallback.editor, ...editor },
	})
}

function bounded(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
) {
	let number = Number(value)
	return Number.isFinite(number)
		? Math.max(minimum, Math.min(maximum, number))
		: fallback
}
