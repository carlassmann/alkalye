import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Redacted from "effect/Redacted"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { mcpEndpoint, metadataHeaders } from "./mcp"
import * as McpSchema from "effect/ai/McpSchema"
import { ApplicationError } from "../platform/errors"

let document = Schema.Struct({
	documentId: Schema.String,
	spaceId: Schema.String,
	title: Schema.String,
	updatedAt: Schema.NullOr(Schema.String),
	revision: Schema.String,
})
let listing = Schema.Struct({
	personal: Schema.Array(document),
	spaces: Schema.Array(
		Schema.Struct({
			spaceId: Schema.String,
			name: Schema.String,
			documents: Schema.Array(document),
		}),
	),
})
let reading = Schema.Struct({
	documentId: Schema.String,
	spaceId: Schema.String,
	title: Schema.optionalKey(Schema.String),
	content: Schema.String,
	revision: Schema.String,
})
let mutation = Schema.Struct({
	documentId: Schema.String,
	revision: Schema.String,
	success: Schema.Literal(true),
})
let reply = Schema.Struct({
	jsonrpc: Schema.Literal("2.0"),
	id: Schema.Literal(1),
	result: McpSchema.CallToolResult,
})

export function apiDocuments(
	origin: string,
	key: Redacted.Redacted<string>,
	scope: string,
) {
	let workspace = scope.startsWith("space:") ? scope.slice(6) : undefined
	function call<T>(
		name: string,
		args: Schema.JsonObject,
		result: Schema.Decoder<T>,
	) {
		return Effect.scoped(
			Effect.gen(function* () {
				let endpoint = yield* mcpEndpoint(origin)
				let http = yield* HttpClient.HttpClient
				let response = yield* http.execute(
					HttpClientRequest.post(endpoint).pipe(
						HttpClientRequest.bearerToken(key),
						HttpClientRequest.setHeaders({
							Accept: "application/json, text/event-stream",
							...metadataHeaders({
								jsonrpc: "2.0",
								id: 1,
								method: "tools/call",
								params: {
									name,
									_meta: {
										"io.modelcontextprotocol/protocolVersion": "2026-07-28",
									},
								},
							}),
						}),
						HttpClientRequest.bodyText(
							JSON.stringify({
								jsonrpc: "2.0",
								id: 1,
								method: "tools/call",
								params: {
									name,
									arguments: args,
									_meta: {
										"io.modelcontextprotocol/protocolVersion": "2026-07-28",
										"io.modelcontextprotocol/clientCapabilities": {},
									},
								},
							}),
							"application/json",
						),
					),
				)
				if (response.status !== 200)
					return yield* apiFailure(
						response.status === 401
							? "API key is invalid or revoked"
							: `API request failed (HTTP ${response.status})`,
					)
				let decoded = yield* Schema.decodeUnknownEffect(reply)(
					yield* response.json,
				)
				if (decoded.result.isError) {
					let message = decoded.result.content
						.filter(block => block.type === "text")
						.map(block => block.text)
						.join("\n")
					return yield* apiFailure(message || "API request was refused")
				}
				return yield* Schema.decodeUnknownEffect(result)(
					decoded.result.structuredContent,
				)
			}),
		).pipe(
			Effect.timeout("20 seconds"),
			Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
		)
	}
	let documents = call("list_documents", {}, listing)
	function read(id: string) {
		return Effect.gen(function* () {
			let target = workspace
			if (scope === "personal") {
				let listed = yield* documents
				let personal = listed.personal.find(
					document => document.documentId === id,
				)
				if (!personal)
					return yield* apiFailure(
						"Document is outside your Personal workspace",
					)
				target = personal.spaceId
			}
			return yield* call(
				"get_document",
				{ documentId: id, ...(target ? { spaceId: target } : {}) },
				reading,
			)
		})
	}
	return {
		read,
		list: documents.pipe(
			Effect.map(value =>
				scope === "personal"
					? { ...value, spaces: [] }
					: workspace
						? {
								personal: [],
								spaces: value.spaces.filter(
									space => space.spaceId === workspace,
								),
							}
						: value,
			),
		),
		create: (content: string, title: string) =>
			call(
				"create_document",
				{ content, title, ...(workspace ? { spaceId: workspace } : {}) },
				mutation,
			),
		update: (id: string, content: string, expected: string) =>
			Effect.gen(function* () {
				let current = yield* read(id)
				return yield* call(
					"update_document",
					{
						documentId: id,
						spaceId: current.spaceId,
						content,
						expectedRevision: expected || current.revision,
					},
					mutation,
				)
			}),
		rename: (id: string, title: string) =>
			Effect.gen(function* () {
				let current = yield* read(id)
				return yield* call(
					"rename_document",
					{
						documentId: id,
						spaceId: current.spaceId,
						title,
						expectedRevision: current.revision,
					},
					mutation,
				)
			}),
		archive: (id: string) =>
			Effect.gen(function* () {
				let current = yield* read(id)
				return yield* call(
					"archive_document",
					{
						documentId: id,
						spaceId: current.spaceId,
						expectedRevision: current.revision,
					},
					mutation,
				)
			}),
	}
}
export function apiFailure(message: string) {
	return new ApplicationError({
		operation: "cli.api",
		cause: new Error(message),
	})
}
