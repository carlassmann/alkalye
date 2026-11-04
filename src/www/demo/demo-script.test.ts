import { describe, expect, it } from "vitest"
import { demoFrameAt, demoScenes } from "./demo-script"

describe("demoFrameAt", () => {
	let scenes = demoScenes("en")

	it("starts empty and types the intro scene", () => {
		expect(demoFrameAt(scenes, 0, 0).content).toBe("")
		let halfway = demoFrameAt(scenes, 0, 0.5).content
		let done = demoFrameAt(scenes, 0, 1).content
		expect(done.startsWith(halfway)).toBe(true)
		expect(halfway.length).toBeGreaterThan(0)
		expect(halfway.length).toBeLessThan(done.length)
	})

	it("gives the same frame for the same position, whichever way the visitor scrolled", () => {
		let forward = demoFrameAt(scenes, 5, 0.2)
		demoFrameAt(scenes, 7, 1)
		expect(demoFrameAt(scenes, 5, 0.2)).toEqual(forward)
	})

	it("shows the collaborator typing at the end of the document", () => {
		let frame = demoFrameAt(scenes, 2, 0.5)
		expect(frame.typist?.collaborator.name).toBe("Mia")
		expect(frame.typist?.position).toBe(frame.content.length)
	})

	it("types frontmatter at the start before switching to the slideshow", () => {
		let typing = demoFrameAt(scenes, 5, 0.2)
		expect(typing.view).toBe("editor")
		expect(typing.typist?.position).toBeLessThan(typing.content.length)

		let presenting = demoFrameAt(scenes, 5, 0.9)
		expect(presenting.view).toBe("slideshow")
		expect(presenting.content.startsWith("---\nmode: present\n---")).toBe(true)
		expect(presenting.viewProgress).toBeGreaterThan(0.5)
	})

	it("keeps finished edits in later scenes", () => {
		let whiteboard = demoFrameAt(scenes, 7, 0)
		expect(whiteboard.content).toContain("# Write it together")
		expect(whiteboard.content).toContain("# No signal? Keep writing")
		expect(whiteboard.content).toContain("mode: present")
		expect(whiteboard.typist).toBeNull()
	})

	it("shows an offline edit only once it syncs", () => {
		let before = demoFrameAt(scenes, 3, 0).content
		let offline = demoFrameAt(scenes, 3, 0.3)
		expect(offline.connection?.state).toBe("offline")
		expect(offline.content).toBe(before)
		expect(offline.typist).toBeNull()

		let synced = demoFrameAt(scenes, 3, 0.8)
		expect(synced.connection?.state).toBe("synced")
		expect(synced.content).toContain("# No signal? Keep writing")
	})

	it("clamps positions outside the script", () => {
		expect(demoFrameAt(scenes, 99, 2)).toEqual(demoFrameAt(scenes, 7, 1))
		expect(demoFrameAt(scenes, -1, -1)).toEqual(demoFrameAt(scenes, 0, 0))
	})
})
