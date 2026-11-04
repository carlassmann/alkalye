import type { LandingLocale } from "#www/landing-content"

export { demoScenes, demoFrameAt, demoSceneIds, demoIntroText }
export type {
	DemoFrame,
	DemoView,
	DemoSceneId,
	DemoCollaborator,
	DemoStageLabels,
}

let demoSceneIds = [
	"intro",
	"write",
	"together",
	"preview",
	"present",
	"teleprompter",
	"whiteboard",
] as const

type DemoSceneId = (typeof demoSceneIds)[number]
type DemoView =
	| "editor"
	| "preview"
	| "slideshow"
	| "teleprompter"
	| "whiteboard"

interface DemoStageLabels {
	fileName: string
	views: Record<DemoView, string>
}

interface DemoCollaborator {
	name: string
	color: string
}

interface DemoEdit {
	at: "start" | "end"
	text: string
	by: DemoCollaborator | null
}

interface DemoScene {
	id: DemoSceneId
	view: DemoView
	edit?: DemoEdit
}

interface DemoFrame {
	sceneId: DemoSceneId
	view: DemoView
	content: string
	typist: { collaborator: DemoCollaborator; position: number } | null
	// 0..1 within the scene's own animation, after any typing has finished
	viewProgress: number
}

let carl: DemoCollaborator = { name: "Carl", color: "#059669" }
let mia: DemoCollaborator = { name: "Mia", color: "#7c3aed" }

let documents: Record<LandingLocale, Record<DemoSceneId, string>> = {
	en: {
		intro: [
			"# Alkalye in action",
			"",
			"\tThis is a real Alkalye editor.",
			"",
		].join("\n"),
		write: [
			"",
			"Everything here is plain Markdown. Unindented lines are speaker notes, so only you see them.",
			"",
		].join("\n"),
		together: [
			"",
			"---",
			"",
			"# Write together",
			"",
			"\tMia joined from her phone.",
			"",
			"Her edits arrive live, encrypted on her device first.",
			"",
		].join("\n"),
		preview: "",
		present: ["---", "mode: present", "---", "", ""].join("\n"),
		teleprompter: "",
		whiteboard: "",
	},
	de: {
		intro: [
			"# Alkalye in Aktion",
			"",
			"\tDas ist ein echter Alkalye-Editor.",
			"",
		].join("\n"),
		write: [
			"",
			"Alles hier ist schlichtes Markdown. Nicht eingerückte Zeilen sind Sprechernotizen, die nur du siehst.",
			"",
		].join("\n"),
		together: [
			"",
			"---",
			"",
			"# Gemeinsam schreiben",
			"",
			"\tMia ist von ihrem Handy aus dabei.",
			"",
			"Ihre Änderungen kommen live an, vorher auf ihrem Gerät verschlüsselt.",
			"",
		].join("\n"),
		preview: "",
		present: ["---", "mode: present", "---", "", ""].join("\n"),
		teleprompter: "",
		whiteboard: "",
	},
}

function demoScenes(locale: LandingLocale): DemoScene[] {
	let text = documents[locale]
	return [
		{
			id: "intro",
			view: "editor",
			edit: { at: "end", text: text.intro, by: carl },
		},
		{
			id: "write",
			view: "editor",
			edit: { at: "end", text: text.write, by: carl },
		},
		{
			id: "together",
			view: "editor",
			edit: { at: "end", text: text.together, by: mia },
		},
		{ id: "preview", view: "preview" },
		{
			id: "present",
			view: "slideshow",
			edit: { at: "start", text: text.present, by: carl },
		},
		{ id: "teleprompter", view: "teleprompter" },
		{ id: "whiteboard", view: "whiteboard" },
	]
}

// Shown before the stage loads and without JavaScript.
function demoIntroText(locale: LandingLocale): string {
	return documents[locale].intro
}

// Typing takes the first part of a scene that switches views, so the
// visitor sees the edit before the result.
let typingShareBeforeViewSwitch = 0.45

function demoFrameAt(
	scenes: DemoScene[],
	sceneIndex: number,
	progress: number,
): DemoFrame {
	let index = Math.max(0, Math.min(sceneIndex, scenes.length - 1))
	let clampedProgress = Math.max(0, Math.min(progress, 1))
	let content = scenes
		.slice(0, index)
		.reduce((text, scene) => applyEdit(text, scene.edit, 1), "")
	let scene = scenes[index]
	if (!scene.edit) {
		return {
			sceneId: scene.id,
			view: scene.view,
			content,
			typist: null,
			viewProgress: clampedProgress,
		}
	}

	let typingShare = scene.view === "editor" ? 1 : typingShareBeforeViewSwitch
	let typingProgress = Math.min(clampedProgress / typingShare, 1)
	let typed = applyEdit(content, scene.edit, typingProgress)
	let isTyping = clampedProgress < typingShare
	let typedLength = typedCharacters(scene.edit.text, typingProgress)
	let typistPosition =
		scene.edit.at === "start" ? typedLength : content.length + typedLength

	return {
		sceneId: scene.id,
		view: isTyping ? "editor" : scene.view,
		content: typed,
		typist: scene.edit.by
			? { collaborator: scene.edit.by, position: typistPosition }
			: null,
		viewProgress: isTyping
			? 0
			: (clampedProgress - typingShare) / (1 - typingShare),
	}
}

function applyEdit(
	content: string,
	edit: DemoEdit | undefined,
	progress: number,
): string {
	if (!edit) return content
	let typed = edit.text.slice(0, typedCharacters(edit.text, progress))
	return edit.at === "start" ? typed + content : content + typed
}

function typedCharacters(text: string, progress: number): number {
	return Math.round(text.length * Math.max(0, Math.min(progress, 1)))
}
