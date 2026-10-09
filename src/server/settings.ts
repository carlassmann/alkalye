import * as Context from "effect/Context"

export interface ServerOptions {
	port?: number
	hostname?: string
	data?: string
	assets?: string
	build?: boolean
	development?: boolean
	publicOrigin?: string
	livePollWait?: number
}
export interface Settings {
	port: number
	hostname: string
	data: string
	assets: string
	build: boolean
	development: boolean
	publicOrigin: string | undefined
	livePollWait: number
	resetLog: boolean
}
export class RelaySettings extends Context.Service<RelaySettings, Settings>()(
	"RelaySettings",
) {}

export class RelaySecrets extends Context.Service<
	RelaySecrets,
	{ masterKey: string }
>()("RelaySecrets") {}
