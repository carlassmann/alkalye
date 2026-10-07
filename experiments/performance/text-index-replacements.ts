import { TextIndex } from "../../src/shared/text-index"
let results = []
for (let length of [32768, 131072, 1048576]) {
	let source = ("it " + "word ".repeat(30) + "\n")
		.repeat(Math.ceil(length / 154))
		.slice(0, length)
	for (let count of [128, 512, 2048]) {
		let edits = Array.from({ length: count }, (_, index) => ({
			start: Math.floor((index * length) / count),
			end: Math.floor((index * length) / count),
			insert: "😀\n",
		}))
		let pieces: string[] = [],
			copied = 0
		for (let edit of edits) {
			pieces.push(source.slice(copied, edit.start), edit.insert)
			copied = edit.end
		}
		pieces.push(source.slice(copied))
		let expected = pieces.join("")
		let samples: { broad: number[]; precise: number[] } = {
			broad: [],
			precise: [],
		}
		for (let trial = 0; trial < 12; trial++)
			for (let mode of trial % 2
				? ["precise", "broad"]
				: ["broad", "precise"]) {
				let index = new TextIndex(source),
					began = performance.now()
				if (mode === "broad")
					index.replace({ start: 0, end: source.length, insert: expected })
				else for (let edit of [...edits].reverse()) index.replace(edit)
				let elapsed = performance.now() - began
				if (
					index.value !== expected ||
					index.length !== expected.length ||
					index.codePoints !== [...expected].length ||
					index.newlines !== expected.split("\n").length - 1
				)
					throw Error("Canonical summary mismatch")
				if (trial > 2)
					if (mode === "broad") samples.broad.push(elapsed)
					else samples.precise.push(elapsed)
			}
		results.push({ length, count, samples })
	}
}
console.log(JSON.stringify(results, null, 2))
