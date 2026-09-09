import { describe, it, expect } from "vitest"
import {
	parseFrontmatter,
	getBacklinks,
	setBacklinks,
	addBacklink,
	removeBacklink,
	getTags,
	getPath,
	togglePinned,
	addTag,
	setTheme,
	setPreset,
	setSyntaxTheme,
} from "./frontmatter"

describe("parseFrontmatter", () => {
	it("parses basic frontmatter", () => {
		let content = `---
title: My Doc
pinned: true
---

Body content`
		let { frontmatter, body } = parseFrontmatter(content)

		expect(frontmatter).toEqual({ title: "My Doc", pinned: true })
		expect(body).toBe("\nBody content")
	})

	it("returns null frontmatter for no frontmatter", () => {
		let { frontmatter, body } = parseFrontmatter("Just body")

		expect(frontmatter).toBeNull()
		expect(body).toBe("Just body")
	})

	it("handles quoted values", () => {
		let content = `---
title: "Quoted Title"
path: 'Single Quoted'
---
`
		let { frontmatter } = parseFrontmatter(content)

		expect(frontmatter?.title).toBe("Quoted Title")
		expect(frontmatter?.path).toBe("Single Quoted")
	})

	it("handles boolean values", () => {
		let content = `---
pinned: true
archived: false
---
`
		let { frontmatter } = parseFrontmatter(content)

		expect(frontmatter?.pinned).toBe(true)
		expect(frontmatter?.archived).toBe(false)
	})
})

describe("getBacklinks", () => {
	it("returns empty array for no frontmatter", () => {
		expect(getBacklinks("Just content")).toEqual([])
	})

	it("returns empty array for frontmatter without backlinks", () => {
		let content = `---
title: Doc
---
Content`
		expect(getBacklinks(content)).toEqual([])
	})

	it("parses single backlink", () => {
		let content = `---
backlinks: abc123
---
Content`
		expect(getBacklinks(content)).toEqual(["abc123"])
	})

	it("parses multiple backlinks", () => {
		let content = `---
backlinks: abc123, def456, ghi789
---
Content`
		expect(getBacklinks(content)).toEqual(["abc123", "def456", "ghi789"])
	})

	it("handles extra whitespace", () => {
		let content = `---
backlinks:   abc123  ,  def456  
---
`
		expect(getBacklinks(content)).toEqual(["abc123", "def456"])
	})

	it("filters empty values", () => {
		let content = `---
backlinks: abc123, , def456,
---
`
		expect(getBacklinks(content)).toEqual(["abc123", "def456"])
	})
})

describe("setBacklinks", () => {
	it("adds backlinks to content without frontmatter", () => {
		let result = setBacklinks("Content", ["abc", "def"])

		expect(result).toBe(`---
backlinks: abc, def
---

Content`)
	})

	it("adds backlinks to existing frontmatter", () => {
		let content = `---
title: Doc
---
Content`
		let result = setBacklinks(content, ["abc", "def"])

		expect(result).toBe(`---
backlinks: abc, def
title: Doc
---
Content`)
	})

	it("updates existing backlinks", () => {
		let content = `---
backlinks: old1, old2
title: Doc
---
Content`
		let result = setBacklinks(content, ["new1", "new2"])

		expect(result).toBe(`---
backlinks: new1, new2
title: Doc
---
Content`)
	})

	it("removes backlinks field when empty array", () => {
		let content = `---
backlinks: abc, def
title: Doc
---
Content`
		let result = setBacklinks(content, [])

		expect(result).toBe(`---
title: Doc
---
Content`)
	})

	it("does nothing when setting empty on no frontmatter", () => {
		let content = "Just content"
		let result = setBacklinks(content, [])

		expect(result).toBe("Just content")
	})

	it("filters empty ids", () => {
		let result = setBacklinks("Content", ["abc", "", "def"])

		expect(getBacklinks(result)).toEqual(["abc", "def"])
	})
})

describe("addBacklink", () => {
	it("adds to empty content", () => {
		let result = addBacklink("Content", "abc123")

		expect(getBacklinks(result)).toEqual(["abc123"])
	})

	it("adds to existing backlinks", () => {
		let content = `---
backlinks: abc
---
Content`
		let result = addBacklink(content, "def")

		expect(getBacklinks(result)).toEqual(["abc", "def"])
	})

	it("does not duplicate existing backlink", () => {
		let content = `---
backlinks: abc, def
---
Content`
		let result = addBacklink(content, "abc")

		expect(result).toBe(content)
		expect(getBacklinks(result)).toEqual(["abc", "def"])
	})
})

