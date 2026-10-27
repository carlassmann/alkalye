import { readFile } from "node:fs/promises"
import type { AppFontSources } from "@/app/features/import-export/lib/printable-slides"

export { loadAppPrintFonts }

async function loadAppPrintFonts(): Promise<AppFontSources> {
	let [latin, latinExt, monoLatin, monoLatinExt] = await Promise.all(
		[
			"@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
			"@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2",
			"@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2",
			"@fontsource-variable/geist-mono/files/geist-mono-latin-ext-wght-normal.woff2",
		].map(loadFontDataUri),
	)
	return {
		sans: { latin, latinExt },
		mono: { latin: monoLatin, latinExt: monoLatinExt },
	}
}

async function loadFontDataUri(specifier: string) {
	let bytes = await readFile(new URL(import.meta.resolve(specifier)))
	return `data:font/woff2;base64,${bytes.toString("base64")}`
}
