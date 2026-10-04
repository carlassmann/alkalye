import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { ApplicationError } from "../platform/errors"
import { AgentCredentials } from "./agent-credentials"
import { makeAccountDocuments } from "./account-documents"
import type { AgentAccess } from "../shared/agent-access"
export class AgentDocuments extends Context.Service<
	AgentDocuments,
	Effect.Success<ReturnType<typeof makeDocuments>>
>()("AgentDocuments") {}
export function makeDocuments() {
	return Effect.gen(function* () {
		let credentials = yield* AgentCredentials
		let account = yield* makeAccountDocuments()
		return {
			listDocuments: (token: string) =>
				route(token, access => account.listDocuments(access)),
			getDocument: (token: string, document: string, workspace?: string) =>
				route(token, access =>
					account.getDocument(access, document, workspace),
				),
			createDocument: (
				token: string,
				title: string,
				content: string,
				workspace?: string,
			) =>
				route(token, access =>
					account.createDocument(access, title, content, workspace),
				),
			updateDocument: (
				token: string,
				document: string,
				content: string,
				expected: string,
				workspace?: string,
			) =>
				route(token, access =>
					account.updateDocument(
						access,
						document,
						content,
						expected,
						workspace,
					),
				),
			renameDocument: (
				token: string,
				document: string,
				title: string,
				expected: string,
				workspace?: string,
			) =>
				route(token, access =>
					account.renameDocument(access, document, title, expected, workspace),
				),
			archiveDocument: (
				token: string,
				document: string,
				expected: string,
				workspace?: string,
			) =>
				route(token, access =>
					account.archiveDocument(access, document, expected, workspace),
				),
			listComments: (token: string, document: string, workspace?: string) =>
				route(token, access =>
					account.listComments(access, document, workspace),
				),
			addComment: (
				token: string,
				document: string,
				body: string,
				options: { quote?: string; spaceId?: string } = {},
			) =>
				route(token, access =>
					account.addComment(access, document, body, options),
				),
			replyToComment: (
				token: string,
				document: string,
				comment: string,
				body: string,
				workspace?: string,
			) =>
				route(token, access =>
					account.replyToComment(access, document, comment, body, workspace),
				),
			setCommentResolved: (
				token: string,
				document: string,
				comment: string,
				resolved: boolean,
				workspace?: string,
			) =>
				route(token, access =>
					account.setCommentResolved(
						access,
						document,
						comment,
						resolved,
						workspace,
					),
				),
			renameSpace: (token: string, workspace: string, name: string) =>
				route(token, access => account.renameSpace(access, workspace, name)),
		}
		function route<A, E>(
			token: string,
			native: (access: AgentAccess) => Effect.Effect<A, E>,
		) {
			return Effect.gen(function* () {
				let access = yield* credentials.grant(token)
				if (access.kind === "account") return yield* native(access)
				return yield* new ApplicationError({
					operation: "mcp",
					cause: new Error("Reconnect this agent using account permissions"),
				})
			})
		}
	})
}
