import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url"
import geistLatinExt from "@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2?url"
import geistMonoLatin from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url"
import geistMonoLatinExt from "@fontsource-variable/geist-mono/files/geist-mono-latin-ext-wght-normal.woff2?url"
import type { AppFontSources } from "./printable-slides"

export { getAppPrintFonts }

// The print window is about:blank, so bundled font paths must be absolute.
function getAppPrintFonts(): AppFontSources {
	return {
		sans: {
			latin: toAbsoluteUrl(geistLatin),
			latinExt: toAbsoluteUrl(geistLatinExt),
		},
		mono: {
			latin: toAbsoluteUrl(geistMonoLatin),
			latinExt: toAbsoluteUrl(geistMonoLatinExt),
		},
	}
}

function toAbsoluteUrl(path: string) {
	return new URL(path, window.location.href).href
}
