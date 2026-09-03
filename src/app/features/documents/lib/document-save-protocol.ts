import type { AgentSecret } from "cojson"

export type DocumentSaveWorkerRequest =
	| {
			type: "initialize"
			accountId: string
			accountSecret: AgentSecret
			documentId: string
	  }
	| { type: "save"; requestId: number; content: string }
	| { type: "close" }

export type DocumentSaveWorkerResponse =
	| { type: "ready" }
	| { type: "saved"; requestId: number }
	| { type: "failed"; requestId?: number; message: string }
	| { type: "closed" }
