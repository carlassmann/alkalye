export { stripAssetReference }

function stripAssetReference(content: string, assetId: string) {
	let reference = `!\\[[^\\]]*\\]\\(asset:${escapeAssetId(assetId)}\\)`
	let ownParagraph = new RegExp(
		`^[ \\t]*${reference}[ \\t]*\\n[ \\t]*\\n`,
		"gm",
	)
	let ownLine = new RegExp(`^[ \\t]*${reference}[ \\t]*\\n?`, "gm")
	let inline = new RegExp(reference, "g")
	return content
		.replace(ownParagraph, "")
		.replace(ownLine, "")
		.replace(inline, "")
}

function escapeAssetId(assetId: string) {
	return assetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
