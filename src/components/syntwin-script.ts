export { loadSyntwin }

function loadSyntwin(
	page: Document,
	roomId: string,
	surface: "website" | "app",
) {
	let existing = page.getElementById("alkalye-syntwin")
	let script = existing ?? page.createElement("script")
	script.dataset.context =
		surface === "app"
			? "The visitor is inside Alkalye, an offline-capable Markdown writing and presentation app. Offer in-app help, possibly continuing a website conversation. Ask before opening or changing documents. Never request passphrases."
			: "The visitor is exploring Alkalye's public website. Explain its writing, collaboration and presentation workflows. Offer to continue in /app on this same origin when they want to try it."
	if (existing) return
	if (!(script instanceof HTMLScriptElement)) return
	script.id = "alkalye-syntwin"
	script.src = "https://my.syntwin.ai/omny.js"
	script.async = true
	script.dataset.room = roomId
	if (surface === "app") script.dataset.launcher = "none"
	page.body.append(script)
}
