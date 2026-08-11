import { messages, translate } from "@ccssmnn/intl"

export { basePresentationMessages, dePresentationMessages }

let basePresentationMessages = messages({
	"presentation.slideshow.label": "Slideshow",
	"presentation.slideshow.options": "Slideshow options",
	"presentation.slideshow.previous": "Previous slide",
	"presentation.slideshow.next": "Next slide",
	"presentation.slideshow.toggleFullscreen": "Toggle fullscreen",
	"presentation.slideshow.goToEditor": "Go to editor",
	"presentation.slideshow.goToTeleprompter": "Go to teleprompter",
	"presentation.teleprompter.label": "Teleprompter",
	"presentation.teleprompter.editor": "Editor",
	"presentation.teleprompter.slideshow": "Slideshow",
	"presentation.teleprompter.noSlides": "No slides found",
	"presentation.teleprompter.addHeadings":
		"Add headings (# or ##) to create slides",
	"presentation.teleprompter.backToEditor": "Back to Editor",
	"presentation.teleprompter.startPrompt":
		"Press any arrow key or click an item to start",
	"presentation.teleprompter.start": "Start Presentation",
	"presentation.teleprompter.prevSlide": "Prev Slide (←)",
	"presentation.teleprompter.prevItem": "Prev Item (↑)",
	"presentation.teleprompter.nextItem": "Next Item (↓)",
	"presentation.teleprompter.nextSlide": "Next Slide (→)",
	"presentation.teleprompter.resetTimer": "Click to reset timer",
	"presentation.slideshow.loading": "Loading...",
	"presentation.slideshow.loadingVideo": "Loading video...",
	"presentation.teleprompter.slideIndicator": "Slide {$index} / {$total}",
	"presentation.teleprompter.slideLabel": "Slide {$number}",
})

let dePresentationMessages = translate(basePresentationMessages, {
	"presentation.slideshow.label": "Präsentation",
	"presentation.slideshow.options": "Präsentationsoptionen",
	"presentation.slideshow.previous": "Vorherige Folie",
	"presentation.slideshow.next": "Nächste Folie",
	"presentation.slideshow.toggleFullscreen": "Vollbild umschalten",
	"presentation.slideshow.goToEditor": "Zum Editor",
	"presentation.slideshow.goToTeleprompter": "Zur Sprechunterstützung",
	"presentation.teleprompter.label": "Sprechunterstützung",
	"presentation.teleprompter.editor": "Editor",
	"presentation.teleprompter.slideshow": "Präsentation",
	"presentation.teleprompter.noSlides": "Keine Folien gefunden",
	"presentation.teleprompter.addHeadings":
		"Überschriften (# oder ##) hinzufügen, um Folien zu erstellen",
	"presentation.teleprompter.backToEditor": "Zurück zum Editor",
	"presentation.teleprompter.startPrompt":
		"Beliebige Pfeiltaste drücken oder Element anklicken zum Starten",
	"presentation.teleprompter.start": "Präsentation starten",
	"presentation.teleprompter.prevSlide": "Vorherige Folie (←)",
	"presentation.teleprompter.prevItem": "Vorheriges Element (↑)",
	"presentation.teleprompter.nextItem": "Nächstes Element (↓)",
	"presentation.teleprompter.nextSlide": "Nächste Folie (→)",
	"presentation.teleprompter.resetTimer": "Zum Zurücksetzen klicken",
	"presentation.slideshow.loading": "Wird geladen...",
	"presentation.slideshow.loadingVideo": "Video wird geladen...",
	"presentation.teleprompter.slideIndicator": "Folie {$index} / {$total}",
	"presentation.teleprompter.slideLabel": "Folie {$number}",
})