describe("removeBacklink", () => {
	it("removes existing backlink", () => {
		let content = `---
backlinks: abc, def, ghi
---
Content`
		let result = removeBacklink(content, "def")

		expect(getBacklinks(result)).toEqual(["abc", "ghi"])
	})

	it("does nothing if backlink not found", () => {
		let content = `---
backlinks: abc, def
---
Content`
		let result = removeBacklink(content, "xyz")

		expect(result).toBe(content)
	})

	it("removes backlinks field when last one removed", () => {
		let content = `---
backlinks: abc
title: Doc
---
Content`
		let result = removeBacklink(content, "abc")

		expect(getBacklinks(result)).toEqual([])
		expect(result).not.toContain("backlinks")
	})
})

describe("edge cases", () => {
	describe("empty frontmatter", () => {
		it("parses empty frontmatter as empty object", () => {
			let content = `---
---
Content`
			let { frontmatter, body } = parseFrontmatter(content)

			expect(frontmatter).toEqual({})
			expect(body).toBe("Content")
		})

		it("adds backlinks to empty frontmatter", () => {
			let content = `---
---
Content`
			let result = setBacklinks(content, ["abc"])

			expect(getBacklinks(result)).toEqual(["abc"])
		})
	})

	describe("hr at start (not frontmatter)", () => {
		it("does not parse --- without closing as frontmatter", () => {
			let content = `---
Just content after hr`
			let { frontmatter, body } = parseFrontmatter(content)

			expect(frontmatter).toBeNull()
			expect(body).toBe(content)
		})

		it("does not parse --- followed by non-yaml content", () => {
			let content = `---
# Heading after hr
Some text`
			let { frontmatter, body } = parseFrontmatter(content)

			// This should not be parsed as frontmatter since there's no closing ---
			expect(frontmatter).toBeNull()
			expect(body).toBe(content)
		})
	})

	describe("removing last field should remove frontmatter", () => {
		it("removes frontmatter when last backlink removed", () => {
			let content = `---
backlinks: abc
---
Content`
			let result = removeBacklink(content, "abc")

			// Should become just "Content" with no frontmatter
			expect(result).not.toContain("---")
			expect(result.trim()).toBe("Content")
		})

		it("removes frontmatter when setting empty backlinks on single-field frontmatter", () => {
			let content = `---
backlinks: abc, def
---
Content`
			let result = setBacklinks(content, [])

			expect(result).not.toContain("---")
			expect(result.trim()).toBe("Content")
		})
	})

	describe("adding to frontmatter without field", () => {
		it("adds backlinks field when not present", () => {
			let content = `---
title: Doc
---
Content`
			let result = addBacklink(content, "abc")

			expect(getBacklinks(result)).toEqual(["abc"])
			expect(result).toContain("title: Doc")
		})

		it("adds tag field when not present", () => {
			let content = `---
title: Doc
---
Content`
			let result = addTag(content, "mytag")

			expect(getTags(result)).toEqual(["mytag"])
			expect(result).toContain("title: Doc")
		})
	})

	describe("field already exists", () => {
		it("updates existing backlinks field", () => {
			let content = `---
backlinks: existing
title: Doc
---
Content`
			let result = addBacklink(content, "new")

			expect(getBacklinks(result)).toEqual(["existing", "new"])
		})

		it("updates existing tags field", () => {
			let content = `---
tags: existing
title: Doc
---
Content`
			let result = addTag(content, "new")

			expect(getTags(result)).toEqual(["existing", "new"])
		})
	})

	describe("frontmatter with only whitespace", () => {
		it("handles frontmatter with only spaces", () => {
			let content = `---
   
---
Content`
			let { frontmatter } = parseFrontmatter(content)

			expect(frontmatter).toEqual({})
		})
	})
})

describe("existing frontmatter functions", () => {
	describe("getTags", () => {
		it("parses comma-separated tags", () => {
			let content = `---
tags: one, two, three
---
`
			expect(getTags(content)).toEqual(["one", "two", "three"])
		})

		it("returns empty for no tags", () => {
			expect(getTags("No frontmatter")).toEqual([])
		})
	})

	describe("getPath", () => {
		it("returns path without slashes", () => {
			let content = `---
path: /Daily Notes/2025/
---
`
			expect(getPath(content)).toBe("Daily Notes/2025")
		})

		it("returns null for no path", () => {
			expect(getPath("No frontmatter")).toBeNull()
		})
	})

	describe("togglePinned", () => {
		it("adds pinned to unpinned doc", () => {
			let content = `---
title: Doc
---
Content`
			let result = togglePinned(content)

			expect(parseFrontmatter(result).frontmatter?.pinned).toBe(true)
		})

		it("removes pinned from pinned doc", () => {
			let content = `---
pinned: true
title: Doc
---
Content`
			let result = togglePinned(content)

			expect(result).not.toContain("pinned")
		})
	})

	describe("addTag", () => {
		it("adds tag to existing tags", () => {
			let content = `---
tags: one, two
---
`
			let result = addTag(content, "three")

			expect(getTags(result)).toEqual(["one", "two", "three"])
		})

		it("does not duplicate existing tag", () => {
			let content = `---
tags: one, two
---
`
			let result = addTag(content, "one")

			expect(getTags(result)).toEqual(["one", "two"])
		})
	})
})

