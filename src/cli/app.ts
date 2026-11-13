import { runCommand, executeCommand } from "@/cli/runtime"
import { Command, Options } from "@effect/cli"
import { version as packageVersion } from "@/cli/version"
import { descriptions } from "@/cli/help"

import { docAssetCommand } from "@/cli/assets"
import { docCommentCommand } from "@/cli/doc-comments"
import { docExportCommand } from "@/cli/export"
import { themeCommand } from "@/cli/themes"

import {
	contentFileOption,
	contentOption,
	deletedOption,
	docIdArg,
	globalOptions,
	inviteGroupIdOption,
	linkOption,
	localOption,
	nameOption,
	offlineOption,
	passphraseFileOption,
	passphraseOption,
	passphraseStdinOption,
	roleOption,
	scopeOption,
	spaceIdArg,
	spaceRoleOption,
	staleOkOption,
	stdinOption,
	syncOption,
	titleOption,
} from "@/cli/options"

export { cli }

let authSignup = Command.make(
	"signup",
	{
		...globalOptions,
		name: Options.optional(nameOption),
		passphrase: passphraseOption,
		passphraseFile: passphraseFileOption,
		passphraseStdin: passphraseStdinOption,
	},
	args =>
		runCommand("auth.signup", args, config =>
			executeCommand("auth.signup", args, config),
		),
)

let authLogin = Command.make(
	"login",
	{
		...globalOptions,
		passphrase: passphraseOption,
		passphraseFile: passphraseFileOption,
		passphraseStdin: passphraseStdinOption,
	},
	args =>
		runCommand("auth.login", args, config =>
			executeCommand("auth.login", args, config),
		),
)

let authLogout = Command.make("logout", globalOptions, args =>
	runCommand("auth.logout", args, config =>
		executeCommand("auth.logout", args, config),
	),
)

let authWhoami = Command.make("whoami", globalOptions, args =>
	runCommand("auth.whoami", args, config =>
		executeCommand("auth.whoami", args, config),
	),
)

let authPassphrase = Command.make("passphrase", globalOptions, args =>
	runCommand("auth.passphrase", args, config =>
		executeCommand("auth.passphrase", args, config),
	),
)

let authCommand = Command.make("auth").pipe(
	Command.withDescription(descriptions.auth),
	Command.withSubcommands([
		authSignup,
		authLogin,
		authLogout,
		authWhoami,
		authPassphrase,
	]),
)

let accountShow = Command.make("show", globalOptions, args =>
	runCommand("account.show", args, config =>
		executeCommand("account.show", args, config),
	),
)

let accountRename = Command.make(
	"rename",
	{
		...globalOptions,
		name: nameOption,
	},
	args =>
		runCommand("account.rename", args, config =>
			executeCommand("account.rename", args, config),
		),
)

let accountCommand = Command.make("account").pipe(
	Command.withDescription(descriptions.account),
	Command.withSubcommands([accountShow, accountRename]),
)

let syncFlush = Command.make("flush", globalOptions, args =>
	runCommand("sync.flush", args, config =>
		executeCommand("sync.flush", args, config),
	),
)

let syncStatus = Command.make("status", globalOptions, args =>
	runCommand("sync.status", args, config =>
		executeCommand("sync.status", args, config),
	),
)

let syncCommand = Command.make("sync").pipe(
	Command.withDescription(descriptions.sync),
	Command.withSubcommands([syncFlush, syncStatus]),
)

let docList = Command.make(
	"list",
	{
		...globalOptions,
		scope: scopeOption,
		deleted: deletedOption,
	},
	args =>
		runCommand("doc.list", args, config =>
			executeCommand("doc.list", args, config),
		),
)

let docGet = Command.make(
	"get",
	{
		...globalOptions,
		docId: docIdArg,
		offline: offlineOption,
		local: localOption,
		staleOk: staleOkOption,
	},
	args =>
		runCommand("doc.get", args, config =>
			executeCommand("doc.get", args, config),
		),
)

let docContent = Command.make(
	"content",
	{
		...globalOptions,
		docId: docIdArg,
		offline: offlineOption,
		local: localOption,
		staleOk: staleOkOption,
	},
	args =>
		runCommand("doc.content", args, config =>
			executeCommand("doc.content", args, config),
		),
)

