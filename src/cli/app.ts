import { Command, Options } from "@effect/cli"
import { version as packageVersion } from "@/cli/version"
import { descriptions } from "@/cli/help"
import {
	createPersonalDocument,
	deletePersonalDocument,
	permanentlyDeletePersonalDocument,
	restorePersonalDocument,
} from "@/app/features/documents"
import {
	acceptDocumentInvite,
	changeCollaboratorRole,
	createDocumentInvite,
	getDocumentOwner,
	leavePersonalDocument,
	listCollaborators,
	makeDocumentPrivate,
	makeDocumentPublic,
	parseInviteLink,
	revokeDocumentInvite,
	canEdit,
} from "@/app/features/sharing"
import { syncDocumentMetadata } from "@/app/features/documents"
import {
	acceptSpaceInvite,
	changeSpaceCollaboratorRole,
	createSpaceInvite,
	getSpaceGroup,
	getSpaceOwner,
	isSpaceMember,
	isSpacePublic,
	leaveSpace,
	listSpaceCollaborators,
	listSpaceMembers,
	makeSpacePrivate,
	makeSpacePublic,
	parseSpaceInviteLink,
	permanentlyDeleteSpace,
	revokeSpaceInvite,
} from "@/app/features/spaces"
import { getDocumentTitle } from "@/app/features/documents"
import { moveDocumentToSpace } from "@/app/features/documents"
import {
	buildDocumentPublicLink,
	buildSpacePublicLink,
} from "@/app/features/sharing"
import { setDocumentTitle } from "@/cli/document-title"
import { docCommentCommand } from "@/cli/doc-comments"
import { CliUsageError, PermissionError } from "@/cli/errors"
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
import { parseDocScope } from "@/cli/parse"
import {
	createAuthenticatedJazz,
	generatePassphrase,
	getPassphraseFromStorage,
	getStoredCredentials,
	logInWithPassphrase,
	logOut,
	signUpWithPassphrase,
} from "@/cli/jazz"
import { printContent } from "@/cli/output"
import {
	createSpaceScopedDoc,
	findDocument,
	findSpace,
	getOptionString,
	inspectInvite,
	listDocs,
	loadAccount,
	loadDocumentContent,
	loadDocumentForMutation,
	loadDocumentMetadata,
	replaceCliDocumentContent,
	readRequiredContentInput,
	readRequiredSecretInput,
	readSecretInput,
	runCommand,
	summarizeDoc,
	syncMutation,
} from "@/cli/runtime"
import { createSpace, getRandomWriterName } from "@/schema"

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
		runCommand("auth.signup", args, async config => {
			let name = getOptionString(args.name) ?? getRandomWriterName()
			let passphrase =
				(await readSecretInput(
					args.passphrase,
					args.passphraseFile,
					args.passphraseStdin,
				)) ?? (await generatePassphrase())
			let jazz = await signUpWithPassphrase({ config, name, passphrase })
			let account = await jazz.account.$jazz.ensureLoaded({
				resolve: { profile: true },
			})
			await jazz.account.$jazz.waitForAllCoValuesSync({
				timeout: config.timeoutMs,
			})
			await jazz.done()
			return {
				accountId: account.$jazz.id,
				name: account.profile.name,
				passphrase,
			}
		}),
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
		runCommand("auth.login", args, async config => {
			let passphrase = await readRequiredSecretInput(
				args.passphrase,
				args.passphraseFile,
				args.passphraseStdin,
			)
			let jazz = await logInWithPassphrase({ config, passphrase })
			let account = await jazz.account.$jazz.ensureLoaded({
				resolve: { profile: true },
			})
			await jazz.done()
			return {
				accountId: account.$jazz.id,
				name: account.profile.name,
				provider: "passphrase",
				syncPeer: config.syncPeer,
			}
		}),
)

let authLogout = Command.make("logout", globalOptions, args =>
	runCommand("auth.logout", args, async config => {
		await logOut(config)
		return { status: "logged out" }
	}),
)

