import { chromium } from "@playwright/test"
import process from "node:process"
import console from "node:console"
import { URL } from "node:url"
import { writeFile } from "node:fs/promises"
let browser = await chromium.connectOverCDP(process.env.CDP_URL)
let base = process.env.AUTH_URL
let results = []
let contexts = []
async function profile() {
	let context = await browser.newContext({
		ignoreHTTPSErrors: true,
		permissions: ["clipboard-read", "clipboard-write"],
	})
	contexts.push(context)
	await context.addInitScript(() => {
		globalThis.performance.mark("auth:navigation")
		new globalThis.MutationObserver(() => {
			if (
				globalThis.document.body?.dataset.alkalyeReady === "true" &&
				!globalThis.performance.getEntriesByName("auth:ui-ready").length
			)
				globalThis.performance.mark("auth:ui-ready")
		}).observe(globalThis.document, { subtree: true, attributes: true })
		let last
		globalThis.setInterval(() => {
			let state = globalThis.window.__jazz?.status?.()?.link?.state
			if (state !== last) {
				last = state
				globalThis.performance.mark("auth:observed-link:" + state)
			}
		}, 5)
	})
	let page = await context.newPage()
	let network = []
	let cdp = await context.newCDPSession(page)
	await cdp.send("Network.enable")
	let requests = new Map()
	cdp.on("Network.requestWillBeSent", e => {
		requests.set(e.requestId, {
			url: e.request.url,
			method: e.request.method,
			start: e.timestamp,
		})
	})
	cdp.on("Network.responseReceived", e => {
		let r = requests.get(e.requestId)
		if (r && r.url.includes("/jazz/"))
			network.push({
				...r,
				ms: (e.timestamp - r.start) * 1000,
				status: e.response.status,
				timing: e.response.timing,
			})
	})
	cdp.on("Network.webSocketCreated", e =>
		network.push({ url: e.url, ws: globalThis.performance.now() }),
	)
	page.on("console", m => {
		if (m.type() === "warning" || m.type() === "error")
			console.log(m.type(), m.text().slice(0, 250))
	})
	return { context, page, network }
}
async function ready(page) {
	await page
		.locator('body[data-alkalye-ready="true"]')
		.waitFor({ timeout: 60000 })
}
async function capture(p, flow, start = 0) {
	let data = await p.page.evaluate(() => ({
		marks: globalThis.performance
			.getEntriesByType("mark")
			.filter(m => m.name.startsWith("auth:"))
			.map(m => ({ name: m.name, ms: m.startTime })),
		now: globalThis.performance.now(),
		resources: globalThis.performance
			.getEntriesByType("resource")
			.filter(r => r.name.includes("/jazz/") || r.name.includes(".wasm"))
			.map(r => ({ url: r.name, start: r.startTime, ms: r.duration })),
	}))
	results.push({ flow, start, ...data, network: p.network.splice(0) })
	console.log(JSON.stringify(results.at(-1)))
	await writeFile(process.env.AUTH_OUTPUT, JSON.stringify(results, null, 2))
}
try {
	let p = await profile()
	await p.page.goto(base + "/app")
	await ready(p.page)
	await p.page.waitForFunction(
		() => globalThis.window.__jazz?.status().link.state === "connected",
		{},
		{ timeout: 60000 },
	)
	await capture(p, "first-visit")
	await p.page.goto(base + "/app/settings")
	await p.page.getByTestId("settings-sign-in").click()
	let start = await p.page.evaluate(() => globalThis.performance.now())
	await p.page.getByTestId("auth-initial-create-account").click()
	let phrase = await p.page.getByTestId("auth-create-passphrase").inputValue()
	await capture(p, "show-words", start)
	await p.page.getByTestId("auth-create-copy").click()
	start = await p.page.evaluate(() => globalThis.performance.now())
	await p.page.getByTestId("auth-create-submit").click()
	await p.page.getByTestId("auth-dialog").waitFor({ state: "hidden" })
	await capture(p, "sign-up-submit", start)
	await p.page.goto(base + "/app")
	await ready(p.page)
	await p.page.evaluate(() => globalThis.window.__jazz.waitForSync())
	let target = new URL(p.page.url()).pathname
	await p.page.waitForTimeout(200)
	await p.page.reload()
	await ready(p.page)
	await p.page.waitForFunction(
		() => globalThis.window.__jazz?.status().link.state === "connected",
		{},
		{ timeout: 60000 },
	)
	await capture(p, "reload")
	let q = await profile()
	await q.page.goto(base + "/app/settings")
	await q.page.getByTestId("settings-sign-in").click()
	await q.page.getByTestId("auth-initial-sign-in").click()
	await q.page.getByTestId("auth-login-passphrase").fill(phrase)
	start = await q.page.evaluate(() => {
		globalThis.performance.clearMarks()
		globalThis.performance.mark("auth:restore-click")
		return globalThis.performance.now()
	})
	await q.page.getByTestId("auth-login-submit").click()
	await q.page.waitForURL(base + target, { timeout: 60000 })
	await ready(q.page)
	await capture(q, "recovery-fresh", start)
} finally {
	for (let context of contexts) await context.close()
	await browser.close()
}
