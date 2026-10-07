import * as HashMap from "effect/HashMap"
import * as Option from "effect/Option"

interface IndexedAtom {
	target: string
	atom: { id: string; after: string; value: string }
}

function measured<A>(work: () => A) {
	let heap = process.memoryUsage().heapUsed
	let started = performance.now()
	let value = work()
	return {
		value,
		milliseconds: performance.now() - started,
		heapBytes: process.memoryUsage().heapUsed - heap,
	}
}
function summary(measurement: { milliseconds: number; heapBytes: number }) {
	return {
		milliseconds: measurement.milliseconds,
		heapBytes: measurement.heapBytes,
	}
}
function requireValue<A>(value: A | undefined): A {
	if (value === undefined) throw Error("Missing indexed atom")
	return value
}
function fixture(size: number) {
	let operation =
		"0001791400000000:000000:prototype-actor-00000000000000000000000"
	let entries: [string, IndexedAtom][] = []
	let after = ""
	for (let offset = 0; offset < size; offset++) {
		let id = operation + ":" + String(offset).padStart(8, "0")
		entries.push([id, { target: "doc", atom: { id, after, value: "a" } }])
		after = id
	}
	return entries
}
function probe(size: number) {
	Bun.gc(true)
	let entries = fixture(size)
	let selected = Array.from(
		{ length: 4096 },
		(_, index) =>
			requireValue(entries[Math.floor((index * (size - 1)) / 4095)])[0],
	)
	let native = measured(() => new Map(entries))
	let nativeFork = measured(() => [
		new Map(native.value),
		new Map(native.value),
		new Map(native.value),
	])
	let nativeLookup = measured(() => {
		let found = 0
		for (let repeat = 0; repeat < 32; repeat++)
			for (let key of selected)
				found += requireValue(native.value.get(key)).atom.value.length
		return found
	})
	let nativeScan = measured(() => {
		let found = 0
		for (let value of native.value.values()) found += value.atom.value.length
		return found
	})
	let added: IndexedAtom = {
		target: "doc",
		atom: { id: "new-key", after: selected[0] ?? "", value: "z" },
	}
	let nativeEdit = measured(() => {
		let first = requireValue(nativeFork.value[0])
		first.set(added.atom.id, added)
		return first
	})
	if (requireValue(nativeFork.value[1]).has(added.atom.id))
		throw Error("Native fork changed a sibling")
	let persistent = measured(() => {
		let transient = HashMap.beginMutation(HashMap.empty<string, IndexedAtom>())
		for (let [key, value] of entries)
			transient = HashMap.set(transient, key, value)
		return HashMap.endMutation(transient)
	})
	let persistentFork = measured(() => [
		persistent.value,
		persistent.value,
		persistent.value,
	])
	let persistentLookup = measured(() => {
		let found = 0
		for (let repeat = 0; repeat < 32; repeat++)
			for (let key of selected)
				found += requireValue(
					Option.getOrUndefined(HashMap.get(persistent.value, key)),
				).atom.value.length
		return found
	})
	let persistentScan = measured(() => {
		let found = 0
		for (let value of HashMap.values(persistent.value))
			found += value.atom.value.length
		return found
	})
	let persistentEdit = measured(() =>
		HashMap.set(requireValue(persistentFork.value[0]), added.atom.id, added),
	)
	if (
		Option.isSome(
			HashMap.get(requireValue(persistentFork.value[1]), added.atom.id),
		) ||
		Option.isNone(HashMap.get(persistentEdit.value, added.atom.id)) ||
		persistentLookup.value !== nativeLookup.value ||
		persistentScan.value !== nativeScan.value
	)
		throw Error("Persistent fork changed a sibling or lost a lookup")
	return {
		kind: "atom-index microprototype; not a public Replica integration proof",
		entries: size,
		keyLength: entries[0]?.[0].length,
		lookups: selected.length * 32,
		native: {
			hydrate: summary(native),
			forkThree: summary(nativeFork),
			selectedLookups: summary(nativeLookup),
			fullScan: summary(nativeScan),
			editOne: summary(nativeEdit),
		},
		effect: {
			hydrate: summary(persistent),
			forkThree: summary(persistentFork),
			selectedLookups: summary(persistentLookup),
			fullScan: summary(persistentScan),
			editOne: summary(persistentEdit),
		},
	}
}

for (let size of [128 * 1024, 1024 * 1024])
	console.log(JSON.stringify(probe(size)))
