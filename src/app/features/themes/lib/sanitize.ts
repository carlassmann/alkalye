import DOMPurify, { type Config, type WindowLike } from "dompurify"

export {
	sanitizeCss,
	sanitizeHtml,
	sanitizeHtmlWithWindow,
	type SanitizeResult,
}

type SanitizeResult = {
	sanitized: string
	removedCount: number
	removedPatterns: string[]
}

function sanitizeCss(css: string): SanitizeResult {
	let sanitized = css
	let removedPatterns: string[] = []

	for (let { pattern, name } of dangerousPatterns) {
		if (pattern.test(sanitized)) {
			removedPatterns.push(name)
			sanitized = sanitized.replace(pattern, "/* removed: " + name + " */")
		}
		pattern.lastIndex = 0
	}

	return {
		sanitized,
		removedCount: removedPatterns.length,
		removedPatterns,
	}
}

function sanitizeHtml(html: string): SanitizeResult {
	return sanitizeHtmlWithPurifier(DOMPurify, html)
}

function sanitizeHtmlWithWindow(
	window: WindowLike,
	html: string,
): SanitizeResult {
	return sanitizeHtmlWithPurifier(DOMPurify(window), html)
}

function sanitizeHtmlWithPurifier(
	purifier: typeof DOMPurify,
	html: string,
): SanitizeResult {
	let removedPatterns: string[] = []
	let removedCount = 0

	purifier.addHook("uponSanitizeElement", (_node, data) => {
		if (data.tagName && purifyConfig.FORBID_TAGS?.includes(data.tagName)) {
			removedPatterns.push(`<${data.tagName}>`)
			removedCount++
		}
	})

	purifier.addHook("uponSanitizeAttribute", (_node, data) => {
		if (data.attrName) {
			if (
				(data.attrName === "href" || data.attrName === "src") &&
				data.attrValue?.toLowerCase().trim().startsWith("javascript:")
			) {
				removedPatterns.push(`${data.attrName}="javascript:..."`)
				removedCount++
			}
			if (data.attrName.startsWith("on")) {
				removedPatterns.push(`${data.attrName}`)
				removedCount++
			}
		}
	})

	let sanitized: string = purifier.sanitize(html, purifyConfig)

	purifier.removeHooks("uponSanitizeElement")
	purifier.removeHooks("uponSanitizeAttribute")

	let uniquePatterns = [...new Set(removedPatterns)]

	return {
		sanitized,
		removedCount,
		removedPatterns: uniquePatterns,
	}
}

let trustedFontDomains = [
	"fonts.googleapis.com",
	"fonts.gstatic.com",
	"use.typekit.net",
	"fast.fonts.net",
	"cloud.typography.com",
	"fonts.bunny.net",
	"rsms.me", // Inter font
	"api.fontshare.com",
]

function buildUntrustedImportPattern(): RegExp {
	let trustedPattern = trustedFontDomains
		.map(domain => domain.replace(/\./g, "\\."))
		.join("|")

	return new RegExp(
		`@import\\s+(?:url\\s*\\()?['"]?https?:\\/\\/(?!(?:${trustedPattern}))`,
		"gi",
	)
}

