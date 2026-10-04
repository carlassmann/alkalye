import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Argument from "effect/cli/Argument"
import * as Layer from "effect/Layer"
import { Cipher } from "../platform/cipher"
import * as Path from "effect/Path"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Stdio from "effect/Stdio"
import * as Stream from "effect/Stream"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import * as CliConfig from "effect/cli/CliConfig"
import * as CliError from "effect/cli/CliError"
import * as GlobalFlag from "effect/cli/GlobalFlag"
import { homedir } from "node:os"
import { ApplicationError } from "../platform/errors"
import { Signatures } from "../platform/signatures"
import { CliProfile } from "./profile"
import { CliDocuments, allowOffline, cliFailure } from "./documents"
import {
	changeMetadata,
	replaceDocumentSource,
} from "../shared/document-metadata"
import * as FileSystem from "effect/FileSystem"
import { cliPlatform } from "./platform"
import { proxyMcp } from "./mcp"
import { IdentifierSchema } from "../shared/model"

export function runNativeCli(args: string[], sensitiveArguments = false) {
	return Command.runWith(commands, {
		version: "0.0.0",
		renderErrors: !sensitiveArguments,
	})(args).pipe(
		Effect.catchIf(
			error =>
				sensitiveArguments &&
				CliError.isCliError(error) &&
				(error._tag !== "ShowHelp" || error.errors.length > 0),
			() =>
				Effect.fail(
					new ApplicationError({
						operation: "cli.parse",
						cause: new Error("Invalid command arguments; use auth --help"),
					}),
				),
		),
		Effect.provide(Layer.mergeAll(cliPlatform, Cipher.live, Signatures.layer)),
		Effect.provide(CliConfig.layer({ builtIns: [GlobalFlag.Help] })),
	)
}
let root = Command.make("alkalye").pipe(
	Command.withSharedFlags({
		home: Flag.String("home").pipe(Flag.withDefault("")),
		server: Flag.String("server").pipe(Flag.withDefault("")),
		scope: Flag.String("scope").pipe(
			Flag.withSchema(
				Schema.String.check(
					Schema.isPattern(/^(?:personal|all|space:[\w:.-]{1,200})?$/),
				),
			),
			Flag.withDefault(""),
		),
		json: Flag.Boolean("json").pipe(
			Flag.withAlias("j"),
			Flag.withDefault(false),
		),
	}),
)
let signup = Command.make(
	"signup",
	{ name: Flag.String("name").pipe(Flag.withDefault("")) },
	config =>
		withStore(
			Effect.gen(function* () {
				let store = yield* CliProfile
				let previous = yield* store.load
				if (previous)
					return yield* error("An account already exists; auth logout first")
				let cipher = yield* Cipher
				let secret = yield* cipher.secret()
				let identity = yield* (yield* Signatures).account(Redacted.make(secret))
				let name = config.name || "Writer"
				yield* store.login({ secret, name })
				yield* Console.log(
					JSON.stringify({
						account: identity.subject,
						name,
						recoveryKey: secret,
					}),
				)
			}),
		),
)
let login = Command.make(
	"login",
	{
		name: Flag.String("name").pipe(Flag.withDefault("")),
		passphrase: Flag.Redacted("passphrase").pipe(
			Flag.withDefault(Redacted.make("")),
		),
		stdin: Flag.Boolean("passphrase-stdin").pipe(Flag.withDefault(false)),
	},
	config =>
		withStore(
			Effect.gen(function* () {
				let store = yield* CliProfile
				let previous = yield* store.load
				let secret = Redacted.value(config.passphrase)
				if (!secret && config.stdin) {
					let stdio = yield* Stdio.Stdio
					if (yield* stdio.stdinIsTerminal)
						return yield* error("Pipe the recovery key into --passphrase-stdin")
					secret = Option.getOrElse(
						yield* stdio.stdin.pipe(
							Stream.decodeText(),
							Stream.splitLines,
							Stream.runHead,
						),
						() => "",
					).trim()
				}
				if (!secret)
					return yield* error("Provide --passphrase-stdin or --passphrase")
				if (previous && previous.secret !== secret)
					return yield* error(
						"A different account already exists; auth logout first",
					)
				let identity = yield* (yield* Signatures).account(Redacted.make(secret))
				let saved = yield* store.login({
					secret,
					name: config.name,
				})
				let name = saved.name
				yield* Console.log(JSON.stringify({ account: identity.subject, name }))
			}),
		),
)
let logout = Command.make("logout", {}, () =>
	withStore(
		Effect.gen(function* () {
			let store = yield* CliProfile
			yield* store.remove
			yield* Console.log("Logged out")
		}),
	),
)
let whoami = Command.make("whoami", {}, () =>
	withStore(
		Effect.gen(function* () {
			let account = yield* signedIn
			yield* Console.log(
				JSON.stringify({
					account: (yield* (yield* Signatures).account(
						Redacted.make(account.secret),
					)).subject,
					name: account.name,
				}),
			)
		}),
	),
)
let passphrase = Command.make("passphrase", {}, () =>
	withStore(
		Effect.gen(function* () {
			let account = yield* signedIn
			yield* Console.log(account.secret)
		}),
	),
)
let auth = Command.make("auth").pipe(
	Command.withSubcommands([signup, login, logout, whoami, passphrase]),
)