let docCreate = Command.make(
	"create",
	{
		...globalOptions,
		scope: scopeOption,
		content: contentOption,
		contentFile: contentFileOption,
		stdin: stdinOption,
		sync: syncOption,
	},
	args =>
		runCommand("doc.create", args, config =>
			executeCommand("doc.create", args, config),
		),
)

let docUpdate = Command.make(
	"update",
	{
		...globalOptions,
		docId: docIdArg,
		content: contentOption,
		contentFile: contentFileOption,
		stdin: stdinOption,
		sync: syncOption,
	},
	args =>
		runCommand("doc.update", args, config =>
			executeCommand("doc.update", args, config),
		),
)

let docRename = Command.make(
	"rename",
	{
		...globalOptions,
		docId: docIdArg,
		title: titleOption,
	},
	args =>
		runCommand("doc.rename", args, config =>
			executeCommand("doc.rename", args, config),
		),
)

let docMove = Command.make(
	"move",
	{
		...globalOptions,
		docId: docIdArg,
		scope: Options.text("scope").pipe(
			Options.withDescription("Destination: personal or space:<id>."),
		),
	},
	args =>
		runCommand("doc.move", args, config =>
			executeCommand("doc.move", args, config),
		),
)

let docDelete = Command.make(
	"delete",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.delete", args, config =>
			executeCommand("doc.delete", args, config),
		),
)

let docRestore = Command.make(
	"restore",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.restore", args, config =>
			executeCommand("doc.restore", args, config),
		),
)

let docPurge = Command.make(
	"purge",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.purge", args, config =>
			executeCommand("doc.purge", args, config),
		),
)

let docLeave = Command.make(
	"leave",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.leave", args, config =>
			executeCommand("doc.leave", args, config),
		),
)

let docShareCreate = Command.make(
	"create",
	{
		...globalOptions,
		docId: docIdArg,
		role: roleOption,
	},
	args =>
		runCommand("doc.share.create", args, config =>
			executeCommand("doc.share.create", args, config),
		),
)

let docShareRevoke = Command.make(
	"revoke",
	{
		...globalOptions,
		docId: docIdArg,
		inviteGroupId: inviteGroupIdOption,
	},
	args =>
		runCommand("doc.share.revoke", args, config =>
			executeCommand("doc.share.revoke", args, config),
		),
)

let docShareList = Command.make(
	"list",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.share.list", args, config =>
			executeCommand("doc.share.list", args, config),
		),
)

let docShareRole = Command.make(
	"role",
	{
		...globalOptions,
		docId: docIdArg,
		inviteGroupId: inviteGroupIdOption,
		role: roleOption,
	},
	args =>
		runCommand("doc.share.role", args, config =>
			executeCommand("doc.share.role", args, config),
		),
)

let docShareCommand = Command.make("share").pipe(
	Command.withDescription(descriptions.docShare),
	Command.withSubcommands([
		docShareCreate,
		docShareRevoke,
		docShareList,
		docShareRole,
	]),
)

let docPublicEnable = Command.make(
	"enable",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.public.enable", args, config =>
			executeCommand("doc.public.enable", args, config),
		),
)

let docPublicDisable = Command.make(
	"disable",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.public.disable", args, config =>
			executeCommand("doc.public.disable", args, config),
		),
)

let docPublicLink = Command.make(
	"link",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.public.link", args, config =>
			executeCommand("doc.public.link", args, config),
		),
)

let docPublicCommand = Command.make("public").pipe(
	Command.withDescription(descriptions.docPublic),
	Command.withSubcommands([docPublicEnable, docPublicDisable, docPublicLink]),
)

let docCommand = Command.make("doc").pipe(
	Command.withDescription(descriptions.doc),
	Command.withSubcommands([
		docList,
		docGet,
		docContent,
		docCreate,
		docUpdate,
		docRename,
		docMove,
		docDelete,
		docRestore,
		docPurge,
		docLeave,
		docExportCommand,
		docCommentCommand,
		docAssetCommand,
		docShareCommand,
		docPublicCommand,
	]),
)

let spaceList = Command.make("list", globalOptions, args =>
	runCommand("space.list", args, config =>
		executeCommand("space.list", args, config),
	),
)

let spaceGet = Command.make(
	"get",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.get", args, config =>
			executeCommand("space.get", args, config),
		),
)

let spaceMembers = Command.make(
	"members",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.members", args, config =>
			executeCommand("space.members", args, config),
		),
)

