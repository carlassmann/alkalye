import { submitDialog } from "./browser-driver"
import {
	assert,
	browser,
	evaluate,
	wait,
	currentDocument,
} from "./browser-driver"

export function verifyNativeAssets(session: string, source: string) {
	browser(session, "click", '[data-action="tools"]')
	evaluate(
		session,
		'let editor=document.querySelector("#editor"); editor.setSelectionRange(editor.value.length,editor.value.length); let picker=document.querySelector("#asset-files"); window.originalPickerClick = picker.click; picker.click = () => {}',
	)
	browser(session, "click", '[data-action="asset-upload"]')
	evaluate(
		session,
		`window.previewRevocations = []; window.previewRevokeViolations = []; window.originalRevoke = URL.revokeObjectURL; URL.revokeObjectURL = function(url) { window.previewRevocations.push(url); function contains(root) { for (let node of root.querySelectorAll('*')) { if ((node.getAttribute('src') ?? '').split('#')[0] === url) return true; if (node.shadowRoot && contains(node.shadowRoot)) return true } return false }; if (contains(document)) window.previewRevokeViolations.push(url); return window.originalRevoke(url) }`,
	)
	evaluate(
		session,
		'(async()=>{let editor=document.querySelector("#editor");editor.setSelectionRange(editor.value.length,editor.value.length);let canvas=document.createElement("canvas");canvas.width=3000;canvas.height=1000;canvas.getContext("2d").fillRect(0,0,3000,1000);let blob=await new Promise(resolve=>canvas.toBlob(resolve));let transfer=new DataTransfer();transfer.items.add(new File([blob],"Native-image.png",{type:"image/png"}));let input=document.querySelector("#asset-files");input.files=transfer.files;input.dispatchEvent(new Event("change"))})()',
	)
	wait(
		session,
		'document.querySelector("#editor").value.includes("Native-image.webp") && document.querySelectorAll("[data-attachments] .asset-row").length === 1',
	)
	let asset = String(
		evaluate(
			session,
			'document.querySelector("[data-attachments] .asset-row").dataset.assetId',
		),
	)
	evaluate(
		session,
		'document.querySelector("#asset-files").click = window.originalPickerClick; delete window.originalPickerClick',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("alkalye-editor").source.value.includes("asset:")',
		),
		"native picker durably attaches the image and its anchored source reference",
	)
	evaluate(
		session,
		'document.querySelector("alkalye-editor").source.setSelectionRange(0,0)',
	)
	wait(
		session,
		'document.querySelector("[data-editor-links] a[data-kind=media]") !== null',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#highlight .syntax-link-icon svg") !== null && !document.querySelector("#editor").value.includes("asset:")',
		),
		"Editor image references become icon labels outside the cursor",
	)
	browser(session, "click", "[data-editor-links] a[data-kind=media]")
	wait(
		session,
		'document.querySelector("#dialog img[data-image-preview]")?.naturalWidth === 2048',
	)
	evaluate(
		session,
		'window.previousPreviewForm = document.querySelector("#dialog form"); document.querySelector("[data-editor-links] a[data-kind=media]").click()',
	)
	wait(
		session,
		'document.querySelector("#dialog").open && document.querySelector("#dialog form") !== window.previousPreviewForm && document.querySelector("#dialog img[data-image-preview]")?.naturalWidth === 2048',
	)
	assert(
		true,
		"Replacing an editor preview releases the old form without closing the new dialog",
	)
	let inlineUrl = String(
		evaluate(
			session,
			'document.querySelector("#dialog img[data-image-preview]").src',
		),
	).split("#")[0]
	assert(
		true,
		"An image opens directly from its editor label before visiting Preview",
	)
	browser(session, "click", ".dialog-close")
	wait(
		session,
		`window.previewRevocations.includes(${JSON.stringify(inlineUrl)})`,
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#dialog [data-image-preview]") === null && window.previewRevokeViolations.length === 0',
		),
		"Closing an editor preview removes its media before releasing the blob URL",
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector("img")?.naturalWidth === 2048',
	)
	assert(
		true,
		"native media preview resolves journal assets after image downscaling",
	)
	let firstUrl = String(
		evaluate(
			session,
			'document.querySelector("#preview").shadowRoot.querySelector("img").src',
		),
	)
	let imageDigest = `fetch(document.querySelector("#preview").shadowRoot.querySelector("img").src).then(response => response.arrayBuffer()).then(bytes => crypto.subtle.digest("SHA-256", bytes)).then(hash => Array.from(new Uint8Array(hash)).join(","))`
	let firstDigest = evaluate(session, imageDigest)
	browser(session, "click", `[data-action="asset-rename:${asset}"]`)
	submitDialog(session, "Renamed image")
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'document.querySelector("[data-attachments] .asset-row").textContent.includes("Renamed image") && document.querySelector("#preview").shadowRoot.querySelector("img")?.naturalWidth === 2048',
	)
	assert(
		evaluate(session, imageDigest) === firstDigest,
		"native attachment renaming preserves its image contents",
	)
	assert(
		evaluate(
			session,
			`!document.querySelector('[data-action="asset-mute:${asset}"]')`,
		),
		"image attachments expose no audio-mute control",
	)
	browser(session, "click", ".preview-back")
	browser(session, "click", '[data-action="slideshow"]')
	browser(session, "press", "ArrowRight")
	wait(
		session,
		'document.querySelector("#slide").shadowRoot.querySelector("img") !== null',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#slide").shadowRoot.querySelector(".theme").dataset.mode',
		) === "slideshow",
		"native presentation renders media in the slide template",
	)
	browser(session, "press", "Escape")
	browser(session, "click", '[data-action="teleprompter"]')
	assert(
		evaluate(
			session,
			'document.querySelector("#slide").shadowRoot.querySelector(".theme").dataset.mode',
		) === "slideshow",
		"native teleprompter audience view uses the slide template",
	)
	browser(session, "press", "Escape")
	wait(session, `fetch(${JSON.stringify(firstUrl)}).then(()=>false,()=>true)`)
	assert(
		true,
		"returning to the native editor releases its preview URL after unmounting media",
	)
	evaluate(
		session,
		'{let editor=document.querySelector("#editor");editor.setSelectionRange(editor.value.length,editor.value.length);let transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([1,2,3])],"Native-video.webm",{type:"video/webm"}));editor.dispatchEvent(new ClipboardEvent("paste",{clipboardData:transfer,bubbles:true,cancelable:true}))}',
	)
	wait(
		session,
		'document.querySelectorAll("[data-attachments] .asset-row").length === 2 && document.querySelector("#editor").value.includes("Native-video.webm")',
	)
	let video = String(
		evaluate(
			session,
			'[...document.querySelectorAll("[data-attachments] .asset-row")].find(row=>row.textContent.includes("Native-video.webm")).dataset.assetId',
		),
	)
	assert(
		true,
		"native paste stores a video through the same whole-document attachment producer",
	)
	evaluate(
		session,
		'document.querySelector("alkalye-editor").source.setSelectionRange(0,0)',
	)
	wait(
		session,
		'document.querySelector(".syntax-link-icon[data-icon=film]") !== null',
	)
	browser(
		session,
		"click",
		'[data-editor-links] a[aria-label="Native-video.webm"]',
	)
	wait(
		session,
		'document.querySelector("#dialog video[data-image-preview]")?.controls === true',
	)
	evaluate(
		session,
		'window.editorPreviewVideo = document.querySelector("#dialog video"); true',
	)
	browser(session, "click", ".dialog-close")
	wait(
		session,
		'window.editorPreviewVideo.paused && !window.editorPreviewVideo.isConnected && !window.editorPreviewVideo.hasAttribute("src")',
	)
	assert(
		true,
		"Video labels use the stored MIME type and closing their preview stops playback",
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector("video") !== null',
	)
	evaluate(
		session,
		'window.previewVideo = document.querySelector("#preview").shadowRoot.querySelector("video")',
	)
	evaluate(
		session,
		`document.querySelector('[data-action="asset-mute:${video}"]').click()`,
	)
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector("video").muted === true',
	)
	assert(
		evaluate(
			session,
			'document.querySelector("#preview").shadowRoot.querySelector("video") === window.previewVideo',
		),
		"native mute records a document action while preserving the playing media element",
	)
	let earlierViolations = Number(
		evaluate(session, "window.previewRevokeViolations.length"),
	)
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	wait(session, "!!navigator.serviceWorker.controller")
	browser(session, "set", "offline", "on")
	// The preview's own address reopens offline in preview.
	browser(session, "reload")
	wait(
		session,
		'location.pathname.endsWith("/preview") && document.querySelector("#preview") !== null',
	)
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector("img")?.naturalWidth === 2048 && document.querySelector("#preview").shadowRoot.querySelector("video")?.muted === true',
	)
	assert(
		evaluate(
			session,
			'document.querySelectorAll("[data-attachments] .asset-row").length === 2 && performance.getEntriesByType("resource").every(entry => !entry.name.includes("/api/documents/"))',
		),
		"native offline snapshot restores attachment manifests, verified bytes and mute state without downloading history",
	)
	let original = String(evaluate(session, currentDocument))
	browser(session, "click", ".preview-back")
	browser(session, "click", '[data-action="duplicate"]')
	wait(
		session,
		`${currentDocument} !== ${JSON.stringify(original)} && document.querySelector("#editor")?.value.includes("Native-video.webm")`,
	)
	browser(session, "click", '[data-action="preview"]')
	wait(
		session,
		'document.querySelector("#preview").shadowRoot.querySelector("img")?.naturalWidth === 2048 && document.querySelector("#preview").shadowRoot.querySelector("video")?.muted === true',
	)
	assert(
		true,
		"offline document copies retain verified attachment bytes in their independent cache",
	)
	browser(session, "click", ".preview-back")
	browser(session, "click", `[data-doc="${original}"]`)
	wait(session, `${currentDocument} === ${JSON.stringify(original)}`)
	browser(session, "set", "offline", "off")
	evaluate(session, 'window.dispatchEvent(new Event("focus"))')
	evaluate(
		session,
		`window.previewRevokeViolations = []; window.originalRevoke = URL.revokeObjectURL; URL.revokeObjectURL = function(url) { function contains(root) { for (let node of root.querySelectorAll('*')) { if ((node.getAttribute('src') ?? '').split('#')[0] === url) return true; if (node.shadowRoot && contains(node.shadowRoot)) return true } return false }; if (contains(document)) window.previewRevokeViolations.push(url); return window.originalRevoke(url) }`,
	)
	for (let id of [asset, video]) {
		browser(session, "click", `[data-action="asset-delete:${id}"]`)
		submitDialog(session)
	}
	wait(
		session,
		'document.querySelectorAll("[data-attachments] .asset-row").length === 0 && !document.querySelector("alkalye-editor").source.value.includes("asset:")',
	)
	assert(
		true,
		"native deletion removes each manifest and source reference together",
	)
	assert(
		earlierViolations === 0 &&
			evaluate(session, "window.previewRevokeViolations.length === 0"),
		"native preview and presentation never revoke a URL still referenced in mounted Shadow DOM",
	)
	evaluate(
		session,
		"URL.revokeObjectURL = window.originalRevoke; delete window.originalRevoke; delete window.previewVideo",
	)
	browser(session, "fill", "#editor", source)
	wait(
		session,
		'document.querySelector("#save-status").textContent === "Saved"',
	)
	browser(session, "click", '[data-action="slideshow"]')
	browser(session, "press", "ArrowLeft")
	browser(session, "press", "Escape")
}
