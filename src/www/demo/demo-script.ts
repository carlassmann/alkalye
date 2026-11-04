import type { LandingLocale } from "#www/landing-content"

export { demoScenes, demoFrameAt, demoSceneIds, demoIntroText, demoSketch }
export type {
	DemoFrame,
	DemoView,
	DemoSceneId,
	DemoCollaborator,
	DemoCursor,
	DemoComment,
	DemoVersion,
	DemoStageLabels,
	DemoScene,
}

let demoSceneIds = [
	"intro",
	"devices",
	"review",
	"slides",
	"sketch",
	"toomuch",
	"history",
	"present",
] as const

type DemoSceneId = (typeof demoSceneIds)[number]
type DemoView = "editor" | "review" | "whiteboard" | "timemachine" | "present"

interface DemoStageLabels {
	fileName: string
	views: Record<DemoView, string>
	you: string
	hints: Record<DemoView, string>
}

type DemoDevice = "phone" | "laptop" | "agent"

interface DemoCollaborator {
	name: string
	color: string
	device: DemoDevice | "visitor"
}

interface DemoCursor {
	collaborator: DemoCollaborator
	position: number
}

interface DemoComment {
	id: string
	quote: string
	body: string
	by: DemoCollaborator
}

interface DemoVersion {
	content: string
	by: DemoCollaborator
	daysAgo: number
}

// Each step turns the document into its next version.
type DemoStep = (content: string) => string

interface DemoScene {
	id: DemoSceneId
	view: DemoView
	by: DemoCollaborator | null
	steps: DemoStep[]
	// Collaborators whose cursors rest in the document while someone else types.
	watchers?: DemoCollaborator[]
	comments?: DemoComment[]
	// How long ago the scene happened, for the time machine.
	daysAgo: number
}

interface DemoFrame {
	sceneId: DemoSceneId
	view: DemoView
	content: string
	cursors: DemoCursor[]
	comments: DemoComment[]
	history: { versions: DemoVersion[]; index: number } | null
	// 0..1 within the scene's own animation, after any typing has finished
	viewProgress: number
}

// Carl's own phone and Mac, plus an agent working through the alkalye CLI.
let people: Record<LandingLocale, Record<DemoDevice, DemoCollaborator>> = {
	en: {
		laptop: { name: "Carl · Mac", color: "#2563eb", device: "laptop" },
		phone: { name: "Carl · phone", color: "#059669", device: "phone" },
		agent: { name: "Claude · CLI", color: "#9333ea", device: "agent" },
	},
	de: {
		laptop: { name: "Carl · Mac", color: "#2563eb", device: "laptop" },
		phone: { name: "Carl · Handy", color: "#059669", device: "phone" },
		agent: { name: "Claude · CLI", color: "#9333ea", device: "agent" },
	},
}

interface DemoText {
	post: string
	devices: string
	typo: [string, string]
	comments: { quote: string; body: string }[]
	frontmatter: string
	titleLine: [string, string]
	intro: [string, string]
	secondSlide: [string, string]
	sketchSlide: string
	tooMuch: { phone: [string, string]; agent: [string, string] }
	sketch: Record<DemoDevice, string> & { document: string }
}