let mcp = Command.make("mcp", {}, () =>
	Effect.gen(function* () {
		let settings = yield* commandSettings
		yield* proxyMcp(settings.server)
	}),
)
let sync = Command.make("sync", {}, () =>
	withDocuments(
		Effect.gen(function* () {
			yield* (yield* CliDocuments).synchronize
			yield* Console.log("Synchronized")
		}),
	),
)
let document = Command.make("doc")
let documentList = Command.make("list", {}, () =>
	withDocuments(
		Effect.gen(function* () {
			let flags = yield* root
			yield* Console.log(
				JSON.stringify(yield* (yield* CliDocuments).list(flags.scope), null, 2),
			)
		}),
	),
)
function readCommand(mode: "get" | "content" | "history" | "undo" | "redo") {
	return Command.make(mode, { id: documentIdentifier() }, config =>
		withDocuments(
			Effect.gen(function* () {
				let session = yield* (yield* CliDocuments).open(config.id)
				yield* allowOffline(session.sync)
				if (mode === "undo" || mode === "redo") {
					yield* session[mode]()
					yield* allowOffline(session.sync)
				} else if (mode === "history")
					yield* Console.log(
						JSON.stringify(yield* session.historyPage(), null, 2),
					)
				else {
					let record = session.replica
						.documents("")
						.find(doc => doc.id === config.id)
					if (!record) return yield* cliFailure("Document not found")
					yield* Console.log(
						mode === "content"
							? record.content
							: JSON.stringify(record, null, 2),
					)
				}
			}),
		),
	)
}
function documentInputFlags() {
	return {
		file: Flag.String("file").pipe(
			Flag.withAlias("content-file"),
			Flag.optional,
		),
		stdin: Flag.Boolean("stdin").pipe(Flag.withDefault(false)),
		sync: Flag.Boolean("sync").pipe(Flag.withDefault(false)),
		source: Flag.String("source").pipe(Flag.optional),
		content: Flag.String("content").pipe(Flag.optional),
	}
}
function documentIdentifier() {
	return Argument.String("documentId").pipe(
		Argument.withSchema(IdentifierSchema),
	)
}
let documentCreate = Command.make(
	"create",
	{
		...documentInputFlags(),
		title: Flag.String("title").pipe(Flag.withDefault("")),
	},
	config =>
		withDocuments(
			Effect.gen(function* () {
				let documents = yield* CliDocuments
				let flags = yield* root
				let source = yield* readContent(config)
				let workspace = flags.scope.startsWith("space:")
					? flags.scope.slice(6)
					: undefined
				let created = yield* documents.create(source, config.title, workspace)
				yield* Console.log(JSON.stringify({ id: created.id }))
				if (config.sync) yield* created.session.sync
				else yield* allowOffline(created.session.sync)
			}),
		),
)
let documentUpdate = Command.make(
	"update",
	{ ...documentInputFlags(), id: documentIdentifier() },
	config =>
		withDocuments(
			Effect.gen(function* () {
				let session = yield* (yield* CliDocuments).open(config.id)
				yield* allowOffline(session.sync)
				let source = yield* readContent(config, true)
				yield* session.change("Update document", draft =>
					replaceDocumentSource(draft, config.id, source),
				)
				if (config.sync) yield* session.sync
				else yield* allowOffline(session.sync)
			}),
		),
)
let documentRename = Command.make(
	"rename",
	{
		id: documentIdentifier(),
		name: Argument.String("title").pipe(Argument.withDefault("")),
		title: Flag.String("title").pipe(Flag.withDefault("")),
	},
	config =>
		withDocuments(
			Effect.gen(function* () {
				let session = yield* (yield* CliDocuments).open(config.id)
				yield* allowOffline(session.sync)
				yield* session.change("Rename document", draft =>
					changeMetadata(draft, config.id, {
						title: config.title || config.name,
					}),
				)
				yield* allowOffline(session.sync)
			}),
		),
)
function documentChangeCommand(mode: "delete" | "restore") {
	return Command.make(mode, { id: documentIdentifier() }, config =>
		withDocuments(
			Effect.gen(function* () {
				let session = yield* (yield* CliDocuments).open(config.id)
				yield* allowOffline(session.sync)
				yield* session.change(
					mode === "delete" ? "Archive document" : "Restore document",
					draft =>
						changeMetadata(draft, config.id, { archived: mode === "delete" }),
				)
				yield* allowOffline(session.sync)
			}),
		),
	)
}
let documentCommands = document.pipe(
	Command.withSubcommands([
		documentList,
		readCommand("get"),
		readCommand("content"),
		documentCreate,
		documentUpdate,
		documentRename,
		documentChangeCommand("delete"),
		documentChangeCommand("restore"),
		readCommand("history"),
		readCommand("undo"),
		readCommand("redo"),
	]),
)
function withDocuments<A, E, R>(task: Effect.Effect<A, E, R | CliDocuments>) {
	return Effect.gen(function* () {
		let settings = yield* commandSettings
		return yield* task.pipe(
			Effect.scoped,
			Effect.provide(CliDocuments.layer(settings.directory, settings.server)),
		)
	})
}
function readContent(
	input: {
		file: Option.Option<string>
		source: Option.Option<string>
		content: Option.Option<string>
		stdin: boolean
	},
	required = false,
) {
	return Effect.gen(function* () {
		let file =
			Option.getOrElse(input.file, () => "") ||
			Option.getOrElse(input.source, () => "")
		if (file) return yield* (yield* FileSystem.FileSystem).readFileString(file)
		if (Option.isSome(input.content)) return input.content.value
		if (input.stdin) {
			let stdio = yield* Stdio.Stdio
			if (yield* stdio.stdinIsTerminal)
				return yield* cliFailure("Pipe content into --stdin")
			return yield* stdio.stdin.pipe(Stream.decodeText(), Stream.mkString)
		}
		if (required)
			return yield* cliFailure("Provide --content, --file, or --stdin")
		return ""
	})
}
let commands = root.pipe(
	Command.withSubcommands([auth, mcp, sync, documentCommands]),
)
let commandSettings = Effect.gen(function* () {
	let flags = yield* root
	let path = yield* Path.Path
	let fallback = path.resolve(homedir(), ".config/alkalye-native")
	let directory =
		flags.home ||
		(yield* Config.String("ALKALYE_CLI_HOME").pipe(
			Config.withDefault(fallback),
			Config.map(value => value || fallback),
		))
	let server =
		flags.server ||
		(yield* Config.String("ALKALYE_SERVER").pipe(
			Config.withDefault("http://127.0.0.1:3000"),
			Config.map(value => value || "http://127.0.0.1:3000"),
		))
	return { directory, server }
})
let signedIn = Effect.gen(function* () {
	let store = yield* CliProfile
	let account = yield* store.load
	if (!account)
		return yield* error("Run alkalye auth signup or auth login first")
	return account
})

function withStore<A, E, R>(task: Effect.Effect<A, E, R | CliProfile>) {
	return Effect.gen(function* () {
		let settings = yield* commandSettings
		return yield* task.pipe(
			Effect.provide(CliProfile.layer(settings.directory)),
		)
	})
}

function error(message: string) {
	return new ApplicationError({
		operation: "cli.auth",
		cause: new Error(message),
	})
}
