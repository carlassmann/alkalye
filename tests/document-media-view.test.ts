import { expect, test } from "bun:test"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as RcMap from "effect/RcMap"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { makeDocumentMediaView } from "../src/client/document-media-view"

function fixture() {
	return Effect.gen(function* () {
		let owner = yield* Scope.Scope
		let state = { source: "asset:A", broken: false }
		let lookups = new Map<string, number>()
		let interrupted: string[] = []
		let released: string[] = []
		let unsafeReleases: string[] = []
		let live = new Set<string>()
		let displayed = new Set<string>()
		let faults = new Set<string>()
		let cancelled = new Set<string>()
		let reports: unknown[] = []
		let gates = new Map<string, Deferred.Deferred<void>>()
		let changes = yield* SubscriptionRef.make(0)
		let resources = yield* RcMap.make({
			idleTimeToLive: 0,
			lookup: (reference: string) =>
				Effect.gen(function* () {
					lookups.set(reference, (lookups.get(reference) ?? 0) + 1)
					let gate = gates.get(reference)
					if (gate)
						yield* Deferred.await(gate).pipe(
							Effect.onInterrupt(() =>
								Effect.sync(() => interrupted.push(reference)),
							),
						)
					if (faults.has(reference))
						return yield* Effect.fail(new Error("Missing " + reference))
					if (cancelled.delete(reference)) return yield* Effect.interrupt
					return yield* Effect.acquireRelease(
						Effect.sync(() => {
							live.add(reference)
							return reference
						}),
						url =>
							Effect.sync(() => {
								if (displayed.has(url)) unsafeReleases.push(url)
								live.delete(url)
								released.push(url)
							}),
					)
				}),
		})
		let media = {
			acquire: (reference: string) => RcMap.get(resources, reference),
			references: (source: string): [string, string][] =>
				[...source.matchAll(/asset:([A-Z])/g)].map(match => [
					match[1] ?? "",
					match[1] ?? "",
				]),
			changes: SubscriptionRef.changes(changes).pipe(Stream.map(() => "")),
		}
		function createView() {
			return Effect.gen(function* () {
				let scope = yield* Scope.fork(owner, "sequential")
				let view = yield* makeDocumentMediaView({
					media,
					source: () => state.source,
					changed: () => {
						if (state.broken) throw new Error("Theme content slot missing")
						displayed.clear()
						for (let url of view.current().urls.values()) displayed.add(url)
					},
					clear: () => displayed.clear(),
					report: error => reports.push(error),
				}).pipe(Effect.provideService(Scope.Scope, scope))
				return { view, scope }
			})
		}
		return {
			createView,
			state,
			lookups,
			interrupted,
			released,
			unsafeReleases,
			live,
			displayed,
			faults,
			cancelled,
			reports,
			gates,
		}
	})
}
function waitFor(predicate: () => boolean): Effect.Effect<void> {
	return Effect.suspend(() =>
		predicate()
			? Effect.void
			: Effect.sleep("1 millis").pipe(Effect.andThen(waitFor(predicate))),
	)
}
function verify(work: Effect.Effect<void, unknown, Scope.Scope>) {
	return Effect.runPromise(
		Effect.scoped(work).pipe(Effect.timeout("3 seconds")),
	)
}

test("adding an asset and editing source retain an unrelated in-flight download", () =>
	verify(
		Effect.gen(function* () {
			let f = yield* fixture()
			let gate = yield* Deferred.make<void>()
			f.gates.set("A", gate)
			let { view, scope } = yield* f.createView()
			view.visible(true)
			yield* waitFor(() => f.lookups.has("A"))
			f.state.source += " edited asset:B"
			view.refresh()
			yield* waitFor(() => view.current().urls.has("B"))
			expect(f.lookups.get("A")).toBe(1)
			expect(f.interrupted).toEqual([])
			yield* Deferred.succeed(gate, undefined)
			yield* waitFor(() => view.current().urls.has("A"))
			expect([...view.current().urls.keys()]).toEqual(["A", "B"])
			yield* Scope.close(scope, Exit.void)
			expect(f.unsafeReleases).toEqual([])
			expect(f.live.size).toBe(0)
		}),
	))

test("retry replaces failed leases without restarting healthy or pending downloads", () =>
	verify(
		Effect.gen(function* () {
			let f = yield* fixture()
			let gate = yield* Deferred.make<void>()
			f.gates.set("A", gate)
			f.faults.add("B")
			f.state.source = "asset:A asset:B asset:C"
			let { view, scope } = yield* f.createView()
			view.visible(true)
			yield* waitFor(
				() => view.current().failures.has("B") && view.current().urls.has("C"),
			)
			f.faults.delete("B")
			view.retry()
			yield* waitFor(() => view.current().urls.has("B"))
			expect(f.lookups.get("A")).toBe(1)
			expect(f.lookups.get("B")).toBe(2)
			expect(f.lookups.get("C")).toBe(1)
			expect(f.interrupted).toEqual([])
			expect(f.released).toEqual([])
			yield* Scope.close(scope, Exit.void)
			expect(f.interrupted).toEqual(["A"])
			expect(f.unsafeReleases).toEqual([])
		}),
	))

