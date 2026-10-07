import { Replica } from "../../src/shared/crdt"
import { performanceFixture } from "./fixture"

// Fixture creation, forks and cache warming stay outside the measured public edit.
for (let size of [128, 1024]) {
	let birth = new Replica("birth")
	birth.edit(
		"doc",
		performanceFixture(size, size === 1024 ? "long-line" : "rich"),
	)
	for (let scenario of ["normal", "retitle", "merge", "remote", "undo"]) {
		let replica = birth.fork("local")
		if (scenario === "retitle" || scenario === "merge") {
			let source = replica.text("doc")
			replica.edit("doc", source.replace(`Benchmark ${size} KB`, "Renamed"))
			if (replica.metadata("doc").title !== "Renamed")
				throw Error("Retitle did not update frontmatter")
		}
		if (scenario === "merge") {
			let peer = birth.fork("peer")
			let change = peer.edit(
				"doc",
				peer.text("doc").replace("---\n#", "mode: present\n---\n#"),
			)
			if (!change) throw Error("Missing concurrent metadata edit")
			replica.apply([change])
			if (!replica.text("doc").includes("mode: present\n"))
				throw Error("Concurrent frontmatter field was lost")
		}
		if (scenario === "remote" || scenario === "undo") {
			let peer = replica.fork("peer")
			let source = peer.text("doc"),
				start = source.indexOf("\n\n") + 2
			let change = peer.prepareReplacements("doc", [
				{ start, remove: 0, text: "REMOTE " },
			])
			if (!change) throw Error("Missing remote body edit")
			replica.apply([change])
			if (scenario === "undo") replica.cancel("doc", change.id)
			let expected =
				scenario === "undo"
					? source
					: source.slice(0, start) + "REMOTE " + source.slice(start)
			if (replica.text("doc") !== expected)
				throw Error("Remote edit or undo lost source")
		}
		replica.text("doc")
		let samples = []
		for (let position of ["start", "middle", "end"]) {
			let before = replica.text("doc"),
				start =
					position === "start"
						? before.indexOf("\n\n") + 2
						: position === "middle"
							? Math.floor(before.length / 2)
							: before.length
			let expected = before.slice(0, start) + "Z" + before.slice(start)
			let began = performance.now()
			let change = replica.prepareReplacements("doc", [
				{ start, remove: 0, text: "Z" },
			])
			let prepared = performance.now() - began
			began = performance.now()
			if (!change) throw Error("Missing precise edit")
			replica.apply([change])
			let applied = performance.now() - began
			began = performance.now()
			let actual = replica.text("doc")
			let projected = performance.now() - began
			if (actual !== expected) throw Error("Unexpected projection")
			samples.push({
				position,
				prepared,
				applied,
				projected,
				total: prepared + applied + projected,
			})
		}
		let reopened = new Replica("reopened")
		reopened.restore(replica.checkpoint())
		if (reopened.text("doc") !== replica.text("doc"))
			throw Error("Checkpoint projection differs from edited source")
		console.log(JSON.stringify({ size, scenario, samples }))
	}
}
