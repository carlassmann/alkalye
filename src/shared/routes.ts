// Every address the app answers, in one place. Paths follow the original
// application: /app/doc/:id, /app/spaces/:space/doc/:id, a trailing mode
// segment for preview, slideshow, teleprompter and time machine, and
// /app/settings, and /app/themes/:id/workbench or /source. Invitation
// secrets stay in the fragment so they never reach server logs.
export type DocumentMode =
	"edit" | "preview" | "slideshow" | "teleprompter" | "history"
export type SettingsCategory = "general" | "editor" | "connections" | "app"
export type AppRoute =
	| { readonly kind: "library"; readonly workspace?: string }
	| {
			readonly kind: "document"
			readonly document: string
			readonly workspace?: string
			readonly mode: DocumentMode
			readonly follow?: boolean
	  }
	| {
			readonly kind: "settings"
			readonly category: SettingsCategory
			readonly oauth?: string
			readonly from?: string
	  }
	| { readonly kind: "workspaceSettings"; readonly workspace: string }
	// A theme lives in the account's theme library or, attached to a
	// document, in that document; `document` names the latter.
	| {
			readonly kind: "themeWorkbench"
			readonly theme: string
			readonly document?: string
			// The theme source on its own, without the preview.
			readonly view?: "source"
	  }
	| { readonly kind: "invitation" }
	// The installed app's share target: text another app shared with it.
	| { readonly kind: "share"; readonly title: string; readonly text: string }
	| { readonly kind: "unknown" }

export let settingsCategories: readonly SettingsCategory[] = [
	"general",
	"editor",
	"connections",
	"app",
]
let modeSegments: Record<Exclude<DocumentMode, "edit">, string> = {
	preview: "preview",
	slideshow: "slideshow",
	teleprompter: "teleprompter",
	history: "timemachine",
}

export function parseRoute(url: URL): AppRoute {
	if (url.pathname === "/invite") return { kind: "invitation" }
	if (url.pathname !== "/app" && !url.pathname.startsWith("/app/"))
		return { kind: "unknown" }
	let segments = url.pathname.slice("/app".length).split("/").filter(Boolean)
	let parts: string[] = []
	for (let segment of segments) {
		let decoded = decode(segment)
		if (decoded === undefined) return { kind: "unknown" }
		parts.push(decoded)
	}
	if (parts[0] === "native") parts.shift()
	let [first, second, third, fourth, fifth, sixth] = parts
	if (!first) return legacyRoute(url) ?? { kind: "library" }
	if (first === "settings" && parts.length === 1) {
		let oauth = url.searchParams.get("oauth") ?? undefined
		let from = url.searchParams.get("from") ?? undefined
		return {
			kind: "settings",
			category: oauth
				? "connections"
				: category(url.searchParams.get("category")),
			...(oauth ? { oauth } : {}),
			...(from?.startsWith("/app") ? { from } : {}),
		}
	}
	if (first === "share" && parts.length === 1)
		return {
			kind: "share",
			title: url.searchParams.get("title") ?? "",
			text: [url.searchParams.get("text"), url.searchParams.get("url")]
				.filter(Boolean)
				.join("\n\n"),
		}
	if (
		first === "themes" &&
		identifier(second) &&
		(third === "workbench" || third === "source") &&
		parts.length === 3
	) {
		let document = url.searchParams.get("document") ?? ""
		return {
			kind: "themeWorkbench",
			theme: second,
			...(identifier(document) ? { document } : {}),
			...(third === "source" ? { view: "source" } : {}),
		}
	}
	if (first === "doc" && identifier(second) && parts.length <= 3)
		return documentRoute(second, undefined, third, url)
	if (first === "spaces" && identifier(second)) {
		if (parts.length === 2) return { kind: "library", workspace: second }
		if (third === "settings" && parts.length === 3)
			return { kind: "workspaceSettings", workspace: second }
		if (third === "doc" && identifier(fourth) && parts.length <= 5)
			return documentRoute(fourth, second, fifth ?? sixth, url)
	}
	return { kind: "unknown" }
}

export function routeHref(route: AppRoute): string {
	switch (route.kind) {
		case "library":
			return route.workspace ? "/app/spaces/" + encode(route.workspace) : "/app"
		case "document": {
			let base =
				(route.workspace ? "/app/spaces/" + encode(route.workspace) : "/app") +
				"/doc/" +
				encode(route.document)
			let mode = route.mode === "edit" ? "" : "/" + modeSegments[route.mode]
			return base + mode + (route.follow ? "?follow=1" : "")
		}
		case "settings": {
			let search = new URLSearchParams()
			if (route.category !== "general") search.set("category", route.category)
			if (route.oauth) search.set("oauth", route.oauth)
			if (route.from) search.set("from", route.from)
			let query = search.toString()
			return "/app/settings" + (query ? "?" + query : "")
		}
		case "workspaceSettings":
			return "/app/spaces/" + encode(route.workspace) + "/settings"
		case "themeWorkbench":
			return (
				"/app/themes/" +
				encode(route.theme) +
				(route.view === "source" ? "/source" : "/workbench") +
				(route.document ? "?document=" + encode(route.document) : "")
			)
		case "invitation":
			return "/invite"
		case "share": {
			let search = new URLSearchParams()
			if (route.title) search.set("title", route.title)
			if (route.text) search.set("text", route.text)
			let query = search.toString()
			return "/app/share" + (query ? "?" + query : "")
		}
		case "unknown":
			return "/app"
	}
}

// Earlier builds addressed documents as /app#<id>, with ?mode= and ?oauth=.
export function legacyRoute(url: URL): AppRoute | undefined {
	let oauth = url.searchParams.get("oauth")
	if (oauth) return { kind: "settings", category: "connections", oauth }
	let document = url.hash.slice(1)
	if (!identifier(document)) return undefined
	let mode = url.searchParams.get("mode")
	return {
		kind: "document",
		document,
		mode: mode === "slideshow" ? "slideshow" : "edit",
		...(url.searchParams.get("follow") === "1" ? { follow: true } : {}),
	}
}

export function sameRoute(left: AppRoute, right: AppRoute) {
	return routeHref(left) === routeHref(right)
}

function documentRoute(
	document: string,
	workspace: string | undefined,
	segment: string | undefined,
	url: URL,
): AppRoute {
	let mode = documentMode(segment)
	if (!mode) return { kind: "unknown" }
	return {
		kind: "document",
		document,
		mode,
		...(workspace ? { workspace } : {}),
		...(url.searchParams.get("follow") === "1" ? { follow: true } : {}),
	}
}
function documentMode(segment: string | undefined): DocumentMode | undefined {
	if (!segment) return "edit"
	if (segment === "preview") return "preview"
	if (segment === "slideshow") return "slideshow"
	if (segment === "teleprompter") return "teleprompter"
	if (segment === "timemachine") return "history"
	return undefined
}
function category(value: string | null): SettingsCategory {
	return value === "editor" || value === "connections" || value === "app"
		? value
		: "general"
}
function identifier(value: string | undefined): value is string {
	return typeof value === "string" && /^[\w:.-]{1,200}$/.test(value)
}
function decode(segment: string) {
	try {
		return decodeURIComponent(segment)
	} catch {
		return undefined
	}
}
function encode(value: string) {
	return encodeURIComponent(value)
}
