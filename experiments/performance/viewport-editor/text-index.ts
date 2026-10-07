export interface Replacement {
	start: number
	end: number
	insert: string
}
interface Summary {
	length: number
	newlines: number
	first: number
	last: number
	rows: number
}
interface Leaf extends Summary {
	kind: "leaf"
	text: string
	height: number
}
interface Branch extends Summary {
	kind: "branch"
	left: Node
	right: Node
	height: number
}
type Node = Leaf | Branch
let empty: Summary = { length: 0, newlines: 0, first: 0, last: 0, rows: 1 }
function wrapped(length: number) {
	return Math.max(1, Math.ceil(length / 72))
}
function summary(text: string): Summary {
	let lines = text.split("\n")
	return {
		length: text.length,
		newlines: lines.length - 1,
		first: lines[0]?.length ?? 0,
		last: lines.at(-1)?.length ?? 0,
		rows: lines.reduce((rows, line) => rows + wrapped(line.length), 0),
	}
}
function combine(left: Summary, right: Summary): Summary {
	return {
		length: left.length + right.length,
		newlines: left.newlines + right.newlines,
		first: left.newlines ? left.first : left.length + right.first,
		last: right.newlines ? right.last : right.length + left.last,
		rows:
			left.rows +
			right.rows -
			wrapped(left.last) -
			wrapped(right.first) +
			wrapped(left.last + right.first),
	}
}
function leaf(text: string): Leaf {
	return { ...summary(text), kind: "leaf", text, height: 1 }
}
function branch(left: Node, right: Node): Branch {
	return {
		...combine(left, right),
		kind: "branch",
		left,
		right,
		height: Math.max(left.height, right.height) + 1,
	}
}
function balance(left: Node, right: Node): Node {
	if (left.height > right.height + 1 && left.kind === "branch") {
		if (left.left.height >= left.right.height)
			return branch(left.left, branch(left.right, right))
		if (left.right.kind === "branch")
			return branch(
				branch(left.left, left.right.left),
				branch(left.right.right, right),
			)
	}
	if (right.height > left.height + 1 && right.kind === "branch") {
		if (right.right.height >= right.left.height)
			return branch(branch(left, right.left), right.right)
		if (right.left.kind === "branch")
			return branch(
				branch(left, right.left.left),
				branch(right.left.right, right.right),
			)
	}
	return branch(left, right)
}
function join(left: Node | null, right: Node | null): Node | null {
	if (!left) return right
	if (!right) return left
	if (
		left.kind === "leaf" &&
		right.kind === "leaf" &&
		left.length + right.length <= 2048
	)
		return leaf(left.text + right.text)
	if (left.height > right.height + 1 && left.kind === "branch") {
		let combined = join(left.right, right)
		return combined ? balance(left.left, combined) : left.left
	}
	if (right.height > left.height + 1 && right.kind === "branch") {
		let combined = join(left, right.left)
		return combined ? balance(combined, right.right) : right.right
	}
	return branch(left, right)
}
function split(node: Node | null, offset: number): [Node | null, Node | null] {
	if (!node) return [null, null]
	if (offset <= 0) return [null, node]
	if (offset >= node.length) return [node, null]
	if (node.kind === "leaf")
		return [leaf(node.text.slice(0, offset)), leaf(node.text.slice(offset))]
	if (offset < node.left.length) {
		let [left, right] = split(node.left, offset)
		return [left, join(right, node.right)]
	}
	let [left, right] = split(node.right, offset - node.left.length)
	return [join(node.left, left), right]
}
function build(text: string): Node | null {
	let leaves: Node[] = []
	for (let offset = 0; offset < text.length; offset += 2048)
		leaves.push(leaf(text.slice(offset, offset + 2048)))
	function assemble(start: number, end: number): Node | null {
		if (start >= end) return null
		if (end - start === 1) return leaves[start] ?? null
		let middle = (start + end) >>> 1
		let left = assemble(start, middle),
			right = assemble(middle, end)
		return left && right ? branch(left, right) : (left ?? right)
	}
	return assemble(0, leaves.length)
}
function prefix(node: Node | null, length: number): Summary {
	if (!node || length <= 0) return empty
	if (length >= node.length) return node
	if (node.kind === "leaf") return summary(node.text.slice(0, length))
	return length <= node.left.length
		? prefix(node.left, length)
		: combine(node.left, prefix(node.right, length - node.left.length))
}
function collect(
	node: Node | null,
	start: number,
	end: number,
	parts: string[],
) {
	if (!node || end <= 0 || start >= node.length || start >= end) return
	if (node.kind === "leaf") {
		parts.push(node.text.slice(Math.max(0, start), Math.min(node.length, end)))
		return
	}
	collect(node.left, start, end, parts)
	collect(node.right, start - node.left.length, end - node.left.length, parts)
}
export class TextIndex {
	private root: Node | null
	constructor(source: string) {
		this.root = build(source)
	}
	get length() {
		return this.root?.length ?? 0
	}
	get newlines() {
		return this.root?.newlines ?? 0
	}
	get rows() {
		return this.root?.rows ?? 1
	}
	get value() {
		return this.slice(0, this.length)
	}
	slice(start: number, end: number) {
		let parts: string[] = []
		collect(this.root, start, end, parts)
		return parts.join("")
	}
	replace(edit: Replacement) {
		if (edit.start < 0 || edit.end < edit.start || edit.end > this.length)
			throw new RangeError("Replacement outside document")
		let [before, tail] = split(this.root, edit.start)
		let [, after] = split(tail, edit.end - edit.start)
		this.root = join(join(before, build(edit.insert)), after)
	}
	previousGrapheme(offset: number) {
		if (offset <= 0) return 0
		let width = 2048
		while (true) {
			let start = Math.max(0, offset - width),
				part = this.slice(start, offset),
				last = 0
			for (let segment of new Intl.Segmenter(undefined, {
				granularity: "grapheme",
			}).segment(part))
				last = segment.index
			if (last > 0 || start === 0) return start + last
			width *= 2
		}
	}
	nextGrapheme(offset: number) {
		if (offset >= this.length) return this.length
		let width = 2048
		while (true) {
			let end = Math.min(this.length, offset + width),
				part = this.slice(offset, end)
			let first = new Intl.Segmenter(undefined, { granularity: "grapheme" })
				.segment(part)
				[Symbol.iterator]()
				.next().value
			let length = first?.segment.length ?? 0
			if (length < part.length || end === this.length) return offset + length
			width *= 2
		}
	}
	rowAt(offset: number) {
		offset = Math.max(0, Math.min(this.length, offset))
		let part = prefix(this.root, offset)
		if (offset === this.length || this.slice(offset, offset + 1) === "\n")
			return part.rows - 1
		return part.rows - wrapped(part.last) + Math.floor(part.last / 72)
	}
	offsetAtRow(row: number) {
		if (row <= 0) return 0
		if (row >= this.rows) return this.length
		let low = 0,
			high = this.length
		while (low < high) {
			let middle = (low + high) >>> 1
			if (this.rowAt(middle) < row) low = middle + 1
			else high = middle
		}
		return low
	}
}
