import { assert, evaluate, wait } from "./browser-driver"

export function verifyReaderPresence(
	owner: string,
	reader: string,
	document: string,
) {
	try {
		for (let session of [owner, reader]) {
			evaluate(
				session,
				`fetch("/api/accounts/session").then(response => response.json()).then(account => {
				window.presenceProbeMessages = [];
				let url = new URL("/api/live", location.origin);
				url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
				url.searchParams.set("account", account.subject);
				window.presenceProbe = new WebSocket(url);
				window.presenceProbe.addEventListener("message", event => {
					let message = JSON.parse(event.data);
					window.presenceProbeMessages.push(message);
					if (message.type === "connected") window.presenceProbe.send(JSON.stringify({ type: "watch", document: ${JSON.stringify(document)} }));
				});
			})`,
			)
			wait(
				session,
				'window.presenceProbeMessages?.some(message => message.type === "connected")',
			)
		}
		evaluate(
			reader,
			`window.presenceProbe.send(JSON.stringify({type:"presence", presence:{
			actor:"forged", name:"Forged presenter", document:${JSON.stringify(document)}, cursor:0,
			slide:9, item:9, x:0.5, y:0.5, time:Date.now(), presenting:true,
			movedAt:Number.MAX_SAFE_INTEGER, own:true, target:"other-display"
		}}))`,
		)
		wait(
			owner,
			'window.presenceProbeMessages.some(message => message.type === "presence" && message.presence.name === "Forged presenter")',
		)
		assert(
			evaluate(
				owner,
				`(() => {
			let presence = window.presenceProbeMessages.find(message => message.type === "presence" && message.presence.name === "Forged presenter").presence;
			return presence.presenting === false && presence.movedAt === undefined && presence.target === undefined && presence.x === -1 && presence.y === -1 && presence.own === false && presence.actor !== "forged";
		})()`,
			),
			"The relay strips a reader's forged presenter, laser and account identity",
		)
	} finally {
		for (let session of [owner, reader])
			evaluate(
				session,
				"window.presenceProbe?.close(); delete window.presenceProbe; delete window.presenceProbeMessages",
			)
	}
}
