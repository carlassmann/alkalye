import { assert, evaluate, wait } from "./browser-driver"

export function verifyReaderPresence(
	owner: string,
	reader: string,
	document: string,
) {
	let readerName = evaluate(
		reader,
		'fetch("/api/accounts/preferences").then(response => response.json()).then(profile => profile.name)',
	)
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
		let readerActor = evaluate(
			reader,
			'window.presenceProbeMessages.find(message => message.type === "connected").actor',
		)
		wait(
			owner,
			`window.presenceProbeMessages.some(message => message.type === "presence" && message.presence.actor === ${JSON.stringify(readerActor)})`,
		)
		assert(
			evaluate(
				owner,
				`(() => {
			let presence = window.presenceProbeMessages.find(message => message.type === "presence" && message.presence.actor === ${JSON.stringify(readerActor)}).presence;
			return presence.name === ${JSON.stringify(readerName)} && presence.presenting === false && presence.movedAt === undefined && presence.target === undefined && presence.x === -1 && presence.y === -1 && presence.own === false && presence.actor !== "forged";
		})()`,
			),
			"The relay supplies the saved name and strips forged presenter, laser and account identity",
		)
		evaluate(
			reader,
			'fetch("/api/accounts/preferences", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({request:"presence-profile-rename", patch:{name:"Renamed reader"}})}).then(response => response.ok)',
		)
		wait(
			owner,
			`window.presenceProbeMessages.some(message => message.type === "presence" && message.presence.actor === ${JSON.stringify(readerActor)} && message.presence.name === "Renamed reader")`,
		)
		assert(
			true,
			"renaming a profile updates existing cursor labels without reconnecting",
		)
	} finally {
		for (let session of [owner, reader])
			evaluate(
				session,
				"window.presenceProbe?.close(); delete window.presenceProbe; delete window.presenceProbeMessages",
			)
	}
}
