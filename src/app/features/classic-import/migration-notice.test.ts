import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { expect, test, vi } from "vitest"
import { ClassicMigration } from "./migration-notice"

let runClassicImport = vi.hoisted(() => vi.fn())
vi.mock("./client", () => ({ runClassicImport }))
vi.mock("./identity", () => ({ readClassicCredentials: () => null }))
vi.mock("./legacy-link", () => ({
	ClassicLegacyLink: ({ children }: { children: React.ReactNode }) => children,
}))
let exportDeviceKey = () => "key"
vi.mock("jazz-tools/react", () => ({
	useSession: () => ({ user: "account" }),
	useAll: () => ({ data: [] }),
	useJazzSession: () => ({ exportDeviceKey, user: { accountId: "account" } }),
}))

test("phrase-only recovery exposes failure, retains its trigger and can retry", async () => {
	sessionStorage.setItem("alkalye-classic-phrase-login", "true")
	runClassicImport.mockRejectedValue(new Error("Classic peer unavailable"))
	let element = document.createElement("div")
	document.body.append(element)
	let root = createRoot(element)
	try {
		await act(async () =>
			root.render(createElement(ClassicMigration, null, "Library")),
		)
		await vi.waitFor(() =>
			expect(element.textContent).toContain("Classic peer unavailable"),
		)
		expect(sessionStorage.getItem("alkalye-classic-phrase-login")).toBe("true")
		let retry = Array.from(element.querySelectorAll("button")).find(button =>
			button.textContent?.includes("Retry"),
		)
		expect(retry).toBeDefined()
		await act(async () => retry?.click())
		await vi.waitFor(() => expect(runClassicImport).toHaveBeenCalledTimes(2))
		runClassicImport.mockImplementation(async (_key, report) =>
			report({ completed: 1, total: 1, errors: [], done: true }),
		)
		let successRetry = Array.from(element.querySelectorAll("button")).find(
			button => button.textContent?.includes("Retry"),
		)
		await act(async () => successRetry?.click())
		await vi.waitFor(() =>
			expect(sessionStorage.getItem("alkalye-classic-phrase-login")).toBeNull(),
		)
	} finally {
		await act(async () => root.unmount())
		element.remove()
		sessionStorage.clear()
	}
})