describe("setTheme", () => {
	it("adds theme to content without frontmatter", () => {
		let result = setTheme("Content", "MyTheme")

		expect(result).toBe(`---
theme: MyTheme
---

Content`)
	})

	it("adds theme to existing frontmatter without theme", () => {
		let content = `---
title: Doc
---
Content`
		let result = setTheme(content, "DarkMode")

		expect(result).toBe(`---
theme: DarkMode
title: Doc
---
Content`)
	})

	it("updates existing theme field", () => {
		let content = `---
theme: OldTheme
title: Doc
---
Content`
		let result = setTheme(content, "NewTheme")

		expect(result).toBe(`---
theme: NewTheme
title: Doc
---
Content`)
	})

	it("removes theme when null is passed", () => {
		let content = `---
theme: MyTheme
title: Doc
---
Content`
		let result = setTheme(content, null)

		expect(result).toBe(`---
title: Doc
---
Content`)
		expect(result).not.toContain("theme:")
	})

	it("removes theme when empty string is passed", () => {
		let content = `---
theme: MyTheme
title: Doc
---
Content`
		let result = setTheme(content, "")

		expect(result).not.toContain("theme:")
	})

	it("does nothing when removing non-existent theme", () => {
		let content = `---
title: Doc
---
Content`
		let result = setTheme(content, null)

		expect(result).toBe(content)
	})

	it("removes frontmatter when theme is the only field", () => {
		let content = `---
theme: MyTheme
---
Content`
		let result = setTheme(content, null)

		expect(result).not.toContain("---")
		expect(result.trim()).toBe("Content")
	})

	it("preserves other frontmatter fields when updating theme", () => {
		let content = `---
title: Doc
theme: OldTheme
pinned: true
---
Content`
		let result = setTheme(content, "NewTheme")

		expect(parseFrontmatter(result).frontmatter).toEqual({
			title: "Doc",
			theme: "NewTheme",
			pinned: true,
		})
	})
})

describe("setSyntaxTheme", () => {
	it("sets and removes a document syntax theme without disturbing metadata", () => {
		let content = `---
title: Doc
---
Content`
		let themed = setSyntaxTheme(content, "catppuccin")

		expect(parseFrontmatter(themed).frontmatter).toEqual({
			"syntax-theme": "catppuccin",
			title: "Doc",
		})
		expect(setSyntaxTheme(themed, null)).toBe(content)
	})

	it("does not collide with the document theme field", () => {
		let content = `---
syntax-theme: catppuccin
theme: OldTheme
---
Content`

		expect(parseFrontmatter(setTheme(content, "NewTheme")).frontmatter).toEqual(
			{
				"syntax-theme": "catppuccin",
				theme: "NewTheme",
			},
		)
		expect(parseFrontmatter(setTheme(content, null)).frontmatter).toEqual({
			"syntax-theme": "catppuccin",
		})
	})

	it("replaces an empty syntax theme field", () => {
		let content = `---
syntax-theme:
---
Content`
		let result = setSyntaxTheme(content, "github")

		expect(result.match(/^syntax-theme:/gm)).toHaveLength(1)
		expect(parseFrontmatter(result).frontmatter?.["syntax-theme"]).toBe(
			"github",
		)
	})

	it("only updates fields inside frontmatter", () => {
		let content = `---
theme: OldTheme
---

theme: ExampleTheme`
		let updated = setTheme(content, "NewTheme")

		expect(updated).toContain("theme: NewTheme\n---")
		expect(updated).toContain("\ntheme: ExampleTheme")
	})

	it("preserves CRLF line endings", () => {
		let content =
			"---\r\nsyntax-theme: github\r\ntheme: OldTheme\r\n---\r\nBody"
		let updated = setTheme(content, "NewTheme")

		expect(updated).toBe(
			"---\r\nsyntax-theme: github\r\ntheme: NewTheme\r\n---\r\nBody",
		)
	})
})

