import { expect, test } from "bun:test"
import { replaceSelectedMatch } from "../src/shared/find"
import { shortcutAction } from "../src/client/shortcuts"

test("selected replacement uses the original regex context and replaces exactly one match", () => {
	for (let [source, regex, start, end, replacement, expected] of [
		["aa", /a*/g, 0, 2, "x", "x"],
		["left cat right", /(?<=left )(c)(at)(?= right)/g, 5, 8, "$2$1", "atc"],
		["cat\ncat", /^cat/gm, 4, 7, "dog", "dog"],
		["cat cat", /^cat/g, 4, 7, "dog", undefined],
		["a cat z", /cat/g, 2, 5, "$`-$&-$'", "a -cat- z"],
		["x😀y", /😀/gu, 1, 3, "🌱", "🌱"],
		["cat", /cat/g, 0, 2, "dog", undefined],
		["cat", /(?=cat)/g, 0, 0, "new ", "new "],
	] satisfies [string, RegExp, number, number, string, string | undefined][]) {
		expect(replaceSelectedMatch(source, regex, replacement, start, end)).toBe(
			expected,
		)
	}
})

test("macOS Option shortcuts use physical keys while other platforms preserve AltGr characters", () => {
	let event = {
		defaultPrevented: false,
		isComposing: false,
		key: "˚",
		code: "KeyK",
		metaKey: true,
		ctrlKey: false,
		altKey: true,
		shiftKey: false,
	}
	expect(shortcutAction(event, "mac")).toBe("asset")
	expect(shortcutAction({ ...event, key: "¡", code: "Digit1" }, "mac")).toBe(
		"h1",
	)
	expect(
		shortcutAction(
			{ ...event, key: "k", code: "KeyK", metaKey: false, ctrlKey: true },
			"other",
		),
	).toBe("asset")
	expect(
		shortcutAction(
			{ ...event, key: "@", code: "KeyK", metaKey: false, ctrlKey: true },
			"other",
		),
	).toBeUndefined()
	expect(
		shortcutAction({ ...event, defaultPrevented: true }, "mac"),
	).toBeUndefined()
	expect(shortcutAction({ ...event, isComposing: true }, "mac")).toBeUndefined()
})
