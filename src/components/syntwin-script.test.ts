import { afterEach, describe, expect, it } from "vitest"
import { loadSyntwin } from "./syntwin-script"

afterEach(() => {
	document.getElementById("alkalye-syntwin")?.remove()
})

describe("Syntwin integration", () => {
	it("keeps one embed across remounts and updates its surface context", () => {
		loadSyntwin(document, "test-room", "website")
		let script = document.getElementById("alkalye-syntwin")
		loadSyntwin(document, "test-room", "website")
		loadSyntwin(document, "test-room", "app")
		expect(document.querySelectorAll("#alkalye-syntwin")).toHaveLength(1)
		expect(document.getElementById("alkalye-syntwin")).toBe(script)
		expect(script?.dataset.context).toContain("inside Alkalye")
	})

	it("starts app help without a competing floating launcher", () => {
		loadSyntwin(document, "test-room", "app")
		let script = document.getElementById("alkalye-syntwin")
		expect(script?.dataset.launcher).toBe("none")
		expect(script?.dataset.room).toBe("test-room")
		expect(script?.getAttribute("src")).toBe("https://my.syntwin.ai/omny.js")
	})
})
