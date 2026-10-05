import * as Config from "effect/Config"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { chmod, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { build } from "../../build"
import { promise } from "../platform/effects"
import { Cipher } from "../platform/cipher"

export interface ServerOptions {
	port?: number
	hostname?: string
	data?: string
	assets?: string
	build?: boolean
	development?: boolean
	publicOrigin?: string
}
export interface Settings {
	port: number
	hostname: string
	data: string
	assets: string
	build: boolean
	development: boolean
	publicOrigin: string | undefined
	resetLog: boolean
}
export class RelaySettings extends Context.Service<RelaySettings, Settings>()(
	"RelaySettings",
) {
	static layer(options: ServerOptions = {}) {
		return Layer.effect(
			RelaySettings,
			Effect.gen(function* () {
				let port =
					options.port ??
					(yield* Config.Port("PORT").pipe(Config.withDefault(3000)))
				let hostname =
					options.hostname ??
					(yield* Config.String("HOST").pipe(Config.withDefault("127.0.0.1")))
				let publicOrigin = yield* Config.option(Config.URL("PUBLIC_ORIGIN"))
				let environment = yield* Config.String("NODE_ENV").pipe(
					Config.withDefault("development"),
				)
				let resetLog = yield* Config.Boolean("ALKALYE_RESET_LOG").pipe(
					Config.withDefault(false),
				)
				return {
					port,
					hostname,
					data: options.data ?? resolve(import.meta.dir, "../../.data"),
					assets: resolve(
						options.assets ?? resolve(import.meta.dir, "../../dist"),
					),
					build: options.build !== false,
					development: options.development ?? environment !== "production",
					publicOrigin:
						options.publicOrigin ??
						Option.getOrUndefined(Option.map(publicOrigin, url => url.origin)),
					resetLog,
				}
			}),
		)
	}
}
export class RelaySecrets extends Context.Service<
	RelaySecrets,
	{ masterKey: string }
>()("RelaySecrets") {
	static layer = Layer.effect(
		RelaySecrets,
		Effect.gen(function* () {
			let settings = yield* RelaySettings
			let cipher = yield* Cipher
			if (settings.build)
				yield* promise("build", () =>
					build(settings.assets, settings.development),
				)
			yield* promise("data directory", () =>
				mkdir(settings.data, { recursive: true, mode: 0o700 }),
			)
			let path = resolve(settings.data, "master.key")
			let masterFile = Bun.file(path)
			if (!(yield* promise("master key exists", () => masterFile.exists()))) {
				let secret = yield* cipher.secret()
				yield* promise("master key create", () => Bun.write(masterFile, secret))
				yield* promise("master key permissions", () => chmod(path, 0o600))
			}
			return {
				masterKey: yield* promise("master key read", () =>
					Bun.file(path).text(),
				),
			}
		}),
	)
}
