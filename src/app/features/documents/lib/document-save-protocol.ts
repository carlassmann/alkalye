export type DocumentContentPatch = {
	from: number
	to: number
	inserted: string
}

export type DocumentSaveWorkerRequest =
	| {
			type: "diff"
			requestId: number
			oldEntries: string[]
			baseContent: string
			newContent: string
	  }
	| { type: "close" }

export type DocumentSaveWorkerResponse =
	| {
			type: "diffed"
			requestId: number
			content: string
			patches: DocumentContentPatch[]
	  }
	| { type: "failed"; requestId: number; message: string }
	| { type: "closed" }
