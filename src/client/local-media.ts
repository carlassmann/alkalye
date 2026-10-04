import * as Effect from "effect/Effect"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type * as Context from "effect/Context"
import type { DocumentSession } from "./document-session"
import type { LocalDirectories } from "./local-directories"

// Relative images in a local document are read from its folder. URLs are keyed
// by the source exactly as written, which is how the renderer looks them up.
export function makeLocalMedia(options: {
	document: string
	session: Context.Service.Shape<typeof DocumentSession>
	folders: Context.Service.Shape<typeof LocalDirectories>
}) {
	return Effect.gen(function* () {
		let { document, session, folders } = options
		let resolved = new Map<string, { url: string; modified: number }>()
		let urls = yield* SubscriptionRef.make<ReadonlyMap<string, string>>(
			new Map(),
		)
		let resolving = yield* Semaphore.make(1)
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				for (let { url } of resolved.values()) URL.revokeObjectURL(url)
				resolved.clear()
			}),
		)
		let refresh = resolving.withPermit(
			Effect.gen(function* () {
				let sources = relativeImages(session.replica.text(document))
				let changed = false
				for (let source of sources) {
					let file = yield* folders.readAsset(document, source)
					let previous = resolved.get(source)
					if (!file || previous?.modified === file.lastModified) continue
					if (previous) URL.revokeObjectURL(previous.url)
					resolved.set(source, {
						url: URL.createObjectURL(file),
						modified: file.lastModified,
					})
					changed = true
				}
				for (let [source, { url }] of resolved)
					if (!sources.has(source)) {
						URL.revokeObjectURL(url)
						resolved.delete(source)
						changed = true
					}
				if (changed)
					yield* SubscriptionRef.set(
						urls,
						new Map([...resolved].map(([source, { url }]) => [source, url])),
					)
			}),
		)
		yield* session.changes.pipe(
			Stream.debounce("200 millis"),
			Stream.merge(Stream.fromEventListener(window, "focus")),
			Stream.runForEach(() => refresh),
			Effect.forkScoped({ startImmediately: true }),
		)
		return Object.freeze({
			current: () => SubscriptionRef.getUnsafe(urls),
			changes: SubscriptionRef.changes(urls),
			refresh,
		})
	})
}

function relativeImages(source: string) {
	let sources = new Set<string>()
	for (let match of source.matchAll(
		/!\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
	)) {
		let target = match[1] ?? ""
		if (!/^[a-z][\w+.-]*:|^\/|^#/i.test(target)) sources.add(target)
	}
	return sources
}
