import type { Page } from "@playwright/test"
import type { Database } from "@/app/features/documents/lib/library"

export { setOffline }

async function setOffline(page: Page, offline: boolean) {
	if (!offline) await page.context().setOffline(false)
	await page.evaluate(async disconnected => {
		type Fiber = {
			return?: Fiber | null
			memoizedProps?: { value?: { db?: Database } }
		}
		let editor = document.querySelector(
			'[data-testid="doc-editor"], [data-testid="sidebar-sync-status"]',
		)
		if (!editor) throw new Error("Document editor missing")
		let key = Object.keys(editor).find(name => name.startsWith("__reactFiber$"))
		if (!key) throw new Error("React editor root missing")
		let fiber: Fiber | undefined | null = Reflect.get(editor, key)
		while (fiber) {
			let db = fiber.memoizedProps?.value?.db
			if (db && typeof db.disconnect === "function") {
				// Chromium context emulation leaves the SharedWorker's existing link alive.
				if (disconnected) await db.disconnect()
				else await db.reconnect()
				return
			}
			fiber = fiber.return
		}
		throw new Error("Jazz library provider missing")
	}, offline)
	if (offline) await page.context().setOffline(true)
}
