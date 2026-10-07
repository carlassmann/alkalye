export function performanceFixture(
	kilobytes: number,
	shape: "rich" | "prose" | "code" | "long-line" = "rich",
) {
	let title = `Benchmark ${kilobytes} KB`
	let source = `---\ntitle: ${title}\n---\n# ${title}\n\n`
	let paragraphs = {
		rich: "A responsiveness fixture with **bold words**, ==highlight== and [a reference](https://example.com).\n\n",
		prose:
			"The document remains available offline. Many writers can contribute without interrupting another person's work.\n\n",
		code: "```typescript\nfunction describeDocument(title: string) {\n  return { title, availableOffline: true }\n}\n```\n\n",
		"long-line": "The document remains available offline. ",
	}
	let paragraph = paragraphs[shape]
	while (source.length < kilobytes * 1024) source += paragraph
	return source.slice(0, kilobytes * 1024)
}

if (import.meta.main) {
	let kilobytes = Number(process.argv[2])
	if (![2, 32, 128, 1024].includes(kilobytes))
		throw Error(
			"Usage: bun experiments/performance/fixture.ts 2|32|128|1024 [rich|prose|code|long-line]",
		)
	let shape = process.argv[3] ?? "rich"
	if (
		shape !== "rich" &&
		shape !== "prose" &&
		shape !== "code" &&
		shape !== "long-line"
	)
		throw Error("Unknown fixture shape")
	process.stdout.write(performanceFixture(kilobytes, shape))
}