describe("setPreset", () => {
	it("adds preset to content without frontmatter", () => {
		let result = setPreset("Content", "Dark")

		expect(result).toBe(`---
preset: Dark
---

Content`)
	})

	it("adds preset to existing frontmatter without preset", () => {
		let content = `---
theme: MyTheme
---
Content`
		let result = setPreset(content, "Light")

		expect(result).toBe(`---
preset: Light
theme: MyTheme
---
Content`)
	})

	it("updates existing preset field", () => {
		let content = `---
theme: MyTheme
preset: OldPreset
---
Content`
		let result = setPreset(content, "NewPreset")

		expect(result).toBe(`---
theme: MyTheme
preset: NewPreset
---
Content`)
	})

	it("removes preset when null is passed", () => {
		let content = `---
theme: MyTheme
preset: Dark
---
Content`
		let result = setPreset(content, null)

		expect(result).toBe(`---
theme: MyTheme
---
Content`)
		expect(result).not.toContain("preset:")
	})

	it("removes preset when empty string is passed", () => {
		let content = `---
theme: MyTheme
preset: Dark
---
Content`
		let result = setPreset(content, "")

		expect(result).not.toContain("preset:")
	})

	it("does nothing when removing non-existent preset", () => {
		let content = `---
theme: MyTheme
---
Content`
		let result = setPreset(content, null)

		expect(result).toBe(content)
	})

	it("removes frontmatter when preset is the only field", () => {
		let content = `---
preset: Dark
---
Content`
		let result = setPreset(content, null)

		expect(result).not.toContain("---")
		expect(result.trim()).toBe("Content")
	})

	it("preserves other frontmatter fields when updating preset", () => {
		let content = `---
theme: MyTheme
preset: OldPreset
pinned: true
---
Content`
		let result = setPreset(content, "NewPreset")

		expect(parseFrontmatter(result).frontmatter).toEqual({
			theme: "MyTheme",
			preset: "NewPreset",
			pinned: true,
		})
	})
})

describe("scalar frontmatter updates", () => {
	it("does not match field names as substrings", () => {
		let content = `---
autotags: keep
tags: old
mybacklinks: keep
backlinks: old
unpinned: true
pinned: true
---
Content`

		let updated = addTag(content, "new")
		updated = setBacklinks(updated, ["new"])
		updated = togglePinned(updated)

		expect(parseFrontmatter(updated).frontmatter).toEqual({
			autotags: "keep",
			tags: "old, new",
			mybacklinks: "keep",
			backlinks: "new",
			unpinned: true,
		})
	})

	it("updates the last duplicate field read by the parser", () => {
		let content = `---
syntax-theme: github
syntax-theme: vitesse
---
Content`
		let updated = setSyntaxTheme(content, "catppuccin")

		expect(parseFrontmatter(updated).frontmatter?.["syntax-theme"]).toBe(
			"catppuccin",
		)
		expect(updated.match(/^syntax-theme:/gm)).toHaveLength(1)
		expect(setSyntaxTheme(content, null)).not.toContain("syntax-theme:")
	})

	it("preserves a missing newline after the closing delimiter", () => {
		let content = "---\nsyntax-theme: github\n---"

		expect(setSyntaxTheme(content, "vitesse")).toBe(
			"---\nsyntax-theme: vitesse\n---",
		)
	})

	it("round-trips a sole syntax theme without adding whitespace", () => {
		let content = "# Title\n"
		let themed = setSyntaxTheme(content, "github")

		expect(setSyntaxTheme(themed, null)).toBe(content)
	})

	it("adds a field to empty frontmatter without a blank YAML line", () => {
		let content = "---\n---\nBody"

		expect(setSyntaxTheme(content, "github")).toBe(
			"---\nsyntax-theme: github\n---\nBody",
		)
	})

	it("requires exact frontmatter delimiters", () => {
		let content = "--- \ntitle: Visible text\n---\nBody"

		expect(parseFrontmatter(content).frontmatter).toBeNull()
	})

	it("preserves uniform root indentation", () => {
		let content = "---\n title: Doc\n syntax-theme: github\n---\nBody"
		let updated = setSyntaxTheme(content, "vitesse")

		expect(updated).toBe("---\n title: Doc\n syntax-theme: vitesse\n---\nBody")
	})

	it("requires the closing delimiter on its own line", () => {
		let content = `---
title: Foo --- Bar
theme: OldTheme
---
Body`
		let updated = setTheme(content, "NewTheme")

		expect(parseFrontmatter(updated).frontmatter).toEqual({
			title: "Foo --- Bar",
			theme: "NewTheme",
		})
		expect(updated).toContain("\nBody")
	})

	it("does not reinterpret thematic breaks as frontmatter", () => {
		let content = "---\nJust a rule\n---\nText"
		let updated = setSyntaxTheme(content, "github")

		expect(updated).toBe(
			"---\nsyntax-theme: github\n---\n\n---\nJust a rule\n---\nText",
		)
	})

	it("does not edit keys or delimiters inside YAML block scalars", () => {
		let content = `---
syntax-theme: github
notes: |
  syntax-theme: prose
  ---
---
Body`
		let updated = setSyntaxTheme(content, "vitesse")

		expect(updated).toContain("  syntax-theme: prose\n  ---")
		expect(parseFrontmatter(updated).frontmatter?.["syntax-theme"]).toBe(
			"vitesse",
		)
	})
})