// A blog post about Alkalye that becomes a talk. Slides are a heading with an
// indented line below it; unindented lines are speaker notes.
let texts: Record<LandingLocale, DemoText> = {
	en: {
		post: [
			"# Why I built Alkalye",
			"",
			"I write on my phone and on my Mac. My favorite notes app had the minimalism I admired. Then I used it heavily on both at once, and it kept asking teh same question: which version do you want to keep?",
			"",
		].join("\n"),
		devices: [
			"",
			"I was the only one editing. So I built an editor where every device is just another cursor.",
			"",
		].join("\n"),
		typo: ["teh same", "the same"],
		comments: [
			{
				quote: "every device is just another cursor",
				body: "Strong line. Make it the title of a slide?",
			},
			{
				quote: "My favorite notes app",
				body: "Name it? Readers will ask.",
			},
		],
		frontmatter: ["---", "mode: present", "---", "", ""].join("\n"),
		titleLine: [
			"# Why I built Alkalye\n",
			"# Why I built Alkalye\n\t“Which version do you want to keep?”\n",
		],
		intro: [
			"I write on my phone and on my Mac. My favorite notes app had the minimalism I admired. Then I used it heavily on both at once, and it kept asking the same question: which version do you want to keep?",
			"I write on my phone and on my Mac. My favorite notes app had the minimalism I admired, until I used it on both at once.",
		],
		secondSlide: [
			"\nI was the only one",
			"\n---\n\n# Every device is just another cursor\n\tMultiplayer, for one\n\nI was the only one",
		],
		sketchSlide:
			"\n---\n\n# One document, many hands\n![Sketch](/demo/sketch.svg)\n",
		tooMuch: {
			phone: [
				"# Every device is just another cursor",
				"# 🚀 Every device is just another cursor 🚀🚀",
			],
			agent: [
				"\n---\n\n# One document",
				"\n---\n\n# 10 reasons local-first wins\n\t1. Speed 2. Privacy 3. Offline 4. Ownership 5. …\n\n---\n\n# One document",
			],
		},
		sketch: {
			phone: "Phone",
			laptop: "Mac",
			agent: "Agent",
			document: "why-i-built-alkalye.md",
		},
	},
	de: {
		post: [
			"# Warum ich Alkalye gebaut habe",
			"",
			"Ich schreibe auf dem Handy und auf dem Mac. Meine liebste Notiz-App hatte den Minimalismus, den ich bewundere. Dann nutzte ich sie intensiv auf beiden gleichzeitig, und sie fragte mich dieselbe Frage: Welche Version willst du behalten?",
			"",
		].join("\n"),
		devices: [
			"",
			"Ich war der Einzige, der schrieb. Also baute ich einen Editor, in dem jedes Gerät nur ein weiterer Cursor ist.",
			"",
		].join("\n"),
		typo: ["fragte mich dieselbe", "stellte mir dieselbe"],
		comments: [
			{
				quote: "jedes Gerät nur ein weiterer Cursor ist",
				body: "Starker Satz. Mach daraus eine Folie?",
			},
			{
				quote: "Meine liebste Notiz-App",
				body: "Nenn sie? Leser werden fragen.",
			},
		],
		frontmatter: ["---", "mode: present", "---", "", ""].join("\n"),
		titleLine: [
			"# Warum ich Alkalye gebaut habe\n",
			"# Warum ich Alkalye gebaut habe\n\t„Welche Version willst du behalten?“\n",
		],
		intro: [
			"Ich schreibe auf dem Handy und auf dem Mac. Meine liebste Notiz-App hatte den Minimalismus, den ich bewundere. Dann nutzte ich sie intensiv auf beiden gleichzeitig, und sie stellte mir dieselbe Frage: Welche Version willst du behalten?",
			"Ich schreibe auf dem Handy und auf dem Mac. Meine liebste Notiz-App hatte den Minimalismus, den ich bewundere, bis ich sie auf beiden gleichzeitig nutzte.",
		],
		secondSlide: [
			"\nIch war der Einzige",
			"\n---\n\n# Jedes Gerät ist nur ein weiterer Cursor\n\tMultiplayer für eine Person\n\nIch war der Einzige",
		],
		sketchSlide:
			"\n---\n\n# Ein Dokument, viele Hände\n![Skizze](/demo/sketch-de.svg)\n",
		tooMuch: {
			phone: [
				"# Jedes Gerät ist nur ein weiterer Cursor",
				"# 🚀 Jedes Gerät ist nur ein weiterer Cursor 🚀🚀",
			],
			agent: [
				"\n---\n\n# Ein Dokument",
				"\n---\n\n# 10 Gründe für Local-first\n\t1. Tempo 2. Privatsphäre 3. Offline 4. Besitz 5. …\n\n---\n\n# Ein Dokument",
			],
		},
		sketch: {
			phone: "Handy",
			laptop: "Mac",
			agent: "Agent",
			document: "warum-alkalye.md",
		},
	},
}

