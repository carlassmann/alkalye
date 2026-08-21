import { co, z } from "jazz-tools"

export { Settings, EditorSettings, DEFAULT_EDITOR_SETTINGS }

let StatsBadgeUnit = z.enum(["words", "sentences", "tasks"])

let EditorSettings = z.object({
	lineWidth: z.number(),
	lineHeight: z.number(),
	letterSpacing: z.number(),
	fontSize: z.number(),
	strikethroughDoneTasks: z.boolean(),
	fadeDoneTasks: z.boolean(),
	highlightCurrentLine: z.boolean(),
	autoSortTasks: z.boolean(),
	spellcheck: z.boolean().optional(),
	spellcheckLanguage: z.enum(["", "en", "de"]).optional(),
	smartPairs: z.boolean().optional(),
	markerWrapping: z.boolean().optional(),
	tabIndent: z.boolean().optional(),
	smartPaste: z.boolean().optional(),
	autocomplete: z.boolean().optional(),
	showStatsBadge: z.boolean(),
	statsBadgeUnit: StatsBadgeUnit,
})

let DEFAULT_EDITOR_SETTINGS: z.infer<typeof EditorSettings> = {
	lineWidth: 65,
	lineHeight: 1.8,
	letterSpacing: 0,
	fontSize: 18,
	strikethroughDoneTasks: false,
	fadeDoneTasks: false,
	highlightCurrentLine: true,
	autoSortTasks: false,
	spellcheck: true,
	spellcheckLanguage: "",
	smartPairs: true,
	markerWrapping: true,
	tabIndent: true,
	smartPaste: true,
	autocomplete: true,
	showStatsBadge: true,
	statsBadgeUnit: "words",
}

let Settings = co.map({
	editor: EditorSettings,
	defaultPreviewTheme: z.string().optional(),
	defaultSlideshowTheme: z.string().optional(),
})
