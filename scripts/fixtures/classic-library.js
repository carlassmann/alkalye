/* global fetch, atob, Blob, localStorage */
;(async function createClassicMigrationFixture() {
	let schema = await import("/src/schema/index.ts")
	let source = await fetch("/src/schema/index.ts").then(response =>
		response.text(),
	)
	let coreUrl = source.match(/from "([^"]*jazz-tools[^"]*)"/)?.[1]
	if (!coreUrl) throw new Error("Classic Jazz module not found")
	let { co, Group } = await import(coreUrl)
	let me = schema.UserAccount.getMe()
	let root = await me.$jazz.ensureLoaded({
		resolve: {
			root: { documents: true, spaces: true, themes: true, settings: true },
			profile: true,
		},
	})
	let owner = Group.create({ owner: me })
	let now = new Date()
	let doc = schema.Document.create(
		{
			version: 1,
			content: co
				.plainText()
				.create(
					"---\npath: Migration/Notes\npinned: true\n---\n\n# Classic migration\n\nAn anchored quotation.\n",
					owner,
				),
			createdAt: now,
			updatedAt: now,
		},
		owner,
	)
	root.root.documents.$jazz.push(doc)
	let claimedDoc = schema.Document.create(
		{
			version: 1,
			content: co.plainText().create("# Claimed Classic access", owner),
			createdAt: now,
			updatedAt: now,
		},
		owner,
	)
	root.root.documents.$jazz.push(claimedDoc)
	doc.$jazz.set("path", "Migration/Notes")
	doc.$jazz.set("pinned", true)
	doc.$jazz.set("isPresentation", true)
	doc.$jazz.set("presentationLine", 2)
	let imageBlob = await fetch(
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
	).then(response => response.blob())
	let original = await co.fileStream().createFromBlob(imageBlob, owner)
	let image = co
		.image()
		.create({ original, originalSize: [1, 1], progressive: false }, owner)
	let asset = schema.ImageAsset.create(
		{ type: "image", name: "pixel.png", image, createdAt: now },
		owner,
	)
	let clip = Uint8Array.from(
		atob(
			"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",
		),
		char => char.charCodeAt(0),
	)
	let padded = new Uint8Array(900000)
	padded.set(clip)
	let video = await co
		.fileStream()
		.createFromBlob(new Blob([padded], { type: "video/mp4" }), owner)
	let videoAsset = schema.VideoAsset.create(
		{
			type: "video",
			name: "Migration clip",
			video,
			mimeType: "video/mp4",
			muteAudio: true,
			createdAt: now,
		},
		owner,
	)
	let snapshot = await co.fileStream().createFromBlob(
		new Blob(
			[
				JSON.stringify({
					store: {},
					schema: { schemaVersion: 2, sequences: {} },
				}),
			],
			{ type: "application/json" },
		),
		owner,
	)
	let revision = schema.TldrawRevision.create(
		{ snapshot, lightPreview: image, darkPreview: image, createdAt: now },
		owner,
	)
	let board = schema.TldrawAsset.create(
		{ version: 1, type: "tldraw", name: "Sketch", revision, createdAt: now },
		owner,
	)
	board.$jazz.set(
		"revision",
		schema.TldrawRevision.create(
			{
				snapshot,
				lightPreview: image,
				darkPreview: image,
				createdAt: new Date(),
			},
			owner,
		),
	)
	doc.$jazz.set(
		"assets",
		co.list(schema.Asset).create([asset, videoAsset, board], owner),
	)
	let from = doc.content.toString().indexOf("anchored quotation")
	let to = from + "anchored quotation".length
	let start = doc.content.posAfter(from)
	let end = doc.content.posBefore(to)
	let stringify = position =>
		position
			? `${position.sessionID}:${position.txIndex}:${position.changeIdx}`
			: undefined
	let reply = schema.CommentReply.create(
		{ body: "Keep this comment", authorName: "Classic author", createdAt: now },
		owner,
	)
	let thread = schema.CommentThread.create(
		{
			anchor: {
				start: stringify(start),
				end: stringify(end),
				quote: "anchored quotation",
				contextBefore: "An ",
				contextAfter: ".\n",
			},
			replies: co.list(schema.CommentReply).create([reply], owner),
			createdAt: now,
			updatedAt: now,
		},
		owner,
	)
	doc.$jazz.set(
		"comments",
		co.list(schema.CommentThread).create([thread], owner),
	)
	for (let index = 0; index < 12; index++)
		doc.content.$jazz.applyDiff(
			doc.content.toString() + `\nClassic edit ${index}.`,
		)
	doc.content.$jazz.applyDiff(
		doc.content.toString() +
			`\n\n![Pixel](asset:${asset.$jazz.id})\n![Sketch](asset:${board.$jazz.id})\n![Video](asset:${videoAsset.$jazz.id})`,
	)
	let archived = schema.Document.create(
		{
			version: 1,
			content: co.plainText().create("# Archived Classic document", owner),
			createdAt: now,
			updatedAt: now,
		},
		owner,
	)
	if (!root.root.inactiveDocuments)
		root.root.$jazz.set(
			"inactiveDocuments",
			co.list(schema.Document).create([], root.root.$jazz.owner),
		)
	root.root.inactiveDocuments.$jazz.push(archived)
	let spaceOwner = Group.create({ owner: me })
	let space = schema.Space.create(
		{
			name: "Classic shared space",
			documents: co.list(schema.Document).create([], spaceOwner),
			createdAt: now,
			updatedAt: now,
		},
		spaceOwner,
	)
	root.root.spaces.$jazz.push(space)
	let spaceDoc = schema.Document.create(
		{
			version: 1,
			content: co.plainText().create("# Shared Classic notes", spaceOwner),
			spaceId: space.$jazz.id,
			createdAt: now,
			updatedAt: now,
		},
		spaceOwner,
	)
	space.documents.$jazz.push(spaceDoc)
	let publicOwner = Group.create({ owner: me })
	publicOwner.addMember("everyone", "reader")
	let publicDoc = schema.Document.create(
		{
			version: 1,
			content: co.plainText().create("# Public Classic note", publicOwner),
			createdAt: now,
			updatedAt: now,
		},
		publicOwner,
	)
	root.root.documents.$jazz.push(publicDoc)
	let theme = schema.Theme.create(
		{
			version: 1,
			name: "Classic red",
			type: "both",
			css: co
				.plainText()
				.create("h1 {color: rgb(170,20,40)}", root.root.$jazz.owner),
			createdAt: now,
			updatedAt: now,
		},
		root.root.$jazz.owner,
	)
	let themeAsset = schema.ThemeAsset.create(
		{
			name: "theme-pixel.png",
			mimeType: "image/png",
			data: await co
				.fileStream()
				.createFromBlob(imageBlob, root.root.$jazz.owner),
			createdAt: now,
		},
		root.root.$jazz.owner,
	)
	theme.$jazz.set(
		"assets",
		co.list(schema.ThemeAsset).create([themeAsset], root.root.$jazz.owner),
	)
	theme.css.$jazz.applyDiff(
		`${theme.css.toString()}\nbody {background-image: url(asset:${themeAsset.$jazz.id});}`,
	)
	root.root.themes.$jazz.push(theme)
	root.root.settings.$jazz.set("editor", {
		...root.root.settings.editor,
		fontSize: 21,
	})
	root.root.settings.$jazz.set("defaultPreviewTheme", theme.$jazz.id)
	root.root.$jazz.set("language", "en")
	root.profile.$jazz.set("name", "Classic account A")
	let credentials = JSON.parse(localStorage.getItem("jazz-logged-in-secret"))
	credentials.provider = "passphrase"
	localStorage.setItem("jazz-logged-in-secret", JSON.stringify(credentials))
	await me.$jazz.waitForAllCoValuesSync({ timeout: 60000 })
	let unmigratedDoc = schema.Document.create(
		{
			version: 1,
			content: co.plainText().create("# Waiting private", owner),
			createdAt: now,
			updatedAt: now,
		},
		owner,
	)
	let unmigratedPublic = schema.Document.create(
		{
			version: 1,
			content: co.plainText().create("# Waiting public", publicOwner),
			createdAt: now,
			updatedAt: now,
		},
		publicOwner,
	)
	await me.$jazz.waitForAllCoValuesSync({ timeout: 60000 })
	let fixture = {
		accountId: me.$jazz.id,
		docId: doc.$jazz.id,
		claimedDocId: claimedDoc.$jazz.id,
		spaceId: space.$jazz.id,
		spaceDocId: spaceDoc.$jazz.id,
		publicDocId: publicDoc.$jazz.id,
		unmigratedDocId: unmigratedDoc.$jazz.id,
		unmigratedPublicId: unmigratedPublic.$jazz.id,
		archivedId: archived.$jazz.id,
		assetId: asset.$jazz.id,
		threadId: thread.$jazz.id,
		themeId: theme.$jazz.id,
	}
	localStorage.setItem("alkalye-classic-fixture", JSON.stringify(fixture))
	return fixture
})()
