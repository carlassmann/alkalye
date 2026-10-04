import * as Layer from "effect/Layer"
import * as EventLogServerEncrypted from "effect/eventlog/EventLogServerEncrypted"
import * as SqlEventLogServerEncrypted from "effect/eventlog/SqlEventLogServerEncrypted"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as RpcServer from "effect/rpc/RpcServer"
import { sqliteLayer } from "../../src/platform/sqlite"
import { socketServerLayer } from "./bun-socket-server"

export function nativeEventLogRelayLayer() {
	return EventLogServerEncrypted.layer.pipe(
		Layer.provideMerge(SqlEventLogServerEncrypted.layerStorageSubtle()),
		Layer.provide(sqliteLayer(":memory:")),
		Layer.provide(
			RpcServer.layerProtocolSocketServer.pipe(
				Layer.provide(RpcSerialization.layerSchemaBinary()),
			),
		),
		Layer.provideMerge(socketServerLayer()),
	)
}
