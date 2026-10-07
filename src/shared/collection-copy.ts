export function* copyMapSteps<K, V>(
	source: ReadonlyMap<K, V>,
	cooperative: boolean,
): Generator<void, Map<K, V>, void> {
	if (!cooperative || source.size <= 1024) return new Map(source)
	let result = new Map<K, V>()
	let count = 0
	for (let [key, value] of source) {
		result.set(key, value)
		if (++count === 1024) {
			count = 0
			yield
		}
	}
	return result
}

export function* copySetSteps<A>(
	source: ReadonlySet<A>,
	cooperative: boolean,
): Generator<void, Set<A>, void> {
	if (!cooperative || source.size <= 1024) return new Set(source)
	let result = new Set<A>()
	let count = 0
	for (let value of source) {
		result.add(value)
		if (++count === 1024) {
			count = 0
			yield
		}
	}
	return result
}

export function finishSteps<A>(steps: Generator<void, A, void>): A {
	let result = steps.next()
	while (!result.done) result = steps.next()
	return result.value
}
