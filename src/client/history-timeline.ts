import type { DocumentMoment } from "../shared/document-history"

export function momentDate(moment: DocumentMoment) {
	return new Date(moment.action.changes.at(-1)?.time ?? 0)
}

export function momentDay(moment: DocumentMoment) {
	let date = momentDate(moment)
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function historyDays(moments: readonly DocumentMoment[]) {
	let days = new Map<string, { label: string; count: number }>()
	for (let moment of moments) {
		let key = momentDay(moment)
		let day = days.get(key)
		if (day) day.count++
		else
			days.set(key, {
				label: momentDate(moment).toLocaleDateString(undefined, {
					year: "numeric",
					month: "short",
					day: "numeric",
				}),
				count: 1,
			})
	}
	return [...days].reverse().map(([value, day]) => ({ value, ...day }))
}

export function historyIndices(
	moments: readonly DocumentMoment[],
	day: string,
) {
	return moments.flatMap((moment, index) =>
		!day || momentDay(moment) === day ? [index] : [],
	)
}