test("a failed DOM swap retains old and new leases until a successful render", () =>
	verify(
		Effect.gen(function* () {
			let f = yield* fixture()
			let { view, scope } = yield* f.createView()
			view.visible(true)
			yield* waitFor(() => view.current().urls.has("A"))
			f.state.broken = true
			f.state.source = "asset:B"
			view.refresh()
			yield* waitFor(() => view.current().urls.has("B") && f.reports.length > 0)
			expect(f.live).toEqual(new Set(["A", "B"]))
			expect(f.displayed).toEqual(new Set(["A"]))
			expect(f.released).toEqual([])
			f.state.broken = false
			f.state.source += " fixed"
			view.refresh()
			yield* waitFor(() => f.released.includes("A"))
			expect(f.displayed).toEqual(new Set(["B"]))
			expect(f.unsafeReleases).toEqual([])
			yield* Scope.close(scope, Exit.void)
		}),
	))

test("hiding aborts unfinished work, clears the DOM before release, and can reopen", () =>
	verify(
		Effect.gen(function* () {
			let f = yield* fixture()
			let gate = yield* Deferred.make<void>()
			f.gates.set("A", gate)
			f.state.source = "asset:A asset:B"
			let { view, scope } = yield* f.createView()
			view.visible(true)
			yield* waitFor(() => f.lookups.has("A") && view.current().urls.has("B"))
			view.visible(false)
			yield* waitFor(() => f.interrupted.includes("A") && f.live.size === 0)
			expect(view.current().urls.size).toBe(0)
			expect(f.unsafeReleases).toEqual([])
			yield* Deferred.succeed(gate, undefined)
			view.visible(true)
			yield* waitFor(() => view.current().urls.size === 2)
			expect(f.lookups.get("A")).toBe(2)
			yield* Scope.close(scope, Exit.void)
		}),
	))

test("closing one viewer preserves a lease held by a second viewer", () =>
	verify(
		Effect.gen(function* () {
			let f = yield* fixture()
			let first = yield* f.createView()
			let second = yield* f.createView()
			first.view.visible(true)
			second.view.visible(true)
			yield* waitFor(
				() =>
					first.view.current().urls.has("A") &&
					second.view.current().urls.has("A"),
			)
			expect(f.lookups.get("A")).toBe(1)
			yield* Scope.close(first.scope, Exit.void)
			expect(f.live.has("A")).toBe(true)
			expect(f.released).toEqual([])
			yield* Scope.close(second.scope, Exit.void)
			expect(f.live.size).toBe(0)
		}),
	))

test("closing while a theme is broken still detaches the DOM before releasing URLs", () =>
	verify(
		Effect.gen(function* () {
			let f = yield* fixture()
			let { view, scope } = yield* f.createView()
			view.visible(true)
			yield* waitFor(() => view.current().urls.has("A"))
			f.state.broken = true
			yield* Scope.close(scope, Exit.void)
			expect(f.live.size).toBe(0)
			expect(f.displayed.size).toBe(0)
			expect(f.unsafeReleases).toEqual([])
		}),
	))

test("a dropped download completing after a failed render cannot join its own fiber", () =>
	verify(
		Effect.gen(function* () {
			let f = yield* fixture()
			let gate = yield* Deferred.make<void>()
			f.gates.set("A", gate)
			let { view, scope } = yield* f.createView()
			view.visible(true)
			yield* waitFor(() => f.lookups.has("A"))
			f.state.broken = true
			f.state.source = "asset:B"
			view.refresh()
			yield* waitFor(() => view.current().urls.has("B") && f.reports.length > 0)
			f.state.broken = false
			yield* Deferred.succeed(gate, undefined)
			yield* waitFor(() => f.released.includes("A"))
			expect(f.displayed).toEqual(new Set(["B"]))
			expect(f.unsafeReleases).toEqual([])
			yield* Scope.close(scope, Exit.void)
		}),
	))

test("an interrupted shared lookup is visible and retryable without reopening the view", () =>
	verify(
		Effect.gen(function* () {
			let f = yield* fixture()
			f.cancelled.add("A")
			let { view, scope } = yield* f.createView()
			view.visible(true)
			yield* waitFor(() => view.current().failures.has("A"))
			view.retry()
			yield* waitFor(() => view.current().urls.has("A"))
			expect(f.lookups.get("A")).toBe(2)
			expect(view.current().failures.size).toBe(0)
			yield* Scope.close(scope, Exit.void)
			expect(f.unsafeReleases).toEqual([])
		}),
	))
