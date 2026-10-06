import { expect, test } from "bun:test"
import { parseRoute, routeHref } from "../src/shared/routes"
import type { AppRoute } from "../src/shared/routes"

let origin = "https://alkalye.test"
function route(path: string) {
	return parseRoute(new URL(path, origin))
}

test("document, workspace, mode and settings paths round-trip", () => {
	let routes: AppRoute[] = [
		{ kind: "library" },
		{ kind: "library", workspace: "team" },
		{ kind: "library", workspace: "local:4f1c" },
		{ kind: "document", document: "doc-1", mode: "edit" },
		{ kind: "document", document: "doc-1", mode: "preview" },
		{ kind: "document", document: "doc-1", mode: "history" },
		{
			kind: "document",
			document: "doc-1",
			workspace: "team",
			mode: "slideshow",
			follow: true,
		},
		{
			kind: "document",
			document: "doc-1",
			workspace: "team",
			mode: "teleprompter",
		},
		{ kind: "settings", category: "general" },
		{ kind: "settings", category: "connections", oauth: "request-1" },
		{ kind: "settings", category: "editor", from: "/app/doc/doc-1" },
		{ kind: "workspaceSettings", workspace: "team" },
	]
	for (let value of routes) expect(route(routeHref(value))).toEqual(value)
	expect(routeHref(routes[5] ?? { kind: "unknown" })).toBe(
		"/app/doc/doc-1/timemachine",
	)
	expect(routeHref(routes[2] ?? { kind: "unknown" })).toBe(
		"/app/spaces/local%3A4f1c",
	)
})

test("the original application's paths and the earlier fragment links still open", () => {
	expect(route("/app/doc/doc-1/slideshow")).toEqual({
		kind: "document",
		document: "doc-1",
		mode: "slideshow",
	})
	expect(route("/app/spaces/team/doc/doc-1")).toEqual({
		kind: "document",
		document: "doc-1",
		workspace: "team",
		mode: "edit",
	})
	expect(route("/app#doc-2")).toEqual({
		kind: "document",
		document: "doc-2",
		mode: "edit",
	})
	expect(route("/app?mode=slideshow&follow=1#doc-2")).toEqual({
		kind: "document",
		document: "doc-2",
		mode: "slideshow",
		follow: true,
	})
	expect(route("/app/native#doc-3")).toMatchObject({ document: "doc-3" })
	expect(route("/app?oauth=req")).toEqual({
		kind: "settings",
		category: "connections",
		oauth: "req",
	})
	expect(route("/invite#/doc/a/invite/b/secret")).toEqual({
		kind: "invitation",
	})
})

test("malformed paths are unknown rather than guessed", () => {
	for (let path of [
		"/application",
		"/app/doc",
		"/app/doc/a b",
		"/app/doc/x/unknown-mode",
		"/app/doc/%E0%A4%A",
		"/app/spaces/team/doc/x/preview/extra",
		"/app/settings/extra",
		"/app/whatever",
	])
		expect(route(path)).toEqual({ kind: "unknown" })
	expect(route("/app/settings?category=bogus")).toEqual({
		kind: "settings",
		category: "general",
	})
	expect(route("/app/settings?from=https://evil.test")).toEqual({
		kind: "settings",
		category: "general",
	})
	expect(route("/app#not a document")).toEqual({ kind: "library" })
})

test("the share target keeps shared text and links", () => {
	expect(
		parseRoute(
			new URL(
				"https://alkalye.test/app/share?title=Trip&text=Pack%20light&url=https%3A%2F%2Fexample.com",
			),
		),
	).toEqual({
		kind: "share",
		title: "Trip",
		text: "Pack light\n\nhttps://example.com",
	})
})

test("theme workbench paths name the theme and an attached theme's document", () => {
	let routes: AppRoute[] = [
		{ kind: "themeWorkbench", theme: "theme-1" },
		{ kind: "themeWorkbench", theme: "theme-1", document: "doc-1" },
	]
	for (let value of routes) expect(route(routeHref(value))).toEqual(value)
	expect(routeHref(routes[1] ?? { kind: "unknown" })).toBe(
		"/app/themes/theme-1/workbench?document=doc-1",
	)
	expect(route("/app/themes/theme-1")).toEqual({ kind: "unknown" })
	expect(route("/app/themes/theme-1/workbench?document=%2F..")).toEqual({
		kind: "themeWorkbench",
		theme: "theme-1",
	})
})
