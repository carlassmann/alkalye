import {
	assert,
	browser,
	evaluate,
	wait,
	currentDocument,
} from "./browser-driver"
import { string } from "../src/shared/model"

export function verifyNativeComments(session: string) {
	browser(session, "click", '[data-action="comments"]')
	evaluate(
		session,
		'{let editor=document.querySelector("#editor");let start=editor.value.indexOf("document event stream");editor.setSelectionRange(start,start+"document event stream".length)}',
	)
	evaluate(
		session,
		'document.querySelector("#editor").dispatchEvent(new CompositionEvent("compositionstart", {bubbles:true}))',
	)
	browser(session, "click", '[data-action="comment"]')
	wait(
		session,
		'document.querySelector("#toast")?.textContent.includes("Finish editing")',
	)
	assert(
		evaluate(session, 'document.querySelector("#dialog").open === false'),
		"native comment capture refuses unstable composition input",
	)
	evaluate(
		session,
		'document.querySelector("#editor").dispatchEvent(new CompositionEvent("compositionend", {bubbles:true})); document.querySelector("#editor").focus()',
	)
	browser(session, "press", "Alt+Meta+m")
	wait(session, 'document.querySelector("#dialog").open')
	assert(
		evaluate(
			session,
			'document.querySelector("#dialog blockquote")?.textContent',
		) === "document event stream",
		"native discussion captures the editor selection before its dialog opens",
	)
	browser(
		session,
		"fill",
		'#dialog textarea[name="body"]',
		"Keep this discussion offline",
	)
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		'document.querySelector("#dialog").open === false && document.querySelector("[data-comments]")?.textContent.includes("Keep this discussion offline")',
	)
	let id = string(
		evaluate(
			session,
			'document.querySelector("[data-comment]").dataset.comment',
		),
	)
	assert(
		evaluate(session, 'document.querySelector(".comment-highlight") !== null'),
		"native unresolved comments highlight their anchored source characters",
	)
	browser(session, "click", `[data-action="jump-comment:${id}"]`)
	assert(
		evaluate(
			session,
			'{let editor=document.querySelector("#editor");editor.value.slice(editor.selectionStart,editor.selectionEnd)}',
		) === "document event stream",
		"native comment navigation selects its anchored source rather than searching for a quote",
	)
	browser(session, "click", `[data-action="reply:${id}"]`)
	browser(
		session,
		"fill",
		'#dialog textarea[name="body"]',
		"Initial failed reply",
	)
	evaluate(
		session,
		'window.originalDiscussionAdd = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function(...args) { if (this.name === "entries") throw new DOMException("Discussion quota exceeded", "QuotaExceededError"); return Reflect.apply(window.originalDiscussionAdd, this, args) }',
	)
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		'document.querySelector("#toast")?.textContent.includes("Discussion quota exceeded") && !document.querySelector("#submit-dialog").disabled',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#dialog").open && document.querySelector("#dialog textarea").value === "Initial failed reply"',
		),
		"a failed comment append keeps its dialog and editable draft available for retry",
	)
	browser(
		session,
		"fill",
		'#dialog textarea[name="body"]',
		'<img src="x" onerror="window.replyExecuted=true"> Corrected reply',
	)
	evaluate(
		session,
		"IDBObjectStore.prototype.add = window.originalDiscussionAdd; delete window.originalDiscussionAdd",
	)
	browser(session, "click", "#submit-dialog")
	wait(
		session,
		'document.querySelector("#dialog").open === false && document.querySelector("[data-comments]")?.textContent.includes("Corrected reply")',
	)
	assert(
		evaluate(
			session,
			'document.querySelectorAll("[data-comment] p").length === 2 && !document.querySelector("[data-comments] img") && window.replyExecuted !== true',
		),
		"changed reply retries retain one reply identity and render hostile text safely",
	)
	browser(session, "click", `[data-action="resolve:${id}"]`)
	wait(
		session,
		'document.querySelector("[data-comment]").classList.contains("resolved")',
	)
	assert(
		evaluate(session, 'document.querySelector(".comment-highlight") === null'),
		"resolving a native thread removes its source highlight",
	)
	browser(session, "click", `[data-action="reopen:${id}"]`)
	wait(
		session,
		'document.querySelector("[data-comment]").classList.contains("resolved") === false',
	)
	assert(
		evaluate(session, 'document.querySelector(".comment-highlight") !== null'),
		"reopening restores the native comment highlight",
	)
	evaluate(
		session,
		'fetch("/api/accounts/session").then(response => response.json()).then(account => { window.discussionHeld = false; let held = new Promise(resolve => { window.releaseDiscussion = resolve }); navigator.locks.request("alkalye-document-v1:" + JSON.stringify([account.subject, ' +
			currentDocument +
			"]), () => { window.discussionHeld = true; return held }); return true })",
	)
	wait(session, "window.discussionHeld === true")
	browser(session, "click", `[data-action="reply:${id}"]`)
	browser(
		session,
		"fill",
		'#dialog textarea[name="body"]',
		"Cancel before saving",
	)
	evaluate(session, 'document.querySelector("#toast").textContent = ""')
	browser(session, "click", "#submit-dialog")
	wait(session, 'document.querySelector("#submit-dialog").disabled === true')
	browser(session, "press", "Escape")
	wait(session, 'document.querySelector("#dialog").open === false')
	evaluate(session, "window.releaseDiscussion()")
	wait(
		session,
		'document.querySelector("#save-status")?.textContent === "Saved"',
	)
	assert(
		evaluate(
			session,
			'document.querySelectorAll("[data-comment] p").length === 2 && !document.querySelector("[data-comments]").textContent.includes("Cancel before saving")',
		),
		"closing a pending comment submission cancels its lock wait without saving a ghost reply",
	)
	assert(
		evaluate(session, 'document.querySelector("#toast").textContent === ""'),
		"cancelling a pending native comment produces no stale failure toast",
	)
	browser(session, "click", `[data-action="reply:${id}"]`)
	browser(session, "click", '#dialog button[value="cancel"]')
	assert(
		evaluate(session, 'document.querySelector("#dialog").open === false'),
		"an empty native comment form can be cancelled without browser validation blocking it",
	)
	browser(session, "click", '[data-action="tools"]')
	return id
}