function demoScenes(locale: LandingLocale): DemoScene[] {
	let text = texts[locale]
	let { laptop, phone, agent } = people[locale]
	return [
		{
			id: "intro",
			view: "editor",
			by: laptop,
			steps: [append(text.post)],
			daysAgo: 9,
		},
		{
			id: "devices",
			view: "editor",
			by: phone,
			watchers: [laptop],
			steps: [append(text.devices)],
			daysAgo: 9,
		},
		{
			id: "review",
			view: "review",
			by: agent,
			watchers: [laptop],
			steps: [replace(...text.typo)],
			comments: text.comments.map((comment, index) => ({
				id: `comment-${index}`,
				by: agent,
				...comment,
			})),
			daysAgo: 8,
		},
		{
			id: "slides",
			view: "editor",
			by: laptop,
			steps: [
				prepend(text.frontmatter),
				replace(...text.titleLine),
				replace(...text.intro),
				replace(...text.secondSlide),
			],
			daysAgo: 6,
		},
		{
			id: "sketch",
			view: "whiteboard",
			by: laptop,
			steps: [append(text.sketchSlide)],
			daysAgo: 6,
		},
		{
			id: "toomuch",
			view: "editor",
			by: phone,
			steps: [
				replace(...text.tooMuch.phone),
				withAuthor(agent, replace(...text.tooMuch.agent)),
			],
			daysAgo: 1,
		},
		{ id: "history", view: "timemachine", by: null, steps: [], daysAgo: 0 },
		{ id: "present", view: "present", by: null, steps: [], daysAgo: 0 },
	]
}

function demoSketch(locale: LandingLocale) {
	return texts[locale].sketch
}

// Shown before the stage loads and without JavaScript.
function demoIntroText(locale: LandingLocale): string {
	return texts[locale].post
}

// Typing takes the first part of a scene that switches views, so the
// visitor sees the edit before the result.
let typingShareBeforeViewSwitch = 0.4
// The time machine drags back over most of its scene, then rests.
let rewindShare = 0.7

function demoFrameAt(
	scenes: DemoScene[],
	sceneIndex: number,
	progress: number,
): DemoFrame {
	let index = Math.max(0, Math.min(sceneIndex, scenes.length - 1))
	let clampedProgress = Math.max(0, Math.min(progress, 1))
	let scene = scenes[index]
	let versions = versionsBefore(scenes, index)
	let content = versions.at(-1)?.content ?? ""

	if (scene.view === "timemachine" || scene.view === "present") {
		let history = rewind(scenes, versions)
		let rewound =
			scene.view === "present"
				? history.target
				: Math.round(
						history.latest -
							(history.latest - history.target) *
								easeInOut(Math.min(clampedProgress / rewindShare, 1)),
					)
		return {
			sceneId: scene.id,
			view: scene.view,
			content: versions[rewound]?.content ?? content,
			cursors: [],
			comments: [],
			history: { versions, index: rewound },
			viewProgress: clampedProgress,
		}
	}

	let typingShare = scene.view === "editor" ? 1 : typingShareBeforeViewSwitch
	let typingProgress = Math.min(clampedProgress / typingShare, 1)
	let typed = typeSteps(scene, content, typingProgress)
	let isTyping = clampedProgress < typingShare

	return {
		sceneId: scene.id,
		view: isTyping ? editorViewFor(scene) : scene.view,
		content: typed.content,
		cursors: [
			...(scene.watchers ?? []).map(collaborator => ({
				collaborator,
				position: restingPosition(typed.content),
			})),
			...(typed.cursor ? [typed.cursor] : []),
		],
		comments: visibleComments(scene, clampedProgress, typed.content),
		history: null,
		viewProgress: isTyping
			? 0
			: (clampedProgress - typingShare) / (1 - typingShare),
	}
}

function editorViewFor(scene: DemoScene): DemoView {
	return scene.view === "review" ? "review" : "editor"
}

