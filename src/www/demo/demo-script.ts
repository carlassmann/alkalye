import type { LandingLocale } from "#www/landing-content"

export { demoScenes, demoFrameAt, demoSceneIds, demoIntroText }
export type {
	DemoFrame,
	DemoView,
	DemoSceneId,
	DemoCollaborator,
	DemoConnection,
	DemoStageLabels,
}

let demoSceneIds = [
	"intro",
	"write",
	"desk",
	"offline",
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
	offline: string
	synced: string
}

type DemoDevice = "phone" | "laptop"

interface DemoCollaborator {
	name: string
	color: string
	device: DemoDevice
}

interface DemoEdit {
	at: "start" | "end"
	text: string
	by: DemoCollaborator | null
	// Written without a connection: the others see it only once it syncs.
	offline?: boolean
}

interface DemoScene {
	id: DemoSceneId
	view: DemoView
	edit?: DemoEdit
}

interface DemoConnection {
	collaborator: DemoCollaborator
	state: "offline" | "synced"
}

interface DemoFrame {
	sceneId: DemoSceneId
	view: DemoView
	content: string
	typist: { collaborator: DemoCollaborator; position: number } | null
	connection: DemoConnection | null
	// 0..1 within the scene's own animation, after any typing has finished
	viewProgress: number
}

// Carl prepares a lightning talk on his own phone and Mac, the situation
// Alkalye was built for. Indented lines are the slides, unindented lines are
// his speaker notes.
let devices: Record<LandingLocale, Record<DemoDevice, DemoCollaborator>> = {
	en: {
		phone: { name: "Carl · phone", color: "#059669", device: "phone" },
		laptop: { name: "Carl · Mac", color: "#2563eb", device: "laptop" },
	},
	de: {
		phone: { name: "Carl · Handy", color: "#059669", device: "phone" },
		laptop: { name: "Carl · Mac", color: "#2563eb", device: "laptop" },
	},
}

let documents: Record<LandingLocale, Record<DemoSceneId, string>> = {
	en: {
		intro: ["# One person, two devices", "", "\tA lightning talk", ""].join(
			"\n",
		),
		write: [
			"",
			"Story: notes on my phone, then on my Mac, and the app asked which version to keep.",
			"",
			"\tI was the only one editing.",
			"",
		].join("\n"),
		desk: [
			"",
			"---",
			"",
			"# Multiplayer for one",
			"",
			"\tEvery device is just another cursor.",
			"",
		].join("\n"),
		offline: [
			"",
			"---",
			"",
			"# No signal? Keep writing",
			"",
			"\tIt syncs when you are back.",
			"",
		].join("\n"),
		preview: "",
		present: ["---", "mode: present", "---", "", ""].join("\n"),
		teleprompter: "",
		whiteboard: "",
	},
	de: {
		intro: ["# Eine Person, zwei Geräte", "", "\tEin Kurzvortrag", ""].join(
			"\n",
		),
		write: [
			"",
			"Geschichte: Notizen auf dem Handy, dann auf dem Mac, und die App fragte, welche Version ich behalten will.",
			"",
			"\tIch war der Einzige, der schrieb.",
			"",
		].join("\n"),
		desk: [
			"",
			"---",
			"",
			"# Multiplayer für eine Person",
			"",
			"\tJedes Gerät ist nur ein weiterer Cursor.",
			"",
		].join("\n"),
		offline: [
			"",
			"---",
			"",
			"# Kein Netz? Weiterschreiben",
			"",
			"\tEs synchronisiert, sobald du wieder online bist.",
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
	let { phone, laptop } = devices[locale]
	return [
		{
			id: "intro",
			view: "editor",
			edit: { at: "end", text: text.intro, by: phone },
		},
		{
			id: "write",
			view: "editor",
			edit: { at: "end", text: text.write, by: phone },
		},
		{
			id: "desk",
			view: "editor",
			edit: { at: "end", text: text.desk, by: laptop },
		},
		{
			id: "offline",
			view: "editor",
			edit: { at: "end", text: text.offline, by: phone, offline: true },
		},
		{ id: "preview", view: "preview" },
		{
			id: "present",
			view: "slideshow",
			edit: { at: "start", text: text.present, by: laptop },
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
// An offline edit stays on the writer's device for most of its scene.
let offlineShare = 0.6

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
			connection: null,
			viewProgress: clampedProgress,
		}
	}

	if (scene.edit.offline) {
		let isOffline = clampedProgress < offlineShare
		let synced = applyEdit(content, scene.edit, isOffline ? 0 : 1)
		return {
			sceneId: scene.id,
			view: scene.view,
			content: synced,
			typist:
				scene.edit.by && !isOffline
					? { collaborator: scene.edit.by, position: synced.length }
					: null,
			connection: scene.edit.by
				? {
						collaborator: scene.edit.by,
						state: isOffline ? "offline" : "synced",
					}
				: null,
			viewProgress: 0,
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
		connection: null,
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
