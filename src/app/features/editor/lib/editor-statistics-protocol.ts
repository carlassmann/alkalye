export type {
	EditorStatistics,
	StatisticsRequest,
	StatisticsResponse,
	StatisticsReplacement,
}

type EditorStatistics = Record<"words" | "sentences" | "tasks", string>
type StatisticsReplacement = { from: number; to: number; inserted: string }
type StatisticsRequest =
	| { type: "reset"; revision: number; content: string }
	| {
			type: "replace"
			revision: number
			baseRevision: number
			replacements: StatisticsReplacement[]
	  }
type StatisticsResponse =
	| { type: "stats"; revision: number; stats: EditorStatistics }
	| { type: "resync"; revision: number }
