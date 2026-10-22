import { createStatisticsDocument } from "./statistics-document"
import type {
	StatisticsRequest,
	StatisticsResponse,
} from "./editor-statistics-protocol"

let document = createStatisticsDocument()
addEventListener("message", (event: MessageEvent<StatisticsRequest>) => {
	let response: StatisticsResponse = document.update(event.data)
	postMessage(response)
})
