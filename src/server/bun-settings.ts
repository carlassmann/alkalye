import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { chmod, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { build } from "../../build"
import { promise } from "../platform/effects"
import { Cipher } from "../platform/cipher"
import { livePollWait } from "../shared/document-live"

import { RelaySettings, RelaySecrets } from "./settings"
import type { ServerOptions } from "./settings"

export function bunSettingsLayer(options: ServerOptions = {}) {
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
				livePollWait: Math.max(
					1,
					Math.min(options.livePollWait ?? livePollWait, livePollWait),
				),
				resetLog,
			}
		}),
	)
}

export let bunSecretsLayer = Layer.effect(
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
			masterKey: yield* promise("master key read", () => Bun.file(path).text()),
		}
	}),
)
