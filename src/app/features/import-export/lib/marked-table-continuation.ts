import { type MarkedExtension, type Tokens } from "marked"

export { createTableContinuationExtension }

// iA Writer treats pipe rows after a blank line as another row group of the
// preceding table. Letters use this for subtotal and total rows.
function createTableContinuationExtension(): MarkedExtension {
	let groupStartsByTable = new WeakMap<Tokens.Table, number[]>()

	return {
		extensions: [
			{
				name: "tableContinuation",
				level: "block",
				tokenizer(src) {
					let match = src.match(/^(?:[ \t]*\|[^\n]*\|[ \t]*(?:\n|$))+/)
					if (!match) return undefined
					if (startsNewTable(match[0])) return undefined
					let table = findPrecedingTable(this.lexer.tokens)
					if (!table) return undefined

					let rows = match[0]
						.trimEnd()
						.split("\n")
						.map(line =>
							splitRow(line, table.header.length).map((text, index) => ({
								text,
								tokens: this.lexer.inline(text),
								header: false,
								align: table.align[index] ?? null,
							})),
						)
					let groupStarts = groupStartsByTable.get(table) ?? []
					groupStarts.push(table.rows.length)
					groupStartsByTable.set(table, groupStarts)
					table.rows.push(...rows)
					return { type: "tableContinuation", raw: match[0] }
				},
				renderer() {
					return ""
				},
			},
		],
		renderer: {
			table(token) {
				let groupStarts = groupStartsByTable.get(token)
				if (!groupStarts) return false
				let header = this.tablerow({
					text: token.header.map(cell => this.tablecell(cell)).join(""),
				})
				let bodies = [0, ...groupStarts, token.rows.length]
					.slice(0, -1)
					.map((start, index, starts) => {
						let end = starts[index + 1] ?? token.rows.length
						let rows = token.rows
							.slice(start, end)
							.map(row =>
								this.tablerow({
									text: row.map(cell => this.tablecell(cell)).join(""),
								}),
							)
							.join("")
						return rows ? `<tbody>${rows}</tbody>` : ""
					})
					.join("\n")
				return `<table>\n<thead>\n${header}</thead>\n${bodies}</table>\n`
			},
		},
	}
}

function findPrecedingTable(tokens: { type: string }[]): Tokens.Table | null {
	for (let index = tokens.length - 1; index >= 0; index--) {
		let token = tokens[index]
		if (token.type === "space") continue
		return isTableToken(token) ? token : null
	}
	return null
}

function isTableToken(token: { type: string }): token is Tokens.Table {
	return token.type === "table"
}

function startsNewTable(rows: string): boolean {
	let secondRow = rows.split("\n")[1] ?? ""
	return /^[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*$/.test(secondRow)
}

function splitRow(line: string, columnCount: number): string[] {
	let cells = line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split(/(?<!\\)\|/)
		.map(cell => cell.trim().replace(/\\\|/g, "|"))
	return Array.from({ length: columnCount }, (_, index) => cells[index] ?? "")
}