let authWhoami = Command.make("whoami", globalOptions, args =>
	runCommand("auth.whoami", args, async config => {
		let jazz = await createAuthenticatedJazz(config)
		let credentials = await jazz.authSecretStorage.get()
		let account = await jazz.account.$jazz.ensureLoaded({
			resolve: { profile: true },
		})
		await jazz.done()
		return {
			accountId: account.$jazz.id,
			name: account.profile.name,
			provider: credentials?.provider ?? "unknown",
			syncPeer: config.syncPeer,
		}
	}),
)

let authPassphrase = Command.make("passphrase", globalOptions, args =>
	runCommand("auth.passphrase", args, async config => {
		let passphrase = await getPassphraseFromStorage(config)
		return { passphrase }
	}),
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
	runCommand("account.show", args, async config => {
		let jazz = await createAuthenticatedJazz(config)
		let credentials = await jazz.authSecretStorage.get()
		let account = await loadAccount(jazz, config.timeoutMs)
		let personalDocs = account.root.documents.filter(Boolean).length
		let spaces =
			account.root.spaces?.flatMap(space =>
				space?.$isLoaded ? [space] : [],
			) ?? []
		let spaceDocs = spaces.reduce(
			(sum, space) => sum + space.documents.filter(Boolean).length,
			0,
		)
		await jazz.done()
		return {
			accountId: account.$jazz.id,
			name: account.profile.name,
			provider: credentials?.provider ?? "unknown",
			syncPeer: config.syncPeer,
			documents: personalDocs + spaceDocs,
			personalDocuments: personalDocs,
			spaces: spaces.length,
		}
	}),
)

let accountRename = Command.make(
	"rename",
	{
		...globalOptions,
		name: nameOption,
	},
	args =>
		runCommand("account.rename", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await jazz.account.$jazz.ensureLoaded({
				resolve: { profile: true },
			})
			account.profile.$jazz.set("name", args.name)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { accountId: account.$jazz.id, name: account.profile.name }
		}),
)

let accountCommand = Command.make("account").pipe(
	Command.withDescription(descriptions.account),
	Command.withSubcommands([accountShow, accountRename]),
)

let syncFlush = Command.make("flush", globalOptions, args =>
	runCommand("sync.flush", args, async config => {
		let jazz = await createAuthenticatedJazz(config)
		await jazz.account.$jazz.waitForAllCoValuesSync({
			timeout: config.timeoutMs,
		})
		await jazz.done()
		return { synced: true, syncPeer: config.syncPeer }
	}),
)

