import { legacyRoute, parseRoute, routeHref } from "../shared/routes"
import type { AppRoute } from "../shared/routes"

export interface Router {
	readonly current: () => AppRoute
	// Navigates as a link would: records history, then shows the route.
	readonly go: (route: AppRoute, options?: { replace?: boolean }) => void
	// Records a route the app is already showing, such as an opened document.
	readonly record: (route: AppRoute, options?: { replace?: boolean }) => void
}

// Path routing with the History API. Back and forward arrive as popstate;
// in-app links are intercepted so they navigate without reloading.
export function startRouter(
	signal: AbortSignal,
	show: (route: AppRoute) => void,
): Router {
	let initial = new URL(location.href)
	if (legacyRoute(initial) && parseRoute(initial).kind !== "unknown")
		history.replaceState(null, "", routeHref(parseRoute(initial)))
	window.addEventListener("popstate", () => show(current()), { signal })
	document.addEventListener(
		"click",
		event => {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey ||
				!(event.target instanceof Element)
			)
				return
			let link = event.target.closest("a[href]")
			if (
				!(link instanceof HTMLAnchorElement) ||
				link.target ||
				link.hasAttribute("download")
			)
				return
			let url = new URL(link.href)
			if (url.origin !== location.origin) return
			let route = parseRoute(url)
			if (route.kind === "unknown" || route.kind === "invitation") return
			event.preventDefault()
			go(route)
		},
		{ signal },
	)
	return { current, go, record }
	function current() {
		return parseRoute(new URL(location.href))
	}
	function go(route: AppRoute, options: { replace?: boolean } = {}) {
		record(route, options)
		show(route)
	}
	function record(route: AppRoute, options: { replace?: boolean } = {}) {
		let href = routeHref(route)
		if (href === location.pathname + location.search && !location.hash) return
		if (options.replace) history.replaceState(null, "", href)
		else history.pushState(null, "", href)
	}
}
