import { assert, browser, evaluate, visit, wait } from "./browser-driver"

// Settings save each control as it changes, as in the original.
function change(session: string, selector: string, value: string) {
	browser(session, "fill", selector, value)
	evaluate(
		session,
		`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event("change", {bubbles: true}))`,
	)
}

export function verifyNativePreferences(session: string, url: string) {
	browser(session, "click", '.profile [data-action="settings"]')
	wait(
		session,
		'location.pathname === "/app/settings" && document.querySelector("[data-preferences-status]")?.textContent === "Synced"',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("[data-settings-page]").constructor === customElements.get("alkalye-settings") && [...document.querySelectorAll(".settings-nav a")].map(link => link.textContent.trim()).join() === "General,Editor,Connections,App & data"',
		),
		"settings is a routed page with the original's categories",
	)
	browser(session, "click", '[data-settings="edit-name"]')
	browser(
		session,
		"fill",
		'[data-name-form] input[name="name"]',
		"Settings writer",
	)
	browser(session, "press", "Enter")
	browser(
		session,
		"click",
		'alkalye-picker[name="appearance"] [role=option][data-value="light"]',
	)
	browser(session, "click", '.settings-nav a[href*="category=editor"]')
	wait(
		session,
		'document.querySelector("#settings-editor [name=fontSize]") !== null',
	)
	change(session, '[name="fontSize"]', "22")
	change(session, '[name="lineWidth"]', "80")
	browser(session, "click", '[name="smartPairs"]')
	wait(
		session,
		'document.documentElement.dataset.appearance === "light" && document.documentElement.style.getPropertyValue("--editor-size") === "22px" && document.querySelector(".profile-name").textContent.includes("Settings writer")',
	)
	wait(
		session,
		'fetch("/api/accounts/preferences").then(response => response.json()).then(value => value.name === "Settings writer" && value.editor.smartPairs === false && value.editor.lineWidth === 80)',
	)
	assert(true, "native preferences apply immediately and sync to the account")
	browser(session, "back")
	wait(session, 'document.querySelector("#settings-general") !== null')
	browser(session, "click", ".settings-back")
	wait(session, '!document.querySelector("[data-settings-page]")')
	assert(true, "settings categories and Back follow browser history")
	evaluate(
		session,
		'localStorage.setItem("native-preferences-offline", "true")',
	)
	browser(session, "open", url)
	wait(
		session,
		'document.querySelector("#editor") && document.documentElement.style.getPropertyValue("--editor-size") === "22px"',
	)
	visit(session, "/app/settings?category=editor")
	wait(
		session,
		'document.querySelector("#settings-editor [name=fontSize]") !== null',
	)
	change(session, '[name="fontSize"]', "24")
	wait(
		session,
		'document.documentElement.style.getPropertyValue("--editor-size") === "24px"',
	)
	browser(session, "open", url)
	wait(
		session,
		'document.querySelector("#editor") && document.documentElement.style.getPropertyValue("--editor-size") === "24px"',
	)
	assert(true, "offline preference changes survive a full reload")
	assert(
		evaluate(
			session,
			'fetch("/api/accounts/preferences", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({request:crypto.randomUUID(),patch:{editor:{lineWidth:95}}})}).then(response => response.ok)',
		),
		"another device can update a separate preference field",
	)
	evaluate(
		session,
		'localStorage.removeItem("native-preferences-offline"); delete navigator.onLine; window.dispatchEvent(new Event("online"))',
	)
	wait(
		session,
		'fetch("/api/accounts/preferences").then(response => response.json()).then(value => value.fontSize === 24 && value.editor.lineWidth === 95 && value.editor.smartPairs === false)',
	)
	wait(
		session,
		'document.documentElement.style.getPropertyValue("--editor-width") === "95ch"',
	)
	assert(
		true,
		"reconnecting merges the offline patch without overwriting another device’s preferences",
	)
	visit(session, "/app/settings?category=editor")
	wait(
		session,
		'document.querySelector("[data-preference-action=reset]") !== null',
	)
	browser(session, "click", '[data-preference-action="reset"]')
	wait(
		session,
		'document.documentElement.style.getPropertyValue("--editor-size") === "18px" && document.querySelector("[name=fontSize]").value === "18"',
	)
	assert(
		evaluate(
			session,
			'document.querySelector(".profile-name").textContent.includes("Settings writer") && document.documentElement.dataset.appearance === "light"',
		),
		"resetting writing preferences preserves account name and appearance",
	)
	evaluate(
		session,
		'{let input = document.querySelector("[name=fontSize]"); input.value = "20"; input.dispatchEvent(new Event("change", {bubbles: true})); document.querySelector(".settings-back").click()}',
	)
	wait(
		session,
		'!document.querySelector("[data-settings-page]") && document.documentElement.style.getPropertyValue("--editor-size") === "20px"',
	)
	wait(
		session,
		'fetch("/api/accounts/preferences").then(response => response.json()).then(value => value.fontSize === 20)',
	)
	assert(
		true,
		"leaving settings during a save still completes the durable write and sync",
	)
	assert(
		evaluate(
			session,
			`(async () => {
		let request = crypto.randomUUID();
		let response = await fetch("/api/accounts/preferences", {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({request, patch:{name:"Recovery writer"}})});
		if (!response.ok) return false;
		await new Promise((resolve, reject) => {
			let opening = indexedDB.open("alkalye-native-v1"); opening.onerror = () => reject(opening.error);
			opening.onsuccess = () => {
				let db = opening.result, keys = db.transaction("settings").objectStore("settings").getAllKeys();
				keys.onsuccess = () => {
					let key = keys.result.find(key => typeof key === "string" && key.startsWith("account-preferences:"));
					if (!key) {db.close(); reject(new Error("Missing preferences")); return}
					let tx = db.transaction("settings", "readwrite"), store = tx.objectStore("settings"), current = store.get(key);
					current.onsuccess = () => store.put({...current.result, pending:[...current.result.pending, {request:"future-version",patch:{language:"fr",editor:{futureSetting:true}}}, {request:"damaged",patch:{fontSize:99}}, {request,patch:{name:"Conflicting retry"}}, {request:crypto.randomUUID(),patch:{fontSize:21}}]}, key);
					tx.oncomplete = () => {db.close(); resolve()}; tx.onerror = () => {db.close(); reject(tx.error)};
				};
			};
		});
		return true;
	})()`,
		),
		"recovery fixture preserves malformed and conflicting preference intents beside a valid change",
	)
	browser(session, "open", url)
	wait(
		session,
		'document.querySelector("#editor") && document.documentElement.style.getPropertyValue("--editor-size") === "21px" && document.querySelector(".profile-name").textContent.includes("Recovery writer")',
	)
	wait(
		session,
		'fetch("/api/accounts/preferences").then(response => response.json()).then(value => value.fontSize === 21 && value.name === "Recovery writer")',
	)
	browser(session, "click", '.profile [data-action="settings"]')
	wait(
		session,
		'document.querySelector("[data-preferences-status]").textContent.includes("3 unsynced changes preserved") && !document.querySelector("[data-preference-action=recovery]").hidden',
	)
	browser(session, "click", '.settings-nav a[href*="category=editor"]')
	wait(
		session,
		'document.querySelector("#settings-editor [name=fontSize]") !== null',
	)
	change(session, '[name="fontSize"]', "23")
	wait(
		session,
		'fetch("/api/accounts/preferences").then(response => response.json()).then(value => value.fontSize === 23)',
	)
	assert(
		true,
		"malformed and permanently rejected changes remain recoverable while later valid preferences sync",
	)
	assert(
		evaluate(
			session,
			`(async () => {
		let db = await new Promise((resolve, reject) => {let opening = indexedDB.open("alkalye-native-v1"); opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error)});
		try {
			let key = await new Promise(resolve => {let request = db.transaction("settings").objectStore("settings").getAllKeys(); request.onsuccess = () => resolve(request.result.find(key => typeof key === "string" && key.startsWith("account-preferences:")))});
			let saved = await new Promise(resolve => {let request = db.transaction("settings").objectStore("settings").get(key); request.onsuccess = () => resolve(request.result)});
			return saved.pending.some(intent => intent.request === "future-version" && intent.patch.language === "fr" && intent.patch.editor.futureSetting === true) && saved.pending.some(intent => intent.request === "damaged") && saved.rejected.length === 1;
		} finally {db.close()}
	})()`,
		),
		"settings refresh, acknowledgment and later saves leave newer-version intents in the durable queue",
	)
	browser(session, "click", ".settings-back")
	wait(
		session,
		'!document.querySelector("[data-settings-page]") && document.querySelector("#editor") !== null',
	)
}