let dangerousPatterns: { pattern: RegExp; name: string }[] = [
	{ pattern: /javascript\s*:/gi, name: "javascript:" },
	{ pattern: /expression\s*\(/gi, name: "expression()" },
	{ pattern: /-moz-binding\s*:/gi, name: "-moz-binding" },
	{ pattern: /behavior\s*:/gi, name: "behavior:" },
	{ pattern: /vbscript\s*:/gi, name: "vbscript:" },
	{
		pattern: buildUntrustedImportPattern(),
		name: "@import untrusted external URL",
	},
	{
		pattern: /@import\s+(?:url\s*\()?['"]?\/\//gi,
		name: "@import protocol-relative URL",
	},
	{
		pattern: /url\s*\(\s*['"]?\s*data\s*:\s*text\/html/gi,
		name: "data:text/html URL",
	},
]

let purifyConfig: Config = {
	ALLOWED_TAGS: [
		"html",
		"head",
		"body",
		"main",
		"header",
		"footer",
		"nav",
		"aside",
		"section",
		"article",
		"div",
		"p",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"blockquote",
		"pre",
		"code",
		"hr",
		"ul",
		"ol",
		"li",
		"dl",
		"dt",
		"dd",
		"table",
		"thead",
		"tbody",
		"tfoot",
		"tr",
		"th",
		"td",
		"caption",
		"colgroup",
		"col",
		"span",
		"a",
		"strong",
		"b",
		"em",
		"i",
		"u",
		"s",
		"mark",
		"small",
		"sub",
		"sup",
		"br",
		"img",
		"figure",
		"figcaption",
		"picture",
		"source",
		"label",
		"input",
		"time",
		"abbr",
		"cite",
		"dfn",
		"kbd",
		"samp",
		"var",
		"address",
		"details",
		"summary",
		"style",
		"link",
		"meta",
		"title",
	],

	ALLOWED_ATTR: [
		"id",
		"class",
		"style",
		"title",
		"lang",
		"dir",
		"hidden",
		"tabindex",
		"href",
		"target",
		"rel",
		"src",
		"alt",
		"width",
		"height",
		"loading",
		"colspan",
		"rowspan",
		"scope",
		"aria-label",
		"aria-labelledby",
		"aria-describedby",
		"aria-hidden",
		"role",
		"charset",
		"name",
		"content",
		"type",
		"media",
		"placeholder",
		"value",
		"disabled",
		"readonly",
		"checked",
	],

	ADD_ATTR: ["data-document", "data-theme", "data-*"],

	FORBID_TAGS: [
		"script",
		"iframe",
		"object",
		"embed",
		"form",
		"button",
		"frame",
		"frameset",
		"portal",
		"applet",
		"base",
		"noscript",
	],

	FORBID_ATTR: [
		"onclick",
		"ondblclick",
		"onmousedown",
		"onmouseup",
		"onmouseover",
		"onmouseout",
		"onmousemove",
		"onmouseenter",
		"onmouseleave",
		"onkeydown",
		"onkeyup",
		"onkeypress",
		"onfocus",
		"onblur",
		"onchange",
		"oninput",
		"onsubmit",
		"onreset",
		"onload",
		"onerror",
		"onabort",
		"onresize",
		"onscroll",
		"onunload",
		"onbeforeunload",
		"onhashchange",
		"onpopstate",
		"onstorage",
		"onmessage",
		"onoffline",
		"ononline",
		"onpageshow",
		"onpagehide",
		"oncontextmenu",
		"oncopy",
		"oncut",
		"onpaste",
		"ondrag",
		"ondragend",
		"ondragenter",
		"ondragleave",
		"ondragover",
		"ondragstart",
		"ondrop",
		"onanimationstart",
		"onanimationend",
		"onanimationiteration",
		"ontransitionend",
		"onwheel",
		"ontouchstart",
		"ontouchend",
		"ontouchmove",
		"ontouchcancel",
		"onpointerdown",
		"onpointerup",
		"onpointermove",
		"onpointerenter",
		"onpointerleave",
		"onpointercancel",
		"onformdata",
		"onslotchange",
		"onplay",
		"onplaying",
		"onpause",
		"onended",
		"onseeked",
		"onseeking",
		"ontimeupdate",
		"onvolumechange",
		"onloadstart",
		"onprogress",
		"oncanplay",
		"oncanplaythrough",
		"ondurationchange",
		"onemptied",
		"onstalled",
		"onsuspend",
		"onwaiting",
		"onratechange",
		"onloadedmetadata",
		"onloadeddata",
		"formaction",
		"xlink:href",
		"xmlns:xlink",
		"srcdoc",
	],

	ALLOW_UNKNOWN_PROTOCOLS: false,
	USE_PROFILES: { html: true },
	RETURN_DOM: false,
	RETURN_DOM_FRAGMENT: false,
	WHOLE_DOCUMENT: false,
}
