import { useEffect } from "react"
import type { z } from "zod"
import { useDb } from "jazz-tools/react"
import { app, type SettingsRow } from "@/app/features/documents"
import { EditorSettings, DEFAULT_EDITOR_SETTINGS as DEFAULTS } from "@/schema"

export {
	useEditorSettings,
	applyEditorSettings,
	DEFAULTS as DEFAULT_EDITOR_SETTINGS,
}
export type { EditorSettingsData }

type EditorSettingsData = z.infer<typeof EditorSettings>
type SettingsCoMap = SettingsRow

function applyEditorSettings(settings: EditorSettingsData) {
	let root = document.documentElement
	root.style.setProperty("--editor-content-width", `${settings.lineWidth}ch`)
	root.style.setProperty("--editor-line-height", String(settings.lineHeight))
	root.style.setProperty(
		"--editor-letter-spacing",
		`${settings.letterSpacing}em`,
	)
	root.style.setProperty("--editor-font-size", `${settings.fontSize}px`)
	root.dataset.strikethroughDoneTasks = String(settings.strikethroughDoneTasks)
	root.dataset.fadeDoneTasks = String(settings.fadeDoneTasks)
	root.dataset.highlightCurrentLine = String(settings.highlightCurrentLine)
}

// Apply defaults eagerly to prevent flash. Browser only, and only when
// DEFAULTS is resolved (in tests, circular imports may leave it undefined
// at module-eval time — useEditorSettings will apply them later anyway).
if (typeof document !== "undefined" && DEFAULTS) {
	applyEditorSettings(DEFAULTS)
}

function useEditorSettings(settings: SettingsCoMap | null | undefined) {
	let db = useDb()
	let editorSettings = { ...DEFAULTS, ...settings?.editor }

	function setSettings(updates: Partial<EditorSettingsData>) {
		if (!settings) return
		db.update(app.settings, settings.id, {
			editor: {
				...DEFAULTS,
				...settings.editor,
				...updates,
			},
		})
	}

	function resetSettings() {
		if (!settings) return
		db.update(app.settings, settings.id, { editor: DEFAULTS })
	}

	useEffect(() => {
		applyEditorSettings({ ...DEFAULTS, ...settings?.editor })
	}, [settings?.editor])

	return { settings: editorSettings, setSettings, resetSettings }
}
