import * as Layer from "effect/Layer"
import { sqliteLayer } from "../platform/sqlite"
import { DocumentStore, WorkspaceStore } from "./document-store"
import { sessionsSqlLayer } from "./sessions"
import { agentStoreSqlLayer } from "./agent-store"
import { emailAuthenticationSqlLayer } from "./email-authentication"

export function documentStoreLayer(filename: string) {
	return DocumentStore.live.pipe(Layer.provide(sqliteLayer(filename)))
}
export function workspaceStoreLayer(filename: string) {
	return WorkspaceStore.live.pipe(Layer.provide(sqliteLayer(filename)))
}
export function sessionsLayer(filename: string) {
	return sessionsSqlLayer().pipe(Layer.provide(sqliteLayer(filename)))
}
export function agentStoreLayer(filename: string) {
	return agentStoreSqlLayer().pipe(Layer.provide(sqliteLayer(filename)))
}
export function emailAuthenticationLayer(filename: string) {
	return emailAuthenticationSqlLayer().pipe(
		Layer.provide(sqliteLayer(filename)),
	)
}
