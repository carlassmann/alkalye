import { chmod, mkdir, open } from "node:fs/promises"
import { join } from "node:path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as KeyValueStore from "effect/persistence/KeyValueStore"
import * as SqlClient from "effect/sql/SqlClient"
import { sqliteLayer } from "../platform/sqlite"
import { ApplicationError } from "../platform/errors"

let ProfileSchema = Schema.Struct({
	secret: Schema.String,
	name: Schema.String,
})
export class CliProfile extends Context.Service<
	CliProfile,
	Effect.Success<ReturnType<typeof makeProfile>>
>()("cli/Profile") {
	static layer(directory: string) {
		return Layer.effect(CliProfile, makeProfile()).pipe(
			Layer.provideMerge(cliStateLayer(directory)),
		)
	}
}
export function cliStateLayer(directory: string) {
	return Layer.unwrap(
		Effect.tryPromise({
			try: async () => {
				await mkdir(directory, { recursive: true, mode: 0o700 })
				let filename = join(directory, "state.sqlite")
				let file = await open(filename, "a", 0o600)
				await file.close()
				await chmod(filename, 0o600)
				return KeyValueStore.layerSql({ table: "cli_state" }).pipe(
					Layer.provideMerge(sqliteLayer(filename)),
				)
			},
			catch: cause => new ApplicationError({ operation: "cli.state", cause }),
		}),
	)
}
function makeProfile() {
	return Effect.gen(function* () {
		let sql = yield* SqlClient.SqlClient
		let store = KeyValueStore.toSchemaStore(
			yield* KeyValueStore.KeyValueStore,
			ProfileSchema,
		)
		let load = store.get("profile").pipe(Effect.map(Option.getOrUndefined))
		return {
			load,
			require: load.pipe(
				Effect.flatMap(profile =>
					profile
						? Effect.succeed(profile)
						: Effect.fail(
								new ApplicationError({
									operation: "cli.account",
									cause: new Error("Run auth signup or auth login first"),
								}),
							),
				),
			),
			login: (profile: typeof ProfileSchema.Type) =>
				sql.withTransaction(
					Effect.gen(function* () {
						let previous = yield* load
						if (previous && previous.secret !== profile.secret)
							return yield* new ApplicationError({
								operation: "cli.account",
								cause: new Error(
									"A different account exists; auth logout first",
								),
							})
						let saved = {
							secret: profile.secret,
							name: profile.name || previous?.name || "Writer",
						}
						yield* store.set("profile", saved)
						return saved
					}),
				),
			remove: store.remove("profile"),
		}
	})
}
