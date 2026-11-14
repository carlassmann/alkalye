import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

let mode = process.argv[2]
let origin = z.url().parse(process.argv[3])
let directory = process.env.CLASSIC_QA_OUTPUT ?? "/tmp/alkalye-v2-phase3"
let prefix = process.env.CLASSIC_QA_SESSION ?? "classic-cutover"
let profilesDirectory = join(directory, "profiles")
let fixtureSchema = z.object({
	accountId: z.string(),
	docId: z.string(),
	claimedDocId: z.string(),
	spaceId: z.string(),
	spaceDocId: z.string(),
	assetId: z.string(),
	publicDocId: z.string(),
	unmigratedDocId: z.string(),
	unmigratedPublicId: z.string(),
})
mkdirSync(directory, { recursive: true })
mkdirSync(profilesDirectory, { recursive: true, mode: 0o700 })
if (mode === "prepare") prepare()
else if (mode === "verify") verify()
else
	throw new Error(
		"Usage: bun scripts/qa-classic-migration.ts prepare|verify <same-origin-url>",
	)

function browser(profile: string, ...args: string[]) {
	return execFileSync("agent-browser", args, {
		encoding: "utf8",
		timeout: 65_000,
		env: browserEnvironment(profile),
	}).trim()
}
function evaluate(profile: string, source: string): unknown {
	return JSON.parse(
		execFileSync("agent-browser", ["eval", "--stdin"], {
			input: source,
			encoding: "utf8",
			timeout: 65_000,
			env: browserEnvironment(profile),
		}),
	)
}
function browserEnvironment(profile: string) {
	return {
		...process.env,
		AGENT_BROWSER_SESSION: `${prefix}-${profile}`,
		AGENT_BROWSER_PROFILE: join(profilesDirectory, `${prefix}-${profile}`),
	}
}
function prepare() {
	for (let profile of ["a", "b"]) {
		browser(profile, "open", `${origin}/app`)
		browser(
			profile,
			"wait",
			"--fn",
			"document.querySelector('.cm-content') !== null",
			"--timeout",
			"60000",
		)
	}
	let b = z
		.string()
		.parse(
			evaluate(
				"b",
				`(async()=>{let {UserAccount}=await import('/src/schema/index.ts');return UserAccount.getMe().$jazz.id})()`,
			),
		)
	let fixture = fixtureSchema.parse(
		evaluate(
			"a",
			readFileSync(
				new URL("./fixtures/classic-library.js", import.meta.url),
				"utf8",
			),
		),
	)
	evaluate(
		"a",
		`(async()=>{let s=await import('/src/schema/index.ts');let b=await s.UserAccount.load(${JSON.stringify(b)});let doc=await s.Document.load(${JSON.stringify(fixture.docId)});let space=await s.Space.load(${JSON.stringify(fixture.spaceId)});doc.$jazz.owner.addMember(b,'reader');space.$jazz.owner.addMember(b,'writer');await s.UserAccount.getMe().$jazz.waitForAllCoValuesSync({timeout:60000});return true})()`,
	)
	evaluate(
		"b",
		`(async()=>{let s=await import('/src/schema/index.ts');let me=await s.UserAccount.getMe().$jazz.ensureLoaded({resolve:{root:{documents:true,spaces:true},profile:true}});me.root.documents.$jazz.push(await s.Document.load(${JSON.stringify(fixture.docId)}));me.root.documents.$jazz.push(await s.Document.load(${JSON.stringify(fixture.claimedDocId)}));me.root.spaces.$jazz.push(await s.Space.load(${JSON.stringify(fixture.spaceId)}));me.profile.$jazz.set('name','Classic anonymous B');await me.$jazz.waitForAllCoValuesSync({timeout:60000});return true})()`,
	)
	writeFileSync(
		join(directory, "qa-fixture.json"),
		JSON.stringify({ ...fixture, b, origin }),
		{ mode: 0o600 },
	)
	browser("a", "screenshot", join(directory, "classic-a.png"))
	browser("b", "screenshot", join(directory, "classic-b.png"))
	for (let profile of ["a", "b"]) browser(profile, "close")
	console.log(
		`Classic ready. Switch this SAME origin to v2; keep Classic sync running.\n${origin}\nbun scripts/qa-classic-migration.ts verify ${origin}`,
	)
}
function inspect(profile: string) {
	return z
		.object({
			documents: z.array(
				z.object({
					id: z.string(),
					content: z.string(),
					title: z.string(),
					tags: z.array(z.string()),
					path: z.string().nullable(),
					frontmatterPinned: z.boolean(),
				}),
			),
			folders: z.array(z.object({ name: z.string() })),
			settings: z.array(
				z.object({ editor: z.object({ fontSize: z.number() }) }),
			),
			versions: z.array(z.object({ documentId: z.string() })),
			anchors: z.array(z.object({ quote: z.string().optional() })),
			hashes: z.array(z.object({ id: z.string(), sha256: z.string() })),
			members: z.array(z.object({ accountId: z.string(), role: z.string() })),
			grants: z.array(z.object({ documentId: z.string(), role: z.string() })),
			themeHashes: z.array(z.object({ id: z.string(), sha256: z.string() })),
			revisionCount: z.number(),
		})
		.parse(
			evaluate(
				profile,
				`(async()=>{let {inspectClassicMigration}=await import('/src/app/features/classic-import/inspect.ts');return inspectClassicMigration()})()`,
			),
		)
}
function security(profile: string, mode: string, fixture: unknown) {
	return evaluate(
		profile,
		`(${readFileSync(new URL("./fixtures/classic-security-checks.js", import.meta.url), "utf8")})(${JSON.stringify(mode)},${JSON.stringify(fixture)})`,
	)
}
function verify() {
	let fixture = fixtureSchema
		.extend({ b: z.string(), origin: z.string() })
		.parse(JSON.parse(readFileSync(join(directory, "qa-fixture.json"), "utf8")))
	if (fixture.origin !== origin)
		throw new Error("Cutover must keep the same origin")
	browser("b", "open", `${origin}/app`)
	browser("b", "wait", "[data-testid=classic-migration]", "--timeout", "60000")
	let readerForgery = security("b", "reader", fixture)
	browser("a", "open", `${origin}/app`)
	// Interrupt after boot: the next import must finish using persisted maps.
	browser("a", "wait", "[data-testid=classic-migration]", "--timeout", "60000")
	browser("a", "reload")
	browser(
		"a",
		"wait",
		"--text",
		"Classic import finished.",
		"--timeout",
		"60000",
	)
	security("b", "replay", fixture)
	browser("b", "reload")
	for (let profile of ["a", "b"])
		browser(
			profile,
			"wait",
			"--text",
			"Classic import finished.",
			"--timeout",
			"60000",
		)
	let a = inspect("a"),
		b = inspect("b")
	let doc = a.documents.find(doc => doc.content.includes("# Classic migration"))
	if (!doc || !b.documents.some(item => item.id === doc.id))
		throw new Error("Shared document missing or duplicated")
	for (let profile of [a, b]) {
		let imported = profile.documents.find(item => item.id === doc.id)
		if (
			!imported ||
			imported.title !== "Classic migration" ||
			imported.path !== "Migration/Notes" ||
			!imported.frontmatterPinned
		)
			throw new Error("Imported library metadata missing")
	}
	if (!a.anchors.some(anchor => anchor.quote === "anchored quotation"))
		throw new Error("Comment anchor missing")
	if (!a.versions.some(version => version.documentId === doc.id))
		throw new Error("Classic history missing")
	if (!a.folders.some(folder => folder.name === "Migration"))
		throw new Error("Folders missing")
	if (a.settings[0]?.editor.fontSize !== 21)
		throw new Error("Settings not imported")
	if (!a.themeHashes.length || a.revisionCount < 2)
		throw new Error("Theme assets or whiteboard revision history missing")
	if (!b.members.some(member => member.role === "writer"))
		throw new Error("Space writer membership missing")
	if (
		!b.grants.some(
			grant => grant.documentId === doc.id && grant.role === "reader",
		)
	)
		throw new Error("Reader grant missing")
	for (let hash of a.hashes)
		if (
			!b.hashes.some(
				other => other.id === hash.id && other.sha256 === hash.sha256,
			)
		)
			throw new Error("Shared asset bytes differ")
	for (let profile of ["a", "b"]) {
		browser(
			profile,
			"open",
			`${origin}/app/doc/${doc.id}${profile === "b" ? "/preview" : ""}`,
		)
		browser(
			profile,
			"wait",
			"--text",
			"Classic migration",
			"--timeout",
			"60000",
		)
		browser(profile, "screenshot", join(directory, `v2-${profile}.png`))
	}
	let phrase = z
		.string()
		.parse(
			evaluate(
				"a",
				`(async()=>{let{readClassicCredentials,deviceSecretFromSeed}=await import('/src/app/features/classic-import/identity.ts');let{RecoveryPhrase}=await import('/node_modules/jazz-tools/dist/passphrase.js');return RecoveryPhrase.fromSecret(deviceSecretFromSeed(new Uint8Array(readClassicCredentials().secretSeed)))})()`,
			),
		)
	browser("fresh", "close")
	rmSync(join(profilesDirectory, `${prefix}-fresh`), {
		recursive: true,
		force: true,
	})
	browser("fresh", "open", `${origin}/app/settings`)
	browser(
		"fresh",
		"wait",
		"[data-testid=settings-sign-in]",
		"--timeout",
		"60000",
	)
	browser("fresh", "click", "[data-testid=settings-sign-in]")
	browser("fresh", "click", "[data-testid=auth-initial-sign-in]")
	browser("fresh", "fill", "[data-testid=auth-login-passphrase]", phrase)
	browser("fresh", "click", "[data-testid=auth-login-submit]")
	browser(
		"fresh",
		"wait",
		"--text",
		"Classic import finished.",
		"--timeout",
		"60000",
	)
	browser("fresh", "open", `${origin}/app/doc/${doc.id}`)
	browser("fresh", "wait", "--text", "Classic migration", "--timeout", "60000")
	browser("fresh", "screenshot", join(directory, "fresh-words.png"))
	browser("fresh", "close")
	let after = inspect("a")
	if (
		JSON.stringify(a.documents.map(doc => doc.id).sort()) !==
		JSON.stringify(after.documents.map(doc => doc.id).sort())
	)
		throw new Error("Phrase recovery duplicated documents")
	let edgeCases = z
		.object({
			forgedClaimStatus: z.literal(400),
			hasClassic: z.literal(true),
			hasV2: z.literal(true),
			retiredRootFound: z.literal(true),
			progress: z.object({
				done: z.literal(true),
				errors: z.array(z.unknown()).max(0),
			}),
		})
		.parse(
			evaluate(
				"a",
				`(${readFileSync(new URL("./fixtures/classic-cutover-checks.js", import.meta.url), "utf8")})(${JSON.stringify(fixture.b)})`,
			),
		)
	browser(
		"visitor",
		"open",
		`${origin}/app/doc/${fixture.publicDocId}/preview?legacy=1#kept`,
	)
	browser(
		"visitor",
		"wait",
		"--text",
		"Public Classic note",
		"--timeout",
		"60000",
	)
	let redirected = z.string().parse(evaluate("visitor", "window.location.href"))
	if (
		redirected.includes("co_z") ||
		!redirected.endsWith("/preview?legacy=1#kept")
	)
		throw new Error("Fresh public Classic URL did not redirect")
	browser("visitor", "screenshot", join(directory, "fresh-public-link.png"))
	security("b", "leave", fixture)
	security("a", "replay", fixture)
	let afterV2Removal = z
		.object({ id: z.null() })
		.parse(security("b", "lookup", fixture))
	let activeTargets = [
		{ ...fixture, docId: fixture.claimedDocId },
		{ ...fixture, lookupKind: "space" },
		{ ...fixture, docId: fixture.spaceDocId },
	]
	let beforeClassicRemoval = activeTargets.map(target =>
		z.object({ id: z.string() }).parse(security("b", "lookup", target)),
	)
	security("a", "remove-classic", fixture)
	security("a", "replay", fixture)
	let afterClassicRemoval = z
		.object({ id: z.null() })
		.parse(security("b", "lookup", fixture))
	let claimedAccessAfterClassicRemoval = activeTargets.map(target =>
		z.object({ id: z.null() }).parse(security("b", "lookup", target)),
	)
	let securityCases = {
		readerForgery,
		redirected,
		afterV2Removal,
		afterClassicRemoval,
		beforeClassicRemoval,
		claimedAccessAfterClassicRemoval,
	}
	writeFileSync(
		join(directory, "qa-result.json"),
		JSON.stringify({ a, b, edgeCases, securityCases }, null, 2),
	)
	console.log(`Same-origin migration passed; inspect ${directory}\n${origin}`)
}