// Every finished step is a version the time machine can return to.
function versionsBefore(scenes: DemoScene[], index: number): DemoVersion[] {
	let versions: DemoVersion[] = []
	let content = ""
	for (let scene of scenes.slice(0, index)) {
		for (let step of scene.steps) {
			content = step(content)
			let by = stepAuthors.get(step) ?? scene.by
			if (by) versions.push({ content, by, daysAgo: scene.daysAgo })
		}
	}
	return versions
}

// The time machine goes back to the talk as it stood after the sketch.
function rewind(scenes: DemoScene[], versions: DemoVersion[]) {
	let sketchIndex = scenes.findIndex(scene => scene.id === "sketch")
	let target = versionsBefore(scenes, sketchIndex + 1).length - 1
	return { latest: versions.length - 1, target: Math.max(target, 0) }
}

function typeSteps(
	scene: DemoScene,
	content: string,
	progress: number,
): { content: string; cursor: DemoCursor | null } {
	if (scene.steps.length === 0) return { content, cursor: null }
	let scaled = progress * scene.steps.length
	let stepIndex = Math.min(Math.floor(scaled), scene.steps.length - 1)
	let before = scene.steps
		.slice(0, stepIndex)
		.reduce((text, step) => step(text), content)
	let step = scene.steps[stepIndex]
	let morph = morphText(before, step(before), scaled - stepIndex)
	let by = stepAuthors.get(step) ?? scene.by
	return {
		content: morph.content,
		cursor: by ? { collaborator: by, position: morph.position } : null,
	}
}

// Deletes the changed part, then types its replacement, like a person would.
function morphText(from: string, to: string, progress: number) {
	let start = 0
	while (start < from.length && start < to.length && from[start] === to[start])
		start++
	let end = 0
	while (
		end < from.length - start &&
		end < to.length - start &&
		from[from.length - 1 - end] === to[to.length - 1 - end]
	)
		end++
	// A new slide repeats the "---" around it; typing it at the earlier
	// boundary reads like a person adding a block, not editing mid-line.
	while (
		start > 0 &&
		from.length === start + end &&
		from[start - 1] === to[to.length - end - 1]
	) {
		start--
		end++
	}
	let removed = from.slice(start, from.length - end)
	let inserted = to.slice(start, to.length - end)
	let suffix = from.slice(from.length - end)
	// Deleting is quicker than typing.
	let deleteWork = removed.length / 3
	let total = deleteWork + inserted.length
	let done = Math.max(0, Math.min(progress, 1)) * total
	if (done < deleteWork) {
		let kept = removed.slice(0, removed.length - Math.round(done * 3))
		return {
			content: from.slice(0, start) + kept + suffix,
			position: start + kept.length,
		}
	}
	let typed = inserted.slice(0, Math.round(done - deleteWork))
	return {
		content: from.slice(0, start) + typed + suffix,
		position: start + typed.length,
	}
}

// Someone who stopped typing rests at the end of the first paragraph.
function restingPosition(content: string): number {
	let paragraphEnd = content.indexOf("\n\n", content.indexOf("\n\n") + 2)
	return paragraphEnd === -1 ? content.length : paragraphEnd
}

function visibleComments(
	scene: DemoScene,
	progress: number,
	content: string,
): DemoComment[] {
	let comments = scene.comments ?? []
	return comments.filter(
		(comment, index) =>
			progress >= (index + 1) / (comments.length + 1) &&
			content.includes(comment.quote),
	)
}

function easeInOut(t: number): number {
	return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
}

function append(text: string): DemoStep {
	return content => content + text
}

function prepend(text: string): DemoStep {
	return content => text + content
}

function replace(find: string, replacement: string): DemoStep {
	return content => content.replace(find, replacement)
}

let stepAuthors = new WeakMap<DemoStep, DemoCollaborator>()

// A step someone other than the scene's author types.
function withAuthor(by: DemoCollaborator, step: DemoStep): DemoStep {
	stepAuthors.set(step, by)
	return step
}