let spaceDocs = Command.make(
	"docs",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.docs", args, config =>
			executeCommand("space.docs", args, config),
		),
)

let spaceCreate = Command.make(
	"create",
	{
		...globalOptions,
		name: nameOption,
	},
	args =>
		runCommand("space.create", args, config =>
			executeCommand("space.create", args, config),
		),
)

let spaceRename = Command.make(
	"rename",
	{
		...globalOptions,
		spaceId: spaceIdArg,
		name: nameOption,
	},
	args =>
		runCommand("space.rename", args, config =>
			executeCommand("space.rename", args, config),
		),
)

let spaceDelete = Command.make(
	"delete",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.delete", args, config =>
			executeCommand("space.delete", args, config),
		),
)

let spaceLeave = Command.make(
	"leave",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.leave", args, config =>
			executeCommand("space.leave", args, config),
		),
)

let spaceShareCreate = Command.make(
	"create",
	{
		...globalOptions,
		spaceId: spaceIdArg,
		role: spaceRoleOption,
	},
	args =>
		runCommand("space.share.create", args, config =>
			executeCommand("space.share.create", args, config),
		),
)

let spaceShareRevoke = Command.make(
	"revoke",
	{
		...globalOptions,
		spaceId: spaceIdArg,
		inviteGroupId: inviteGroupIdOption,
	},
	args =>
		runCommand("space.share.revoke", args, config =>
			executeCommand("space.share.revoke", args, config),
		),
)

let spaceShareList = Command.make(
	"list",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.share.list", args, config =>
			executeCommand("space.share.list", args, config),
		),
)

let spaceShareRole = Command.make(
	"role",
	{
		...globalOptions,
		spaceId: spaceIdArg,
		inviteGroupId: inviteGroupIdOption,
		role: spaceRoleOption,
	},
	args =>
		runCommand("space.share.role", args, config =>
			executeCommand("space.share.role", args, config),
		),
)

let spaceShareCommand = Command.make("share").pipe(
	Command.withDescription(descriptions.spaceShare),
	Command.withSubcommands([
		spaceShareCreate,
		spaceShareRevoke,
		spaceShareList,
		spaceShareRole,
	]),
)

let spacePublicEnable = Command.make(
	"enable",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.public.enable", args, config =>
			executeCommand("space.public.enable", args, config),
		),
)

let spacePublicDisable = Command.make(
	"disable",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.public.disable", args, config =>
			executeCommand("space.public.disable", args, config),
		),
)

let spacePublicLink = Command.make(
	"link",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.public.link", args, config =>
			executeCommand("space.public.link", args, config),
		),
)

let spacePublicCommand = Command.make("public").pipe(
	Command.withDescription(descriptions.spacePublic),
	Command.withSubcommands([
		spacePublicEnable,
		spacePublicDisable,
		spacePublicLink,
	]),
)

let spaceCommand = Command.make("space").pipe(
	Command.withDescription(descriptions.space),
	Command.withSubcommands([
		spaceList,
		spaceGet,
		spaceMembers,
		spaceDocs,
		spaceCreate,
		spaceRename,
		spaceDelete,
		spaceLeave,
		spaceShareCommand,
		spacePublicCommand,
	]),
)

let inviteInspect = Command.make(
	"inspect",
	{
		...globalOptions,
		link: linkOption,
	},
	args =>
		runCommand("invite.inspect", args, config =>
			executeCommand("invite.inspect", args, config),
		),
)

let inviteAccept = Command.make(
	"accept",
	{
		...globalOptions,
		link: linkOption,
		sync: syncOption,
	},
	args =>
		runCommand("invite.accept", args, config =>
			executeCommand("invite.accept", args, config),
		),
)

let inviteCommand = Command.make("invite").pipe(
	Command.withDescription(descriptions.invite),
	Command.withSubcommands([inviteInspect, inviteAccept]),
)

let root = Command.make("alkalye").pipe(
	Command.withDescription(
		"Local-first CLI for auth, documents, spaces, and sharing.",
	),
	Command.withSubcommands([
		authCommand,
		accountCommand,
		docCommand,
		themeCommand,
		spaceCommand,
		inviteCommand,
		syncCommand,
	]),
)

let cli = Command.run(root, {
	name: "alkalye",
	version: packageVersion,
})