let syncStatus = Command.make("status", globalOptions, args =>
	runCommand("sync.status", args, async config => {
		let credentials = await getStoredCredentials(config)
		return {
			authenticated: Boolean(credentials),
			accountId: credentials?.accountID ?? null,
			provider: credentials?.provider ?? null,
			syncPeer: config.syncPeer,
		}
	}),
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
		runCommand("doc.list", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let docs = await listDocs(
				account,
				getOptionString(args.scope),
				args.deleted,
				config.timeoutMs,
			)
			await jazz.done()
			return docs
		}),
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
		runCommand("doc.get", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let doc = await loadDocumentMetadata(jazz, args.docId, {
				allowStale: args.offline || args.local || args.staleOk,
				timeoutMs: config.timeoutMs,
			})
			let owner = await getDocumentOwner(doc)
			await jazz.done()
			return {
				docId: doc.$jazz.id,
				title: getDocumentTitle(doc),
				spaceId: doc.spaceId ?? null,
				createdAt: doc.createdAt.toISOString(),
				updatedAt: doc.updatedAt.toISOString(),
				deletedAt: doc.deletedAt?.toISOString() ?? null,
				owner,
			}
		}),
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
		runCommand("doc.content", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let doc = await loadDocumentContent(jazz, args.docId, {
				allowStale: args.offline || args.local || args.staleOk,
				timeoutMs: config.timeoutMs,
			})
			let content = doc.content.toString()
			await jazz.done()
			if (config.json) return { docId: doc.$jazz.id, content }
			if (!config.quiet) printContent(content)
		}),
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
		runCommand("doc.create", args, async config => {
			let content = await readRequiredContentInput(
				args.content,
				args.contentFile,
				args.stdin,
			)
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let scope = parseDocScope(getOptionString(args.scope))
			let doc =
				scope.kind === "personal"
					? await createPersonalDocument(account, content)
					: await createSpaceScopedDoc(account, scope.spaceId, content)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return summarizeDoc(
				doc,
				scope.kind === "space" ? scope.spaceId : undefined,
			)
		}),
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
		runCommand("doc.update", args, async config => {
			let content = await readRequiredContentInput(
				args.content,
				args.contentFile,
				args.stdin,
			)
			let jazz = await createAuthenticatedJazz(config)
			let doc = await loadDocumentForMutation(
				jazz,
				args.docId,
				config.timeoutMs,
			)
			if (!canEdit(doc))
				throw new PermissionError({ message: "Document is read-only" })
			if (doc.content.toString() === content) {
				await jazz.done()
				return summarizeDoc(doc)
			}
			await replaceCliDocumentContent(doc, content)
			doc.$jazz.set("updatedAt", new Date())
			syncDocumentMetadata(doc)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return summarizeDoc(doc)
		}),
)

let docRename = Command.make(
	"rename",
	{
		...globalOptions,
		docId: docIdArg,
		title: titleOption,
	},
	args =>
		runCommand("doc.rename", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let doc = await loadDocumentForMutation(
				jazz,
				args.docId,
				config.timeoutMs,
			)
			if (!canEdit(doc))
				throw new PermissionError({ message: "Document is read-only" })
			let nextContent = setDocumentTitle(doc.content.toString(), args.title)
			if (doc.content.toString() === nextContent) {
				await jazz.done()
				return summarizeDoc(doc)
			}
			await replaceCliDocumentContent(doc, nextContent)
			doc.$jazz.set("updatedAt", new Date())
			syncDocumentMetadata(doc)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return summarizeDoc(doc)
		}),
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
		runCommand("doc.move", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			let nextScope = parseDocScope(args.scope)
			await moveDocumentToSpace({
				doc: located.doc,
				destination:
					nextScope.kind === "personal"
						? null
						: {
								id: nextScope.spaceId,
								name: findSpace(account, nextScope.spaceId).name,
							},
				currentSpaceId: located.space?.$jazz.id,
				me: account,
			})
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return summarizeDoc(
				located.doc,
				nextScope.kind === "space" ? nextScope.spaceId : undefined,
			)
		}),
)

let docDelete = Command.make(
	"delete",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.delete", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			let result = await deletePersonalDocument(located.doc)
			if (result.type === "error")
				throw new PermissionError({ message: result.error })
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return summarizeDoc(located.doc, located.space?.$jazz.id)
		}),
)

let docRestore = Command.make(
	"restore",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.restore", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			if (located.space) {
				located.doc.$jazz.set("deletedAt", undefined)
				located.doc.$jazz.set("updatedAt", new Date())
			} else {
				let result = await restorePersonalDocument(located.doc, account)
				if (result.type === "error")
					throw new PermissionError({ message: result.error })
			}
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return summarizeDoc(located.doc, located.space?.$jazz.id)
		}),
)

let docPurge = Command.make(
	"purge",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.purge", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			if (located.space) {
				let index = located.space.documents.findIndex(
					doc => doc?.$jazz.id === located.doc.$jazz.id,
				)
				if (index !== -1) located.space.documents.$jazz.splice(index, 1)
				let deleteModule = await import("@/app/features/documents")
				await deleteModule.permanentlyDeleteDocument(located.doc)
			} else {
				let result = await permanentlyDeletePersonalDocument(
					located.doc,
					account,
				)
				if (result.type === "error")
					throw new PermissionError({ message: result.error })
			}
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { docId: args.docId, purged: true }
		}),
)

