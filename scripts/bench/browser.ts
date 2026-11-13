import { type BrowserContext } from "@playwright/test"

export { installBenchmarkCompatibility }

async function installBenchmarkCompatibility(context: BrowserContext) {
	await context.addInitScript(() => {
		let originalMark = performance.mark.bind(performance)
		let originalMeasure = performance.measure.bind(performance)

		performance.mark = (name, options) => {
			if (options && "detail" in options) {
				return originalMark(name, { ...options, detail: undefined })
			}
			return originalMark(name, options)
		}

		performance.measure = (name, startOrMeasureOptions, endMark) => {
			if (
				startOrMeasureOptions &&
				typeof startOrMeasureOptions === "object" &&
				"detail" in startOrMeasureOptions
			) {
				return originalMeasure(name, {
					...startOrMeasureOptions,
					detail: undefined,
				})
			}
			return originalMeasure(name, startOrMeasureOptions, endMark)
		}
	})
}
