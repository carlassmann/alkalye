import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Schema from "effect/Schema"
import { assert, browser, browserBatch, evaluate, wait } from "./browser-driver"

let mailbox = await mkdtemp(join(tmpdir(), "alkalye-email-mailbox-"))
let server = Bun.spawn(["bun", "tests/browser-email-fixture.ts", mailbox], {
	stdin: "pipe",
	stdout: "pipe",
	stderr: "inherit",
})
let stdout = server.stdout.getReader()
let owner = "email-owner-" + Date.now()
let guest = "email-guest-" + Date.now()
let consumed = new Set<string>()
async function nextCode() {
	let files = await readdir(mailbox)
	let filename = files.find(
		file => file.endsWith(".json") && !consumed.has(file),
	)
	if (!filename) throw new Error("Email not delivered")
	consumed.add(filename)
	return Schema.decodeUnknownSync(Schema.Struct({ code: Schema.String }))(
		await Bun.file(join(mailbox, filename)).json(),
	).code
}
try {
	let output = await stdout.read()
	if (!output.value) throw new Error("Missing app address")
	let origin = new TextDecoder().decode(output.value).trim()
	browser(owner, "open", origin + "app")
	wait(owner, "Boolean(document.querySelector('[data-document-app]'))")
	browser(owner, "click", '[data-action="new"]')
	wait(owner, "Boolean(document.querySelector('#editor'))")
	evaluate(
		owner,
		`(()=>{let s=document.querySelector('alkalye-editor').source;s.value='# Email owner\\n\\nExisting identity and document.';s.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
	)
	wait(owner, "document.querySelector('#save-status').textContent==='Saved'")
	let documentPath = evaluate(owner, "location.pathname")
	browser(owner, "click", '[data-action="profile-menu"]')
	browser(owner, "click", '#profile-menu [data-action="email-sign-in"]')
	wait(
		owner,
		"document.querySelector('[data-account-email] input[name=email]')?.disabled===false",
	)
	assert(
		evaluate(owner, "location.pathname==='/app/settings'"),
		"Guest profile offers visible email sign-in settings",
	)
	browserBatch(owner, [
		["fill", "[data-account-email] input[name=email]", "owner@example.com"],
		["click", "[data-email-submit]"],
		[
			"wait",
			"--fn",
			"!document.querySelector('[data-email-verification]').hidden && !document.querySelector('[data-email-submit]').disabled",
		],
	])
	browser(
		owner,
		"fill",
		"[data-account-email] input[name=code]",
		await nextCode(),
	)
	browser(owner, "click", "[data-email-submit]")
	wait(
		owner,
		"document.querySelector('[data-email-current]').textContent==='Linked to owner@example.com'",
	)
	let subject = evaluate(owner, "document.querySelector('#account-id').value")
	browser(owner, "open", origin + String(documentPath).slice(1))
	wait(
		owner,
		"document.querySelector('alkalye-editor')?.source.value.includes('Existing identity')",
	)
	browser(guest, "open", origin + "app")
	wait(guest, "Boolean(document.querySelector('[data-document-app]'))")
	browser(guest, "click", '[data-action="new"]')
	wait(guest, "Boolean(document.querySelector('#editor'))")
	evaluate(
		guest,
		`(()=>{let s=document.querySelector('alkalye-editor').source;s.value='# Guest local draft';s.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
	)
	wait(guest, "document.querySelector('#save-status').textContent==='Saved'")
	let guestPath = evaluate(guest, "location.pathname")
	browser(guest, "click", '[data-action="profile-menu"]')
	browser(guest, "click", '#profile-menu [data-action="email-sign-in"]')
	wait(
		guest,
		"document.querySelector('[data-account-email] input[name=email]')?.disabled===false",
	)
	browser(guest, "click", '[data-email-mode="signIn"]')
	server.stdin.write("advance\n")
	let advanced = await stdout.read()
	assert(
		Boolean(
			advanced.value &&
			new TextDecoder().decode(advanced.value).includes("advanced"),
		),
		"Server test clock advances cooldown without sleeping",
	)
	browserBatch(guest, [
		["fill", "[data-account-email] input[name=email]", "owner@example.com"],
		["click", "[data-email-submit]"],
		[
			"wait",
			"--fn",
			"!document.querySelector('[data-email-verification]').hidden && !document.querySelector('[data-email-submit]').disabled",
		],
	])
	browser(
		guest,
		"fill",
		"[data-account-email] input[name=code]",
		await nextCode(),
	)
	browser(guest, "click", "[data-email-submit]")
	wait(
		guest,
		"Boolean(document.querySelector('[data-document-app]')) && location.pathname!=='/app/settings'",
	)
	browser(guest, "open", origin + String(documentPath).slice(1))
	wait(
		guest,
		"document.querySelector('alkalye-editor')?.source.value.includes('Existing identity')",
	)
	browser(guest, "open", origin + "app/settings")
	wait(
		guest,
		"document.querySelector('#account-id')?.value===" + JSON.stringify(subject),
	)
	assert(
		evaluate(
			guest,
			"document.querySelector('[data-email-current]').textContent==='Linked to owner@example.com'",
		),
		"OTP restores exact owner identity, permissions and document on a different browser profile",
	)
	let previousRecovery = evaluate(
		guest,
		`new Promise((resolve,reject)=>{let r=indexedDB.open('alkalye-native-v1');r.onerror=()=>reject(r.error);r.onsuccess=()=>{let db=r.result,tx=db.transaction('settings','readonly'),keys=tx.objectStore('settings').getAllKeys();keys.onsuccess=()=>{let key=keys.result.find(k=>typeof k==='string'&&k.startsWith('recovery-previous:'));if(!key){db.close();resolve(null);return}let value=tx.objectStore('settings').get(key);value.onsuccess=()=>{db.close();resolve(value.result)}}}})`,
	)
	assert(
		typeof previousRecovery === "string",
		"Email account switch preserves previous recovery",
	)
	browser(guest, "fill", 'input[name="recovery-key"]', String(previousRecovery))
	browser(guest, "click", '[data-preference-action="restore-account"]')
	wait(
		guest,
		"location.pathname!=='/app/settings' && Boolean(document.querySelector('[data-document-app]'))",
	)
	browser(guest, "open", origin + String(guestPath).slice(1))
	wait(
		guest,
		"document.querySelector('alkalye-editor')?.source.value.includes('Guest local draft')",
	)
	assert(
		true,
		"Previous guest draft remains readable after restoring its preserved account",
	)
	browser(guest, "open", origin + "app/settings")
	wait(
		guest,
		"document.querySelector('[data-account-email] input[name=email]')?.disabled===false",
	)
	browser(guest, "click", '[data-settings="sign-out"]')
	wait(
		guest,
		"document.querySelector('[data-email-mode=link]')?.disabled===true",
	)
	assert(
		true,
		"Signed-out device offers email sign-in and disables linking another account",
	)
	console.log("Email browser journey passed")
} finally {
	stdout.releaseLock()
	browser(owner, "close")
	browser(guest, "close")
	server.kill()
	await server.exited
	await rm(mailbox, { recursive: true, force: true })
}