let docLeave = Command.make(
	"leave",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.leave", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			if (located.space)
				throw new CliUsageError({ message: "Use `space leave` for space docs" })
			await leavePersonalDocument(located.doc, account)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { docId: args.docId, left: true }
		}),
)

let docShareCreate = Command.make(
	"create",
	{
		...globalOptions,
		docId: docIdArg,
		role: roleOption,
	},
	args =>
		runCommand("doc.share.create", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			let result = await createDocumentInvite(
				located.doc,
				args.role,
				config.baseUrl,
			)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return {
				docId: args.docId,
				role: args.role,
				inviteGroupId: result.inviteGroup.$jazz.id,
				link: result.link,
			}
		}),
)

let docShareRevoke = Command.make(
	"revoke",
	{
		...globalOptions,
		docId: docIdArg,
		inviteGroupId: inviteGroupIdOption,
	},
	args =>
		runCommand("doc.share.revoke", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			revokeDocumentInvite(located.doc, args.inviteGroupId)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return {
				docId: args.docId,
				inviteGroupId: args.inviteGroupId,
				revoked: true,
			}
		}),
)

let docShareList = Command.make(
	"list",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.share.list", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			let collaborators = await listCollaborators(
				located.doc,
				located.space ? getSpaceGroup(located.space)?.$jazz.id : undefined,
			)
			await jazz.done()
			return collaborators
		}),
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
		runCommand("doc.share.role", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			await changeCollaboratorRole(located.doc, args.inviteGroupId, args.role)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return {
				docId: args.docId,
				inviteGroupId: args.inviteGroupId,
				role: args.role,
			}
		}),
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
		runCommand("doc.public.enable", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			await makeDocumentPublic(located.doc, account.$jazz.id)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { docId: args.docId, public: true }
		}),
)

let docPublicDisable = Command.make(
	"disable",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.public.disable", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			await makeDocumentPrivate(located.doc)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { docId: args.docId, public: false }
		}),
)

let docPublicLink = Command.make(
	"link",
	{
		...globalOptions,
		docId: docIdArg,
	},
	args =>
		runCommand("doc.public.link", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let located = await findDocument(account, args.docId)
			await jazz.done()
			return {
				docId: args.docId,
				link: buildDocumentPublicLink(config.baseUrl, located.doc.$jazz.id),
			}
		}),
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
		docCommentCommand,
		docShareCommand,
		docPublicCommand,
	]),
)

let spaceList = Command.make("list", globalOptions, args =>
	runCommand("space.list", args, async config => {
		let jazz = await createAuthenticatedJazz(config)
		let account = await loadAccount(jazz, config.timeoutMs)
		let spaces = (account.root.spaces ?? [])
			.flatMap(space => (space?.$isLoaded ? [space] : []))
			.map(space => ({
				spaceId: space.$jazz.id,
				name: space.name,
				documents: space.documents.length,
				public: isSpacePublic(space),
				member: isSpaceMember(space),
			}))
			.sort((left, right) => left.name.localeCompare(right.name))
		await jazz.done()
		return spaces
	}),
)

let spaceGet = Command.make(
	"get",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.get", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			let owner = await getSpaceOwner(space)
			await jazz.done()
			return {
				spaceId: space.$jazz.id,
				name: space.name,
				documents: space.documents.length,
				public: isSpacePublic(space),
				owner,
			}
		}),
)

let spaceMembers = Command.make(
	"members",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.members", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			let members = await listSpaceMembers(space)
			await jazz.done()
			return members
		}),
)

let spaceDocs = Command.make(
	"docs",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.docs", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			let docs = await listDocs(
				account,
				`space:${space.$jazz.id}`,
				false,
				config.timeoutMs,
			)
			await jazz.done()
			return docs
		}),
)

