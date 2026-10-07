import * as Schema from "effect/Schema"

export let FrameRequest = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("open"),
		source: Schema.String,
		directory: Schema.String,
	}),
	Schema.Struct({
		kind: Schema.Literal("edit"),
		sequence: Schema.Number,
		start: Schema.Number,
		remove: Schema.Number,
		text: Schema.String,
	}),
	Schema.Struct({ kind: Schema.Literal("close") }),
])
export let FrameResponse = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("listening") }),
	Schema.Struct({ kind: Schema.Literal("ready"), hash: Schema.String }),
	Schema.Struct({
		kind: Schema.Literal("saved"),
		sequence: Schema.Number,
		milliseconds: Schema.Number,
	}),
	Schema.Struct({ kind: Schema.Literal("closed"), hash: Schema.String }),
	Schema.Struct({ kind: Schema.Literal("failure"), message: Schema.String }),
])
export type EditPatch = Extract<typeof FrameRequest.Type, { kind: "edit" }>

export class FrameText {
	private blocks: string[] = []
	length = 0
	constructor(source: string) {
		for (let index = 0; index < source.length; index += 1024)
			this.blocks.push(source.slice(index, index + 1024))
		this.length = source.length
	}
	patch(edit: EditPatch) {
		if (
			edit.start < 0 ||
			edit.remove < 0 ||
			edit.start + edit.remove > this.length
		)
			throw Error("Patch outside source")
		let start = this.locate(edit.start),
			end = this.locate(edit.start + edit.remove)
		let prefix = this.blocks[start.block]?.slice(0, start.offset) ?? ""
		let suffix = this.blocks[end.block]?.slice(end.offset) ?? ""
		let replacement = prefix + edit.text + suffix
		let inserted: string[] = []
		for (let index = 0; index < replacement.length; index += 1024)
			inserted.push(replacement.slice(index, index + 1024))
		this.blocks = this.blocks
			.slice(0, start.block)
			.concat(inserted, this.blocks.slice(end.block + 1))
		this.length += edit.text.length - edit.remove
	}
	window(start: number, count: number) {
		let cursor = this.locate(start),
			output = ""
		for (
			let index = cursor.block;
			output.length < count && index < this.blocks.length;
			index++
		)
			output +=
				this.blocks[index]?.slice(index === cursor.block ? cursor.offset : 0) ??
				""
		return output.slice(0, count)
	}
	text() {
		return this.blocks.join("")
	}
	private locate(offset: number) {
		let block = 0
		while (block < this.blocks.length - 1) {
			let length = this.blocks[block]?.length ?? 0
			if (offset < length) break
			offset -= length
			block++
		}
		return { block, offset }
	}
}
