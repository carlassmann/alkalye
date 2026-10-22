import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view"
import { trackInteractions } from "@/app/lib/interaction-work"
import { createEditorStatistics } from "./editor-statistics"

export { editorStatisticsExtension }

let editorStatisticsExtension = ViewPlugin.fromClass(
	class {
		statistics: ReturnType<typeof createEditorStatistics>
		stopTracking: () => void
		constructor(view: EditorView) {
			this.stopTracking = trackInteractions()
			this.statistics = createEditorStatistics(view.state.doc)
		}
		update(update: ViewUpdate) {
			if (update.docChanged)
				this.statistics.update(update.changes, update.state.doc)
		}
		destroy() {
			this.statistics.dispose()
			this.stopTracking()
		}
	},
)
