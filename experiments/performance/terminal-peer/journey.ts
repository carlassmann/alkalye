import { string } from "../../../src/shared/model"
import {
	assert,
	browser,
	currentDocument,
	evaluate,
	wait,
} from "../../../tests/browser-driver"

let server = Bun.spawn(
	[
		"bun",
		Bun.env.PEER_SERVER ??
			new URL("../../../tests/browser-document-app.ts", import.meta.url)
				.pathname,
		"--serve",
	],
	{
		stdout: "pipe",
		stderr: "inherit",
	},
)
let rows: unknown[] = []
let phase = Bun.env.PEER_PHASE ?? "unknown"
let output = Bun.env.PEER_OUTPUT
if (!output) throw Error("Missing output")
let owner = "terminal-owner-" + Date.now()
let guest = "terminal-peer-" + Date.now()
try {
	let serverOutput = await server.stdout.getReader().read()
	if (!serverOutput.value) throw new Error("Missing native app URL")
	let origin = new URL(new TextDecoder().decode(serverOutput.value).trim())
		.origin
	let url = new URL("/app", origin).href
	for (let profile of [
		{ session: owner, name: "Socket owner" },
		{ session: guest, name: "Polling guest" },
	]) {
		let { session, name } = profile
		browser(session, "open", url)
		wait(session, 'document.querySelector("[data-document-app]") !== null')
		wait(
			session,
			'fetch("/api/accounts/session").then(response => response.ok)',
		)
		evaluate(
			session,
			`fetch("/api/accounts/preferences", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({request:"live-profile-name",patch:{name:${JSON.stringify(name)}}})}).then(response => response.ok)`,
		)
	}
	browser(owner, "click", '[data-action="new"]')
	wait(
		owner,
		'document.querySelector("#editor") && !document.querySelector("#editor").readOnly',
	)
	let document = string(evaluate(owner, currentDocument))
	browser(owner, "fill", "#editor", "# Collaboration\n\nReady.")
	wait(owner, 'document.querySelector("#save-status").textContent === "Saved"')
	browser(owner, "click", '[data-action="tools"]')
	browser(owner, "click", '[data-action="share"]')
	wait(owner, 'document.querySelector("#dialog alkalye-invitations") !== null')
	browser(owner, "click", '[data-invite-role="writer"]')
	wait(
		owner,
		'document.querySelector(".invitation-link input")?.value.includes("/invite#/doc/")',
	)
	let link = string(
		evaluate(owner, 'document.querySelector(".invitation-link input").value'),
	)
	evaluate(owner, 'document.querySelector("#dialog").close()')
	browser(guest, "open", link)
	wait(guest, 'document.querySelector("[data-invitation-accept]") !== null')
	browser(guest, "click", "[data-invitation-accept]")
	wait(
		guest,
		`${currentDocument} === ${JSON.stringify(document)} && document.querySelector("#editor")?.value.includes("Ready.") && !document.querySelector("#editor").readOnly`,
	)
	let canonical = 'document.querySelector("alkalye-editor")?.source.value'
	let editable =
		'document.querySelector("#editor") && !document.querySelector("#editor").readOnly'
	function saved(session: string, source: string) {
		wait(
			session,
			`${canonical} === ${JSON.stringify(source)} && ${editable} && document.querySelector("#save-status")?.dataset.pending === "0" && document.querySelector("#save-status")?.getAttribute("aria-busy") === "false"`,
		)
	}
	function terminal(session: string) {
		evaluate(
			session,
			'(() => { let source = document.querySelector("alkalye-editor").source; source.setSelectionRange(source.value.length, source.value.length); source.focus() })()',
		)
	}
	for (let header of [
		"",
		"---\ntitle: Shared notes\ntags: [performance]\n---\n",
	]) {
		let initial = header + "Paragraph text.\n".repeat(8192)
		evaluate(
			owner,
			`(() => {let source = document.querySelector("alkalye-editor").source; source.value = ${JSON.stringify(initial)}; source.dispatchEvent(new Event("input"))})()`,
		)
		saved(owner, initial)
		saved(guest, initial)
		let current = initial
		for (let index = 0; index < Number(Bun.env.PEER_TRIALS ?? "3"); index++) {
			for (let action of ["append", "remove"]) {
				let next = action === "append" ? current + "X" : current.slice(0, -1)
				let label =
					phase +
					"-" +
					(header ? "header" : "plain") +
					"-" +
					index +
					"-" +
					action
				evaluate(
					guest,
					`(async () => {
					let databaseName=(await indexedDB.databases()).find(item=>item.name.endsWith(','+JSON.stringify(${JSON.stringify(document)})+']'))?.name;
					if(!databaseName) throw Error("Missing receiver journal");
					let floor=await new Promise((resolve,reject)=>{let open=indexedDB.open(databaseName);open.onerror=()=>reject(open.error);open.onsuccess=()=>{let db=open.result;let transaction=db.transaction("positions");let cursor=transaction.objectStore("positions").openKeyCursor(null,"prev");cursor.onsuccess=()=>resolve(cursor.result?.key??-1);cursor.onerror=()=>reject(cursor.error);transaction.oncomplete=()=>db.close();transaction.onabort=()=>{db.close();reject(transaction.error)}}});
					window.peerResult = {floor,start:performance.timeOrigin+performance.now(), received:0, paint:0, accepted:0};
					let put = IDBObjectStore.prototype.put;
					window.peerOriginalPut = put;
					IDBObjectStore.prototype.put = function(value,key) {
						let request = put.call(this,value,key);
						if(this.name === "cache" && key === "projection" && this.transaction.db.name.endsWith(','+JSON.stringify(${JSON.stringify(document)})+']')) {
						let database = this.transaction.db;
						this.transaction.addEventListener('complete',()=> {
							let cursor=database.transaction('positions').objectStore('positions').openKeyCursor(null,'prev');
							cursor.onsuccess=()=> {if(cursor.result?.key===value.position && value.position>window.peerResult.floor && value.value.pending.length===0 && (value.value.rejected?.length??0)===0 && ${canonical}===${JSON.stringify(next)}) {window.peerResult.position=value.position;window.peerResult.accepted=performance.timeOrigin+performance.now();performance.mark('peer:accepted')}};
						});
					}
					return request;
					};
					requestAnimationFrame(function check() {
						if(${canonical}===${JSON.stringify(next)}) {
							window.peerResult.received=performance.timeOrigin+performance.now();performance.mark('peer:source');
							requestAnimationFrame(()=>requestAnimationFrame(()=>{window.peerResult.paint=performance.timeOrigin+performance.now();performance.mark('peer:paint-opportunity')}));return;
						}
						requestAnimationFrame(check);
					});
					return true;
				})()`,
				)
				terminal(owner)
				evaluate(
					owner,
					'window.peerStart=0;window.peerTrusted=false;document.querySelector("#editor").addEventListener("beforeinput",event=>{window.peerStart=performance.timeOrigin+performance.now();window.peerTrusted=event.isTrusted},{once:true})',
				)
				browser(
					guest,
					"profiler",
					"start",
					"--categories",
					"devtools.timeline,disabled-by-default-devtools.timeline,toplevel,blink.user_timing,v8",
				)
				try {
					if (action === "append") browser(owner, "keyboard", "inserttext", "X")
					else browser(owner, "press", "Backspace")
					saved(owner, next)
					saved(guest, next)
					wait(
						guest,
						"window.peerResult.paint>0 && window.peerResult.accepted>0",
					)
				} finally {
					browser(
						guest,
						"profiler",
						"stop",
						output + "-" + label + ".trace.json",
					)
				}
				rows.push({
					phase,
					header: !!header,
					trial: index,
					action,
					owner: evaluate(
						owner,
						"({start:window.peerStart,trusted:window.peerTrusted})",
					),
					peer: evaluate(
						guest,
						'({...window.peerResult,heap:performance.memory?.usedJSHeapSize,scripts:performance.getEntriesByType("resource").filter(entry=>entry.name.includes(".js")).map(entry=>entry.name),exact:' +
							canonical +
							"===" +
							JSON.stringify(next) +
							"})",
					),
				})
				evaluate(
					guest,
					"IDBObjectStore.prototype.put=window.peerOriginalPut;true",
				)
				current = next
			}
		}
		browser(guest, "reload")
		saved(guest, initial)
		assert(
			true,
			"peer reload retains exact durable source and writer permission",
		)
	}
} finally {
	await Bun.write(output, JSON.stringify({ phase, rows }, null, 2))
	try {
		for (let session of [owner, guest]) {
			try {
				browser(session, "close")
			} catch {}
		}
	} finally {
		server.kill("SIGTERM")
		await server.exited
	}
}
