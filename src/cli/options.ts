import { Args, Options } from "@effect/cli"
import type * as Option from "effect/Option"

export {
	globalOptions,
	nameOption,
	titleOption,
	roleOption,
	spaceRoleOption,
	linkOption,
	inviteGroupIdOption,
	scopeOption,
	deletedOption,
	offlineOption,
	localOption,
	staleOkOption,
	syncOption,
	passphraseOption,
	passphraseFileOption,
	passphraseStdinOption,
	contentOption,
	contentFileOption,
	bodyOption,
	quoteOption,
	fromOption,
	toOption,
	stdinOption,
	docIdArg,
	commentIdArg,
	spaceIdArg,
}
export type { GlobalArgs }

type GlobalArgs = {
	json: boolean
	verbose: boolean
	quiet: boolean
	server: Option.Option<string>
	syncPeer: Option.Option<string>
	timeout: Option.Option<number>
	home: Option.Option<string>
}

let jsonOption = Options.boolean("json").pipe(
	Options.withDescription("Print machine-readable JSON output."),
)
let verboseOption = Options.boolean("verbose").pipe(
	Options.withDescription("Include extra runtime context in output."),
)
let quietOption = Options.boolean("quiet").pipe(
	Options.withDescription("Suppress output. Exit code only."),
)
let serverOption = Options.optional(Options.text("server")).pipe(
	Options.withDescription(
		"Alkalye deployment URL. Used to discover CLI config and sync peer.",
	),
)
let syncPeerOption = Options.optional(Options.text("sync-peer")).pipe(
	Options.withDescription(
		"Jazz sync peer URL. Defaults to ALKALYE_SYNC_PEER or PUBLIC_JAZZ_SYNC_SERVER.",
	),
)
let timeoutOption = Options.optional(Options.integer("timeout")).pipe(
	Options.withDescription("Sync timeout in milliseconds."),
)
let homeOption = Options.optional(Options.text("home")).pipe(
	Options.withDescription(
		"CLI state directory. Defaults to ALKALYE_CLI_HOME or ~/.alkalye/cli.",
	),
)

let globalOptions = {
	json: jsonOption,
	verbose: verboseOption,
	quiet: quietOption,
	server: serverOption,
	syncPeer: syncPeerOption,
	timeout: timeoutOption,
	home: homeOption,
}

let nameOption = Options.text("name").pipe(
	Options.withDescription("Name to store."),
)
let titleOption = Options.text("title").pipe(
	Options.withDescription("Document title."),
)
let roleOption = Options.choice("role", ["writer", "reader"]).pipe(
	Options.withDescription("Invite role."),
)
let spaceRoleOption = Options.choice("role", [
	"admin",
	"manager",
	"writer",
	"reader",
]).pipe(Options.withDescription("Space collaborator role."))
let linkOption = Options.text("link").pipe(
	Options.withDescription("Invite link to inspect or accept."),
)
let inviteGroupIdOption = Options.text("invite-group-id").pipe(
	Options.withDescription("Invite group ID."),
)
let scopeOption = Options.optional(Options.text("scope")).pipe(
	Options.withDescription("Document scope: personal, all, or space:<id>."),
)
let deletedOption = Options.boolean("deleted").pipe(
	Options.withDescription("Include deleted documents instead of active ones."),
)
let offlineOption = Options.boolean("offline").pipe(
	Options.withDescription(
		"Use cached local data without remote freshness checks.",
	),
)
let localOption = Options.boolean("local").pipe(
	Options.withDescription("Alias for --offline."),
)
let staleOkOption = Options.boolean("stale-ok").pipe(
	Options.withDescription("Allow cached data if remote sync is incomplete."),
)
let syncOption = Options.boolean("sync").pipe(
	Options.withDescription(
		"Compatibility flag; mutations always wait for remote durability.",
	),
)
let passphraseOption = Options.optional(Options.text("passphrase"))
let passphraseFileOption = Options.optional(Options.file("passphrase-file"))
let passphraseStdinOption = Options.boolean("passphrase-stdin").pipe(
	Options.withDescription("Read passphrase from stdin."),
)
let contentOption = Options.optional(Options.text("content"))
let contentFileOption = Options.optional(Options.file("content-file"))
let bodyOption = Options.text("body").pipe(
	Options.withDescription("Comment or reply body."),
)
let quoteOption = Options.optional(Options.text("quote")).pipe(
	Options.withDescription("Quoted document text to comment on."),
)
let fromOption = Options.optional(Options.integer("from")).pipe(
	Options.withDescription("Zero-based comment start offset."),
)
let toOption = Options.optional(Options.integer("to")).pipe(
	Options.withDescription("Zero-based comment end offset."),
)
let stdinOption = Options.boolean("stdin")
let docIdArg = Args.text({ name: "doc-id" }).pipe(
	Args.withDescription("Document ID."),
)
let commentIdArg = Args.text({ name: "comment-id" }).pipe(
	Args.withDescription("Comment thread ID."),
)
let spaceIdArg = Args.text({ name: "space-id" }).pipe(
	Args.withDescription("Space ID."),
)
