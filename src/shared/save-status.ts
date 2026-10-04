export interface SaveState {
	unsaved: boolean
	pending: boolean
	saveFailed: boolean
	syncFailed: boolean
	file?: { status: string }
}
export interface SaveIndicator {
	text: string
	state: "quiet" | "busy" | "notice" | "error"
}
export function saveIndicator(value: SaveState): SaveIndicator {
	if (value.saveFailed)
		return { text: "Could not save on this device", state: "error" }
	if (value.unsaved) return { text: "Saving…", state: "busy" }
	if (value.file) {
		switch (value.file.status) {
			case "saved":
				return { text: "Saved to disk", state: "quiet" }
			case "saving":
				return { text: "Saving to disk…", state: "busy" }
			case "conflict":
				return { text: "Changed on disk — choose a version", state: "error" }
			case "reconnect":
				return { text: "Allow folder access to save", state: "error" }
			default:
				return { text: "Could not save to disk", state: "error" }
		}
	}
	if (value.syncFailed)
		return {
			text: "Saved on this device; sync needs attention",
			state: "error",
		}
	if (value.pending) return { text: "Saved on this device", state: "notice" }
	return { text: "Saved", state: "quiet" }
}
