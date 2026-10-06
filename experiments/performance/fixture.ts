export function performanceFixture(kilobytes: number) {
	let title = `Benchmark ${kilobytes} KB`
	let source = `---\ntitle: ${title}\n---\n# ${title}\n\n`
	let paragraph =
		"A responsiveness fixture with **bold words**, ==highlight== and [a reference](https://example.com).\n\n"
	while (source.length < kilobytes * 1024) source += paragraph
	return source.slice(0, kilobytes * 1024)
}

if (import.meta.main) {
	let kilobytes = Number(process.argv[2])
	if (![2, 32, 128].includes(kilobytes))
		throw Error("Usage: bun experiments/performance/fixture.ts 2|32|128")
	process.stdout.write(performanceFixture(kilobytes))
}