let spaceCreate = Command.make(
	"create",
	{
		...globalOptions,
		name: nameOption,
	},
	args =>
		runCommand("space.create", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = createSpace(args.name, account.root)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { spaceId: space.$jazz.id, name: space.name }
		}),
)

let spaceRename = Command.make(
	"rename",
	{
		...globalOptions,
		spaceId: spaceIdArg,
		name: nameOption,
	},
	args =>
		runCommand("space.rename", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			space.$jazz.set("name", args.name)
			space.$jazz.set("updatedAt", new Date())
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { spaceId: space.$jazz.id, name: space.name }
		}),
)

let spaceDelete = Command.make(
	"delete",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.delete", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			await permanentlyDeleteSpace(space, account)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { spaceId: args.spaceId, deleted: true }
		}),
)

let spaceLeave = Command.make(
	"leave",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.leave", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			await leaveSpace(space, account)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { spaceId: args.spaceId, left: true }
		}),
)

let spaceShareCreate = Command.make(
	"create",
	{
		...globalOptions,
		spaceId: spaceIdArg,
		role: spaceRoleOption,
	},
	args =>
		runCommand("space.share.create", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			let result = await createSpaceInvite(space, args.role, config.baseUrl)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return {
				spaceId: args.spaceId,
				role: args.role,
				inviteGroupId: result.inviteGroup.$jazz.id,
				link: result.link,
			}
		}),
)

let spaceShareRevoke = Command.make(
	"revoke",
	{
		...globalOptions,
		spaceId: spaceIdArg,
		inviteGroupId: inviteGroupIdOption,
	},
	args =>
		runCommand("space.share.revoke", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			revokeSpaceInvite(space, args.inviteGroupId)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return {
				spaceId: args.spaceId,
				inviteGroupId: args.inviteGroupId,
				revoked: true,
			}
		}),
)

let spaceShareList = Command.make(
	"list",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.share.list", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			let collaborators = await listSpaceCollaborators(space)
			await jazz.done()
			return collaborators
		}),
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
		runCommand("space.share.role", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			await changeSpaceCollaboratorRole(space, args.inviteGroupId, args.role)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return {
				spaceId: args.spaceId,
				inviteGroupId: args.inviteGroupId,
				role: args.role,
			}
		}),
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
		runCommand("space.public.enable", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			makeSpacePublic(space)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { spaceId: args.spaceId, public: true }
		}),
)

let spacePublicDisable = Command.make(
	"disable",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.public.disable", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			makeSpacePrivate(space)
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return { spaceId: args.spaceId, public: false }
		}),
)

let spacePublicLink = Command.make(
	"link",
	{
		...globalOptions,
		spaceId: spaceIdArg,
	},
	args =>
		runCommand("space.public.link", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let space = findSpace(account, args.spaceId)
			await jazz.done()
			return {
				spaceId: args.spaceId,
				link: buildSpacePublicLink(config.baseUrl, space.$jazz.id),
			}
		}),
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
		runCommand("invite.inspect", args, async () => inspectInvite(args.link)),
)

let inviteAccept = Command.make(
	"accept",
	{
		...globalOptions,
		link: linkOption,
		sync: syncOption,
	},
	args =>
		runCommand("invite.accept", args, async config => {
			let jazz = await createAuthenticatedJazz(config)
			let account = await loadAccount(jazz, config.timeoutMs)
			let invite = inspectInvite(args.link)
			if (invite.kind === "doc") {
				await acceptDocumentInvite(account, parseInviteLink(args.link))
			} else {
				await acceptSpaceInvite(account, parseSpaceInviteLink(args.link))
			}
			await syncMutation(jazz, config.timeoutMs)
			await jazz.done()
			return invite
		}),
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
		spaceCommand,
		inviteCommand,
		syncCommand,
	]),
)

let cli = Command.run(root, {
	name: "alkalye",
	version: packageVersion,
})
