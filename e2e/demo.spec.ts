import { expect, test } from "@playwright/test"

test("landing demo edits locally and restores comments, history, slides and the phone", async ({
	page,
}) => {
	await page.goto("/en/")
	let stage = page.locator("[data-demo-view]")
	await expect(stage).toHaveAttribute("data-demo-view", "editor", {
		timeout: 30_000,
	})
	await page
		.locator('[data-demo-scene="devices"]')
		.evaluate(element => element.scrollIntoView({ block: "center" }))
	let editor = stage.locator(".cm-content")
	await editor.click()
	await editor.press("ControlOrMeta+End")
	await page.keyboard.insertText(" Demo visitor text")
	await expect(editor).toContainText("Demo visitor text")
	await page
		.locator('[data-demo-scene="review"]')
		.evaluate(element => element.scrollIntoView({ block: "center" }))
	await expect(stage).toHaveAttribute("data-demo-view", "review")
	await expect(stage).toContainText("Demo visitor text")
	await expect(
		stage.getByRole("button", { name: "Collapse comment" }).first(),
	).toBeVisible()
	let phone = page.frameLocator('iframe[src="/demo/phone"]')
	await expect(phone.locator(".cm-content")).toContainText(
		"Demo visitor text",
		{ timeout: 30_000 },
	)
	await page
		.locator('[data-demo-scene="history"]')
		.evaluate(element => element.scrollIntoView({ block: "center" }))
	await expect(stage).toHaveAttribute("data-demo-view", "timemachine")
	await expect(stage.getByRole("slider")).toBeVisible()
	await page
		.locator('[data-demo-scene="present"]')
		.evaluate(element => element.scrollIntoView({ block: "center" }))
	await expect(stage).toHaveAttribute("data-demo-view", "present")
	await expect(stage).toContainText("Every device is just another cursor")
})
