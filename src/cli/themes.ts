import { runCommand, executeCommand } from "@/cli/runtime"
import { Args, Command, Options } from "@effect/cli"

import { descriptions } from "@/cli/help"

import { globalOptions, nameOption } from "@/cli/options"

export { themeCommand }

let themeIdArg = Args.text({ name: "theme-id" }).pipe(
	Args.withDescription("Theme ID."),
)
let sourceOption = Options.file("source").pipe(
	Options.withDescription(
		"Markdown with css theme and optional html document/slide fences.",
	),
)

let themeList = Command.make("list", globalOptions, args =>
	runCommand("theme.list", args, config =>
		executeCommand("theme.list", args, config),
	),
)

let themeGet = Command.make(
	"get",
	{ ...globalOptions, themeId: themeIdArg },
	args =>
		runCommand("theme.get", args, config =>
			executeCommand("theme.get", args, config),
		),
)

let themeCreate = Command.make(
	"create",
	{
		...globalOptions,
		source: sourceOption,
		name: Options.optional(nameOption),
	},
	args =>
		runCommand("theme.create", args, config =>
			executeCommand("theme.create", args, config),
		),
)

let themeUpdate = Command.make(
	"update",
	{
		...globalOptions,
		themeId: themeIdArg,
		source: sourceOption,
		name: Options.optional(nameOption),
	},
	args =>
		runCommand("theme.update", args, config =>
			executeCommand("theme.update", args, config),
		),
)

let themeDelete = Command.make(
	"delete",
	{ ...globalOptions, themeId: themeIdArg },
	args =>
		runCommand("theme.delete", args, config =>
			executeCommand("theme.delete", args, config),
		),
)

let themeCommand = Command.make("theme").pipe(
	Command.withDescription(descriptions.theme),
	Command.withSubcommands([
		themeList,
		themeGet,
		themeCreate,
		themeUpdate,
		themeDelete,
	]),
)
