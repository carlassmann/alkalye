import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, browser, evaluate, wait } from "./browser-driver"

let server = Bun.spawn(["bun", "tests/browser-document-app.ts", "--serve"], {
	stdout: "pipe",
	stderr: "inherit",
})
let session = "toasts-" + Date.now()
let screenshots = mkdtempSync(join(tmpdir(), "alkalye-toasts-"))
let toasts = 'document.querySelectorAll("#toast [data-sonner-toast]")'
let live =
	'document.querySelectorAll("#toast [data-sonner-toast][data-removed=false]")'
function show(text: string) {
	evaluate(
		session,
		`document.querySelector("#toast").show(${JSON.stringify(text)}); true`,
	)
}
function pause(milliseconds: number) {
	evaluate(
		session,
		`new Promise(resolve => setTimeout(() => resolve(true), ${milliseconds}))`,
	)
}
function settle() {
	wait(session, `${toasts}.length === 0`)
}
// A modal dialog makes everything outside it inert, so hit testing cannot see
// the toaster; the rendered pixels show whether it paints above the backdrop.
function paintedWhite() {
	let path = join(screenshots, `toast-${Date.now()}.png`)
	browser(session, "screenshot", path)
	let image = Buffer.from(readFileSync(path)).toString("base64")
	return evaluate(
		session,
		`(async () => {
			let box = ${front()}.getBoundingClientRect();
			let bitmap = await createImageBitmap(await (await fetch("data:image/png;base64,${image}")).blob());
			let scale = bitmap.width / innerWidth, canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext("2d");
			context.drawImage(bitmap, 0, 0);
			let [red, green, blue] = context.getImageData(Math.round((box.left + 4) * scale), Math.round((box.top + box.height / 2) * scale), 1, 1).data;
			return red === 255 && green === 255 && blue === 255;
		})()`,
	)
}
function front() {
	return `document.querySelector("#toast [data-sonner-toast][data-front=true]")`
}
try {
	let output = await server.stdout.getReader().read()
	if (!output.value) throw new Error("Missing app URL")
	let url = new URL("/app", new TextDecoder().decode(output.value).trim()).href
	browser(session, "set", "viewport", "1280", "800")
	browser(session, "set", "media", "dark")
	browser(session, "open", url)
	wait(session, "Boolean(document.querySelector('#editor'))")

	show("Saved notes.md")
	wait(session, `${front()}?.dataset.mounted === "true"`)
	assert(
		evaluate(
			session,
			`(() => {
				let host = document.querySelector("#toast"), item = ${front()}, style = getComputedStyle(item), box = item.getBoundingClientRect();
				return host.matches(":popover-open") && host.getAttribute("aria-live") === "polite" && host.getAttribute("aria-label").includes("alt+T") &&
					host.textContent === "Saved notes.md" && style.backgroundColor === "rgb(255, 255, 255)" && style.color === "rgb(23, 23, 23)" &&
					style.borderTopColor === "rgb(237, 237, 237)" && style.borderTopLeftRadius === "8px" && style.paddingTop === "16px" &&
					style.fontSize === "13px" && style.fontFamily.startsWith("ui-sans-serif") && style.boxShadow.includes("12px") &&
					style.transitionDuration.startsWith("0.4s") && box.width === 356 && Math.round(innerWidth - box.right) === 24 && Math.round(innerHeight - box.bottom) === 24;
			})()`,
		),
		"An unconfigured Sonner toast is light, 356px wide and sits 24px from the bottom-right even in a dark app",
	)
	assert(
		evaluate(
			session,
			`document.activeElement === document.body || document.activeElement?.closest("#toast") === null`,
		),
		"Showing a toast leaves focus where it was",
	)
	settle()
	assert(true, "A single toast dismisses itself after its lifetime")

	show("First")
	pause(3000)
	show("Second")
	wait(session, `${live}.length === 1 && ${live}[0].textContent === "Second"`)
	assert(
		evaluate(
			session,
			`document.querySelector("#toast").textContent.includes("Second")`,
		),
		"An older toast's timer expires on its own without hiding a newer toast",
	)
	settle()

	for (let index = 1; index <= 5; index++) show("Toast " + index)
	wait(session, `${toasts}.length === 5`)
	pause(450)
	assert(
		evaluate(
			session,
			`(() => {
				let items = [...${toasts}];
				let shown = items.filter(item => item.dataset.visible === "true");
				return items[0].textContent === "Toast 5" && items[0].dataset.front === "true" && shown.length === 3 &&
					items.every((item, index) => Number(getComputedStyle(item).zIndex) === 5 - index) &&
					getComputedStyle(items[1]).height === getComputedStyle(items[0]).height &&
					items[1].getBoundingClientRect().top < items[0].getBoundingClientRect().top;
			})()`,
		),
		"Repeated toasts stack three deep with the newest in front",
	)
	browser(session, "hover", "#toast [data-sonner-toast][data-front=true]")
	wait(
		session,
		`[...${toasts}].every(item => item.dataset.expanded === "true")`,
	)
	pause(4800)
	assert(
		evaluate(session, `${live}.length === 5`),
		"Hovering the stack expands it and pauses every timer",
	)
	browser(session, "mouse", "move", "10", "10")
	wait(
		session,
		`[...${toasts}].every(item => item.dataset.expanded === "false")`,
	)
	settle()
	assert(true, "Leaving the stack collapses it and resumes the timers")

	show("Hidden page")
	evaluate(
		session,
		`Object.defineProperty(document, "hidden", {configurable: true, get: () => true}); document.dispatchEvent(new Event("visibilitychange")); true`,
	)
	pause(4800)
	assert(
		evaluate(session, `${live}.length === 1`),
		"A hidden page pauses toasts",
	)
	evaluate(
		session,
		`delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); true`,
	)
	settle()

	evaluate(session, `document.querySelector("#editor").focus(); true`)
	show("Keyboard")
	show("Keyboard newer")
	assert(
		evaluate(session, `document.activeElement?.id === "editor"`),
		"New toasts never take focus from the editor",
	)
	browser(session, "press", "Alt+t")
	wait(
		session,
		`document.activeElement?.matches("#toast [data-sonner-toaster]")`,
	)
	pause(4800)
	assert(
		evaluate(
			session,
			`${live}.length === 2 && [...${toasts}].every(item => item.dataset.expanded === "true")`,
		),
		"Alt+T focuses the notifications, expands them and pauses their timers",
	)
	browser(session, "press", "Tab")
	assert(
		evaluate(
			session,
			`document.activeElement?.textContent === "Keyboard newer"`,
		),
		"Tab moves from the notification list into the newest toast",
	)
	browser(session, "press", "Escape")
	wait(
		session,
		`[...${toasts}].every(item => item.dataset.expanded === "false")`,
	)
	wait(session, `${toasts}.length === 0`)
	assert(
		evaluate(session, `document.activeElement?.id === "editor"`),
		"Escape collapses the stack, timers resume and focus returns to the editor",
	)

	show("Swipe me")
	wait(session, `${front()}?.dataset.mounted === "true"`)
	pause(450)
	let box = evaluate(
		session,
		`(() => { let box = ${front()}.getBoundingClientRect(); return [box.left + box.width / 2, box.top + box.height / 2] })()`,
	)
	if (!Array.isArray(box)) throw new Error("Missing toast bounds")
	let x = Math.round(Number(box[0]))
	let y = Math.round(Number(box[1]))
	browser(session, "mouse", "move", String(x), String(y))
	browser(session, "mouse", "down")
	browser(session, "mouse", "move", String(x - 20), String(y))
	browser(session, "mouse", "up")
	assert(
		evaluate(
			session,
			`${live}.length === 1 && ${front()}.dataset.swiped === "false"`,
		),
		"A short swipe against the dismiss direction springs back",
	)
	browser(session, "mouse", "move", String(x), String(y))
	browser(session, "mouse", "down")
	for (let step = 1; step <= 6; step++)
		browser(session, "mouse", "move", String(x + step * 15), String(y))
	browser(session, "mouse", "up")
	assert(
		evaluate(
			session,
			`(() => { let item = document.querySelector("#toast [data-sonner-toast]"); return item.dataset.swipeOut === "true" && item.dataset.swipeDirection === "right" && item.dataset.removed === "true" })()`,
		),
		"Swiping right past the threshold dismisses the toast",
	)
	settle()
	browser(session, "mouse", "move", "10", "10")

	evaluate(
		session,
		`(() => { let dialog = document.querySelector("#dialog"); dialog.textContent = "Dialog"; dialog.showModal(); return true })()`,
	)
	show("Upload failed")
	wait(session, `${front()}?.dataset.mounted === "true"`)
	pause(450)
	assert(
		paintedWhite(),
		"A toast shown during a modal dialog paints above its dimmed backdrop",
	)
	evaluate(session, `document.querySelector("#dialog").close(); true`)
	settle()
	show("Before dialog")
	evaluate(session, `document.querySelector("#dialog").showModal(); true`)
	pause(450)
	assert(
		paintedWhite(),
		"A modal dialog opened over a visible toast leaves the toast on top",
	)
	evaluate(session, `document.querySelector("#dialog").close(); true`)
	settle()

	show("Stale")
	evaluate(session, `document.querySelector("#toast").textContent = ""; true`)
	show("Fresh")
	assert(
		evaluate(
			session,
			`document.querySelector("#toast").textContent === "Fresh" && ${toasts}.length === 1`,
		),
		"Clearing the host's text discards stale toasts and later toasts still appear",
	)
	settle()

	browser(session, "set", "viewport", "390", "844")
	show("Narrow")
	wait(session, `${front()}?.dataset.mounted === "true"`)
	pause(450)
	assert(
		evaluate(
			session,
			`(() => { let box = ${front()}.getBoundingClientRect(); return Math.round(box.left) === 16 && Math.round(box.width) === 358 && Math.round(innerHeight - box.bottom) === 16 })()`,
		),
		"On narrow screens toasts span the width with 16px offsets",
	)
	settle()

	browser(session, "set", "media", "dark", "reduced-motion")
	show("Calm")
	assert(
		evaluate(
			session,
			`(() => { let item = ${front()}; return getComputedStyle(item).transitionDuration === "0s" && item.getAnimations().length === 0 && getComputedStyle(item).opacity === "1" })()`,
		),
		"Reduced motion shows toasts without transitions",
	)
	settle()

	evaluate(
		session,
		`(() => {
  let notice = document.createElement("alkalye-update");
  window.updateApplications = 0;
  notice.offer(() => {window.updateApplications++});
  window.dismissUpdateToast = document.querySelector("#toast").showContent(notice, true);
  return true;
 })()`,
	)
	wait(
		session,
		'Boolean(document.querySelector("#toast [data-sonner-toast] [data-update]"))',
	)
	assert(
		evaluate(
			session,
			`(() => {
  let notice=document.querySelector("[data-update]"), item=notice.closest("[data-sonner-toast]");
  return notice.querySelector("[data-title]").textContent === "Update available" && notice.textContent.includes("Reload to update to the latest version") && getComputedStyle(item).borderRadius === "8px" && getComputedStyle(notice).position === "static";
 })()`,
		),
		"Update notices use the original toast frame and copy instead of a floating banner",
	)
	pause(4500)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-update]").closest("[data-sonner-toast]").dataset.removed === "false" && window.updateApplications === 0',
		),
		"Updates persist without interrupting the open document",
	)
	browser(session, "click", "[data-update-apply]")
	assert(
		evaluate(
			session,
			'window.updateApplications === 1 && document.querySelector("[data-update-apply]").disabled',
		),
		"Reload remains clickable and applies an update only once",
	)
	evaluate(
		session,
		'document.querySelector("[data-update-description]").textContent = "Longer update details ".repeat(20);true',
	)
	wait(
		session,
		'parseFloat(document.querySelector("#toast ol").style.getPropertyValue("--front-toast-height")) > 100',
	)
	assert(
		true,
		"Persistent toast measurements follow content and wrapping changes",
	)
	evaluate(session, "window.dismissUpdateToast();true")
	settle()
	assert(
		evaluate(session, '!document.querySelector("[data-update]")'),
		"Dismissing a persistent update releases its toast",
	)
} finally {
	browser(session, "close")
	rmSync(screenshots, { recursive: true, force: true })
	server.kill()
	await server.exited
}
