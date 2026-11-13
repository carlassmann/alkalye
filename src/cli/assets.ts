import { runCommand, executeCommand } from "@/cli/runtime"
import { Args, Command, Options } from "@effect/cli"

import { descriptions } from "@/cli/help"

import { docIdArg, globalOptions, nameOption } from "@/cli/options"

export { docAssetCommand }

let assetIdArg = Args.text({ name: "asset-id" }).pipe(
	Args.withDescription("Asset ID."),
)
let assetFileOption = Options.file("file").pipe(
	Options.withDescription("Path to an image or video file."),
)

let docAssetAdd = Command.make(
	"add",
	{
		...globalOptions,
		docId: docIdArg,
		file: assetFileOption,
		name: Options.optional(nameOption),
	},
	args =>
		runCommand("doc.asset.add", args, config =>
			executeCommand("doc.asset.add", args, config),
		),
)

let docAssetList = Command.make(
	"list",
	{ ...globalOptions, docId: docIdArg },
	args =>
		runCommand("doc.asset.list", args, config =>
			executeCommand("doc.asset.list", args, config),
		),
)

let docAssetRemove = Command.make(
	"remove",
	{ ...globalOptions, docId: docIdArg, assetId: assetIdArg },
	args =>
		runCommand("doc.asset.remove", args, config =>
			executeCommand("doc.asset.remove", args, config),
		),
)

let docAssetCommand = Command.make("asset").pipe(
	Command.withDescription(descriptions.docAsset),
	Command.withSubcommands([docAssetAdd, docAssetList, docAssetRemove]),
)