export function verifyOfflineNativeComments(session: string, id: string) {
	browser(session, "click", '[data-action="comments"]')
	wait(
		session,
		`document.querySelector('[data-comment="${id}"]')?.textContent.includes("Corrected reply")`,
	)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-comments]")?.textContent.includes("Keep this discussion offline")',
		),
		"offline native reopening restores comments and replies from the document snapshot and journal",
	)
	browser(session, "click", '[data-action="tools"]')
}

export function verifyCommentDialogNavigation(
	session: string,
	id: string,
	first: string,
	second: string,
) {
	browser(session, "click", '[data-action="comments"]')
	browser(session, "click", `[data-action="reply:${id}"]`)
	browser(session, "fill", '#dialog textarea[name="body"]', "Leave this unsent")
	evaluate(
		session,
		`history.pushState(null, "", "/app/doc/" + ${JSON.stringify(second)}); dispatchEvent(new PopStateEvent("popstate"))`,
	)
	wait(
		session,
		'document.querySelector("#editor")?.value.startsWith("# Another document") && document.querySelector("#dialog").open === false',
	)
	assert(
		true,
		"document scope release closes its owned comment dialog without submitting the draft",
	)
	browser(session, "click", `[data-doc="${first}"]`)
	wait(
		session,
		'document.querySelector("[data-comments]")?.textContent.includes("Corrected reply")',
	)
	assert(
		evaluate(
			session,
			'document.querySelectorAll("[data-comment] p").length === 2 && !document.querySelector("[data-comments]").textContent.includes("Leave this unsent")',
		),
		"reopening the previous document preserves discussion and excludes its cancelled draft",
	)
	browser(session, "click", '[data-action="tools"]')
}
