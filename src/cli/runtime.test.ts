// @vitest-environment node
import { expect, test, vi } from "vitest"
import { executeCommand } from "./runtime"
import { resolveCliConfig } from "./config"

test.each(["offline", "local"])(
	"--%s explains missing Node persistence before auth or network",
	async flag => {
		let fetch = vi.spyOn(globalThis, "fetch")
		let config = await resolveCliConfig({
			home: "/tmp/alkalye-no-cli-credentials",
			server: "https://alkalye.test",
		})
		try {
			await expect(
				executeCommand("doc.list", { [flag]: true }, config),
			).rejects.toThrow("does not persist Node/Bun client replicas")
			expect(fetch).not.toHaveBeenCalled()
		} finally {
			fetch.mockRestore()
		}
	},
)
