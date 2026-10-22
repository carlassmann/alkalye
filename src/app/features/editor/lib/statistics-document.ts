import { getStats } from "./count-statistics"
import type {
	StatisticsRequest,
	StatisticsResponse,
} from "./editor-statistics-protocol"

export { createStatisticsDocument }

function createStatisticsDocument() {
	let content = ""
	let revision = -1
	return {
		update(request: StatisticsRequest): StatisticsResponse {
			if (request.revision <= revision)
				return { type: "resync", revision: request.revision }
			if (request.type === "reset") {
				content = request.content
			} else {
				if (request.baseRevision !== revision)
					return { type: "resync", revision: request.revision }
				let previousEnd = 0
				for (let replacement of request.replacements) {
					if (
						!Number.isInteger(replacement.from) ||
						!Number.isInteger(replacement.to) ||
						replacement.from < previousEnd ||
						replacement.to < replacement.from ||
						replacement.to > content.length
					)
						return { type: "resync", revision: request.revision }
					previousEnd = replacement.to
				}
				for (let replacement of [...request.replacements].reverse()) {
					content =
						content.slice(0, replacement.from) +
						replacement.inserted +
						content.slice(replacement.to)
				}
			}
			revision = request.revision
			return { type: "stats", revision, stats: getStats(content) }
		},
	}
}
