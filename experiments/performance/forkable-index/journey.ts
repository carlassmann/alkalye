import * as Effect from "effect/Effect"
import { Replica } from "../../../src/shared/crdt"
import { browserSchedulerLayer } from "../../../src/client/scheduler"

interface Phase {
	name: string
	milliseconds: number
}
let source = ""
let original: Replica | undefined
let cold: Replica | undefined

function equal(actual: string, expected: string) {
	if (actual !== expected) throw new Error("Replica source mismatch")
}

function prepare(characters: number) {
	source = "---\ntitle: Index experiment\n---\n" + "a".repeat(characters)
	original = new Replica("original", "Original")
	original.edit("document", source)
	original.text("document")
	cold = new Replica("cold", "Cold")
	cold.restore(original.checkpoint())
	return { characters: source.length }
}

async function run(yielding: boolean) {
	if (!original || !cold) throw new Error("Prepare fixture first")
	let owner = original
	let phases: Phase[] = []
	async function measure<T>(name: string, work: () => T | Promise<T>) {
		let start = performance.now()
		let result = await work()
		phases.push({ name, milliseconds: performance.now() - start })
		return result
	}
	function fork(actor: string) {
		return yielding
			? Effect.runPromise(
					typeof window === "undefined"
						? owner.forkEffect(actor)
						: owner
								.forkEffect(actor)
								.pipe(Effect.provide(browserSchedulerLayer)),
				)
			: owner.fork(actor)
	}
	let first = await measure("first fork", () => fork("first"))
	let second = await measure("second fork", () => fork("second"))
	let third = await measure("third fork", () => fork("third"))
	await measure("cold source", () => cold?.text("document"))
	let held = owner.visible("document")
	let edit = await measure("fork edit", () =>
		first.edit("document", source + "🌻"),
	)
	if (!edit) throw new Error("Missing fork edit")
	equal(owner.text("document"), source)
	equal(second.text("document"), source)
	equal(third.text("document"), source)
	equal(held.map(atom => atom.value).join(""), source)
	let other = await measure("owner edit", () =>
		owner.edit("document", source.replace("\n---\n", "\n---\nOwner\n")),
	)
	if (!other) throw new Error("Missing independent edit")
	await measure("merge", () => {
		first.apply([other])
		owner.apply([edit])
	})
	equal(first.text("document"), owner.text("document"))
	await measure("undo", () => first.cancel("document", edit.id))
	equal(first.text("document"), source.replace("\n---\n", "\n---\nOwner\n"))
	equal(
		owner.text("document"),
		source.replace("\n---\n", "\n---\nOwner\n") + "🌻",
	)
	equal(second.text("document"), source)
	let restored = new Replica("restored")
	let checkpoint = await measure("checkpoint", () => first.checkpoint())
	await measure("restore", () => restored.restore(checkpoint))
	equal(restored.text("document"), first.text("document"))
	if (restored.metadata("document").title !== "Index experiment")
		throw new Error("Frontmatter metadata changed")
	return { characters: source.length, yielding, phases }
}

declare global {
	interface Window {
		indexProbe: { prepare: typeof prepare; run: typeof run }
	}
}
if (typeof window !== "undefined") {
	window.indexProbe = { prepare, run }
	document.body.textContent = "Public Replica index experiment ready."
}
export { prepare, run }
