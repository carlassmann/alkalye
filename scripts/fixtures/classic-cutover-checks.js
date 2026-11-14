/* global localStorage, fetch, AbortController */
// eslint-disable-next-line no-unused-vars -- The cutover runner evaluates this as a function expression.
async function verifyClassicCutoverEdges(classicMemberId) {
	let { readClassicCredentials, deviceSecretFromSeed } =
		await import("/src/app/features/classic-import/identity.ts")
	let { openClassicAccount } =
		await import("/src/app/features/classic-import/reader.ts")
	let { deviceAuthorization } =
		await import("/src/app/features/agents/lib/agent-api.ts")
	let { stableId } =
		await import("/src/app/features/classic-import/conversion.ts")
	let { runClassicImport } =
		await import("/src/app/features/classic-import/client.ts")
	let schema =
		await import("/src/app/features/classic-import/classic-schema.ts")
	let schemaSource = await fetch(
		"/src/app/features/classic-import/classic-schema.ts",
	).then(response => response.text())
	let coreUrl = schemaSource.match(/from "([^"]*jazz-tools-classic[^"]*)"/)?.[1]
	if (!coreUrl) throw new Error("Classic module unavailable")
	let { co } = await import(coreUrl)
	let credentials = readClassicCredentials()
	let key = deviceSecretFromSeed(new Uint8Array(credentials.secretSeed))
	let fixture = JSON.parse(localStorage.getItem("alkalye-classic-fixture"))
	let headers = {
		"content-type": "application/json",
		...deviceAuthorization(key),
	}
	let source = await openClassicAccount(new Uint8Array(credentials.secretSeed))
	let forgedClaimStatus
	try {
		let challenge = await fetch("/api/classic-import?action=challenge", {
			method: "POST",
			headers,
		}).then(response => response.json())
		let attacker = source.crypto.newRandomAgentSecret()
		let response = await fetch("/api/classic-import?action=claim", {
			method: "POST",
			headers,
			body: JSON.stringify({
				challengeId: challenge.challengeId,
				classicId: classicMemberId,
				agentId: source.crypto.getAgentID(attacker),
				signature: source.crypto.sign(
					source.crypto.getAgentSignerSecret(attacker),
					{
						nonce: challenge.nonce,
						accountId: challenge.accountId,
					},
				),
			}),
		})
		forgedClaimStatus = response.status
		let doc = await schema.Document.load(fixture.docId, {
			loadAs: source.account,
			resolve: { content: true },
		})
		if (!doc.$isLoaded) throw new Error("Classic fixture document unavailable")
		let node = doc.content.$jazz.raw.core.node
		for (let peer of node.syncManager.getServerPeers(doc.content.$jazz.raw.id))
			node.syncManager.removePeer(peer.id)
		if (!doc.content.toString().includes("CLASSIC OFFLINE ADDITION."))
			doc.content.insertBefore(0, "CLASSIC OFFLINE ADDITION.\n\n")
		await node.syncManager.waitForStorageSync(doc.content.$jazz.raw.id)
		if (!fixture.retiredRootDocumentId) {
			let root = source.account.root,
				owner = root.$jazz.owner
			let replacement = schema.UserRoot.create(
				{
					documents: co
						.list(schema.Document)
						.create([...root.documents], owner),
					inactiveDocuments: root.inactiveDocuments,
					spaces: root.spaces,
					settings: root.settings,
					themes: root.themes,
					language: root.language,
				},
				owner,
			)
			source.account.$jazz.set("root", replacement)
			let retired = schema.Document.create(
				{
					version: 1,
					content: co
						.plainText()
						.create("# Retired root offline document", owner),
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				owner,
			)
			root.documents.$jazz.push(retired)
			for (let value of [
				source.account,
				replacement,
				root.documents,
				retired,
				retired.content,
			])
				await node.syncManager.waitForStorageSync(value.$jazz.raw.id)
			fixture.retiredRootDocumentId = retired.$jazz.id
			localStorage.setItem("alkalye-classic-fixture", JSON.stringify(fixture))
		}
	} finally {
		source.close()
	}
	let docId = await stableId(fixture.docId)
	async function command(command, args) {
		let response = await fetch("/api/cli", {
			method: "POST",
			headers,
			body: JSON.stringify({ command, args }),
		})
		if (!response.ok) throw new Error("Fixture CLI request failed")
		return (await response.json()).data
	}
	let previous = await command("doc.content", { docId })
	if (!previous.includes("V2 INDEPENDENT ADDITION."))
		await command("doc.update", {
			docId,
			content: previous + "\n\nV2 INDEPENDENT ADDITION.",
		})
	let progress
	await runClassicImport(
		key,
		state => {
			if (state.done) progress = state
		},
		new AbortController().signal,
	)
	let merged = await command("doc.content", { docId })
	let retired = await command("doc.content", {
		docId: await stableId(fixture.retiredRootDocumentId),
	})
	return {
		forgedClaimStatus,
		hasClassic: merged.includes("CLASSIC OFFLINE ADDITION."),
		hasV2: merged.includes("V2 INDEPENDENT ADDITION."),
		retiredRootFound: retired.includes("# Retired root offline document"),
		progress,
	}
}
