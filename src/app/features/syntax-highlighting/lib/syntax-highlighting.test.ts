import { describe, expect, it } from "vitest"
import { resolveSyntaxTheme } from "./syntax-highlighting"

describe("syntax theme resolution", () => {
	it("uses document, global, and GitHub themes in precedence order", () => {
		expect(
			resolveSyntaxTheme({
				content: "---\nsyntax-theme: catppuccin\n---\n",
				defaultFamilyId: "github",
				appearance: "dark",
			}),
		).toBe("catppuccin-mocha")

		expect(
			resolveSyntaxTheme({
				content: "# Document",
				defaultFamilyId: "vitesse",
				appearance: "light",
			}),
		).toBe("vitesse-light")

		expect(
			resolveSyntaxTheme({
				content: "---\nsyntax-theme: removed-family\n---\n",
				defaultFamilyId: "github",
				appearance: "dark",
			}),
		).toBe("github-dark")

		expect(
			resolveSyntaxTheme({
				content: "# Document",
				appearance: "dark",
			}),
		).toBe("github-dark")
	})
})
