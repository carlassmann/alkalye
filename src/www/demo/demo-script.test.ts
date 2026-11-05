import { describe, expect, it } from "vitest"
import { demoFrameAt, demoSceneIds, demoScenes } from "./demo-script"

describe("demoFrameAt", () => {
	let scenes = demoScenes("en")
	let at = (id: (typeof demoSceneIds)[number], progress: number) =>
		demoFrameAt(scenes, demoSceneIds.indexOf(id), progress)

	it("starts empty and types the blog post", () => {
		expect(at("intro", 0).content).toBe("")
		let halfway = at("intro", 0.5).content
		let done = at("intro", 1).content
		expect(done.startsWith(halfway)).toBe(true)
		expect(halfway.length).toBeGreaterThan(0)
		expect(halfway.length).toBeLessThan(done.length)
	})

	it("gives the same frame for the same position, whichever way the visitor scrolled", () => {
		let forward = at("slides", 0.3)
		at("present", 1)
		expect(at("slides", 0.3)).toEqual(forward)
	})

	it("shows the Mac resting while the phone types", () => {
		let frame = at("devices", 0.5)
		let devices = frame.cursors.map(cursor => cursor.collaborator.device)
		expect(devices).toEqual(["laptop", "phone"])
	})

	it("lets the agent fix the typo and leave comments", () => {
		expect(at("review", 0).content).toContain("teh same")
		let reviewed = at("review", 1)
		expect(reviewed.content).not.toContain("teh same")
		expect(reviewed.comments).toHaveLength(2)
		expect(reviewed.comments.every(c => c.by.device === "agent")).toBe(true)
	})

	it("turns the post into slides", () => {
		let talk = at("slides", 1).content
		expect(talk.startsWith("---\nmode: present\n---")).toBe(true)
		expect(talk).toContain("\n---\n\n# Every device is just another cursor")
	})

	it("rewinds the mess from other devices and keeps that version for the talk", () => {
		let messy = at("history", 0)
		expect(messy.content).toContain("🚀")
		expect(messy.content).toContain("10 reasons")

		let rewound = at("history", 1)
		expect(rewound.history?.index).toBeLessThan(messy.history?.index ?? 0)
		expect(rewound.content).not.toContain("🚀")
		expect(rewound.content).not.toContain("10 reasons")
		expect(rewound.content).toContain("/demo/sketch.svg")

		expect(at("present", 0.5).content).toBe(rewound.content)
	})

	it("types the same story in German", () => {
		let german = demoScenes("de")
		let talk = demoFrameAt(german, demoSceneIds.indexOf("present"), 0)
		expect(talk.content).toContain("# Warum ich Alkalye gebaut habe")
		expect(talk.content).not.toContain("🚀")
	})
})
