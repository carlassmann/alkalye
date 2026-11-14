import { runCommand, executeCommand } from "@/cli/runtime"
import { Args, Command, Options } from "@effect/cli"

import {
	docIdArg,
	globalOptions,
	localOption,
	offlineOption,
	staleOkOption,
} from "@/cli/options"

export { docExportCommand }

let slideAspectRatios = ["16:9", "4:3"] as const
let exportLayouts = ["document", "slides", "notes"] as const

let docExportCommand = Command.make(
	"export",
	{
		...globalOptions,
		docId: Args.optional(docIdArg),
		pdf: Options.optional(Options.text("pdf")).pipe(
			Options.withDescription("Write a PDF to this path."),
		),
		html: Options.optional(Options.text("html")).pipe(
			Options.withDescription("Write the printable HTML to this path."),
		),
		file: Options.optional(Options.file("file")).pipe(
			Options.withDescription("Export a local Markdown file instead of a doc."),
		),
		theme: Options.optional(Options.text("theme")).pipe(
			Options.withDescription(
				"Theme name, ID, or path to a local .theme.md file.",
			),
		),
		layout: Options.optional(Options.choice("layout", exportLayouts)).pipe(
			Options.withDescription(
				"document, slides, or notes (slides with speaker notes). Presentations default to slides.",
			),
		),
		aspect: Options.choice("aspect", slideAspectRatios).pipe(
			Options.withDefault("16:9"),
			Options.withDescription("Slide aspect ratio for slides and notes."),
		),
		offline: offlineOption,
		local: localOption,
		staleOk: staleOkOption,
	},
	args =>
		runCommand("doc.export", args, config =>
			executeCommand("doc.export", args, config),
		),
)
