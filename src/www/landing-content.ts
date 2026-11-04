import type { DemoSceneId } from "#www/demo/demo-script"

export { landingContent }
export type { LandingLocale, LandingContent }

type LandingLocale = "en" | "de"

interface FeatureGroup {
	title: string
	items: { name: string; body: string }[]
}

interface LandingContent {
	htmlLang: LandingLocale
	otherLocale: LandingLocale
	pageTitle: string
	metaDescription: string
	nav: { open: string; switchLanguage: string }
	hero: {
		badge: string
		title: string
		lede: string
		primaryAction: string
		secondaryAction: string
		facts: string[]
		sampleCaption: string
	}
	demo: {
		title: string
		lede: string
		scenes: { id: DemoSceneId; title: string; body: string }[]
		tldrawCredit: { before: string; link: string; after: string }
	}
	twin: { title: string; body: string }
	story: { title: string; paragraphs: string[]; attribution: string }
	features: { title: string; lede: string; groups: FeatureGroup[] }
	files: {
		title: string
		lede: string
		items: { name: string; body: string; code?: string }[]
	}
	privacy: { title: string; points: string[] }
	recent: { title: string; all: string; note?: string }
	closing: { title: string; body: string; action: string }
	footer: {
		license: string
		docs: string
		changelog: string
		support: string
		imprint: string
		privacy: string
	}
}

let en: LandingContent = {
	htmlLang: "en",
	otherLocale: "de",
	pageTitle: "Alkalye - Encrypted Markdown editor for notes, docs and slides",
	metaDescription:
		"Write Markdown offline, sync it end-to-end encrypted, edit together with live cursors, and present the same file as slides with a phone teleprompter. Free public beta, MIT licensed.",
	nav: { open: "Open Alkalye", switchLanguage: "Deutsch" },
	hero: {
		badge: "Free public beta",
		title: "Write in Markdown. Share it, present it, keep it.",
		lede: "Alkalye is a Markdown editor that runs in your browser and installs as an app. It works offline and syncs end-to-end encrypted. One document can be a note, a shared draft or a slideshow.",
		primaryAction: "Start writing",
		secondaryAction: "See what it does",
		facts: ["No account needed to start", "Works offline", "MIT licensed"],
		sampleCaption:
			"A presentation is a document with one line of frontmatter. Each --- starts a slide, and unindented lines are speaker notes.",
	},
	demo: {
		title: "Alkalye in action",
		lede: "Scroll on and the document beside this text writes, syncs and presents itself. It is the real editor, preview, slideshow and teleprompter from the app, playing a scripted example. Nothing is saved or sent.",
		scenes: [
			{
				id: "write",
				title: "Write in plain Markdown",
				body: "A heading is a #, a slide line is indented, everything else is your note. The file stays readable in any text editor.",
			},
			{
				id: "together",
				title: "Write together, live",
				body: "Share a link and see who is typing where. Each change is encrypted on the writer's device before it syncs, so the server only stores data it cannot read.",
			},
			{
				id: "preview",
				title: "Read it as a page",
				body: "Preview renders the same text as a styled document. Pick a built-in theme or bring your own HTML and CSS.",
			},
			{
				id: "present",
				title: "Present the same file",
				body: "Add mode: present to the frontmatter and the document becomes a slideshow. Every --- starts a new slide, and only indented lines appear on it.",
			},
			{
				id: "teleprompter",
				title: "Keep your notes on your phone",
				body: "The teleprompter shows slides and speaker notes together and follows along as you present, on the same device or another one.",
			},
			{
				id: "whiteboard",
				title: "Sketch on a whiteboard",
				body: "Insert a whiteboard into any document and draw on an infinite canvas. It shows up as an image in the text, the preview and your slides.",
			},
		],
		tldrawCredit: {
			before: "Whiteboards are powered by ",
			link: "tldraw",
			after:
				". Alkalye uses it under a free hobby license, and it is simply a joy to draw with.",
		},
	},
	twin: {
		title: "Questions before you start?",
		body: "Ask Carl's Syntwin why he built Alkalye, how he uses it, or how to get started. You can ask about his other projects too. Syntwin is an AI, not Carl live.",
	},
	story: {
		title: "Even one person needs multiplayer",
		paragraphs: [
			"I admire iA Writer and iA Presenter. While building Tilly, I wrote notes on my phone about what to improve, then opened those same notes on my Mac to work on them. iA Writer asked which version to keep. It was just me, on two devices. I wanted a writing app that treated that as normal.",
			"On Christmas Eve, with my kid asleep and my wife reading, I decided to try building it. The editing experience and typography came first. Three hours with Claude Opus 4.5 got me an editor I wanted to write in. I spent the next few days turning it into an app, then added slides and a teleprompter inspired by iA Presenter. Seven days after the first commit, I published Alkalye.",
			"I've extended it a lot since then and made it open source. Today I use Alkalye for all my talks, presentations and notes, across all my devices.",
		],
		attribution: "Carl Assmann, creator of Alkalye",
	},
	features: {
		title: "What you can do",
		lede: "Everything below is in the app today. The changelog has the details.",
		groups: [
			{
				title: "Write",
				items: [
					{
						name: "Markdown editor",
						body: "Formatting shortcuts, multiple cursors, find, word count, and a right-click menu. Start typing anywhere and the text lands at the end of the document.",
					},
					{
						name: "Linked notes",
						body: "Type [[ to link another document. Backlinks show what points to each note.",
					},
					{
						name: "Images, videos and whiteboards",
						body: "Drop media into a document, or insert a whiteboard and draw on an infinite canvas.",
					},
					{
						name: "Folders, tags and keyboard",
						body: "Organize in the sidebar with folders, pins and tags. Move, select and drag documents from the keyboard, or run any action from the command palette.",
					},
				],
			},
			{
				title: "Present",
				items: [
					{
						name: "Slides from the same file",
						body: "Add mode: present to the frontmatter. Separate slides with ---. Indented lines go on the slide, the rest are your notes.",
					},
					{
						name: "Teleprompter and laser pointer",
						body: "Run the slideshow on one screen and the teleprompter on your phone or laptop. Highlight text or draw fading laser trails on the slide.",
					},
					{
						name: "Themes and PDF",
						body: "Style the preview and slides with built-in or custom HTML/CSS themes. Print slides only or notes pages, in 16:9 or 4:3.",
					},
				],
			},
			{
				title: "Share",
				items: [
					{
						name: "Links with roles",
						body: "Invite people to read or edit, or make a document public. Live cursors show who is writing where.",
					},
					{
						name: "Spaces",
						body: "Group documents into a space and invite people to all of it, as admin, manager, writer or reader.",
					},
					{
						name: "Comments",
						body: "Comment inline, reply and resolve threads where the text is.",
					},
				],
			},
			{
				title: "Keep",
				items: [
					{
						name: "Time Machine",
						body: "Step or sweep through a document's history and restore any earlier version.",
					},
					{
						name: "Offline and installable",
						body: "Install it on iPhone, Android, Mac, Windows or Linux. Writing works without a connection and syncs when you are back.",
					},
					{
						name: "Plain files out",
						body: "Title, tags and presentation settings live in the frontmatter. Download any document as .md or PDF.",
					},
				],
			},
		],
	},
	files: {
		title: "Your files, your tools",
		lede: "Alkalye also works with Markdown outside the app.",
		items: [
			{
				name: "Local folders",
				body: "In Chromium-based browsers such as Chrome and Edge, open a folder from your disk. Alkalye edits the files in place, so Claude Code, OpenCode or git can work on the same files.",
			},
			{
				name: "Command line",
				body: "Read and write documents, manage themes, media and sharing, and export PDFs from the terminal.",
				code: "alkalye doc export",
			},
			{
				name: "MCP for AI apps",
				body: "Connect ChatGPT, Claude, Cursor or another MCP client in Settings. It gets your permissions, and you can disconnect it at any time.",
				code: "https://www.alkalye.com/mcp",
			},
		],
	},
	privacy: {
		title: "Privacy, plainly",
		points: [
			"Documents are encrypted on your device before they sync. The sync server stores data it cannot read.",
			"You can start without an account. Sign in with a passphrase to sync across devices. It stays on your device.",
			"Connecting an MCP client is the exception: the hosted server then holds your account key and can decrypt what that client asks for.",
			"Open source under the MIT license. You can run it with your own sync server.",
		],
	},
	recent: { title: "Recently shipped", all: "Full changelog" },
	closing: {
		title: "Open a blank document",
		body: "No email, no credit card. Start writing and decide later whether to sign in.",
		action: "Start writing",
	},
	footer: {
		license: "MIT licensed",
		docs: "Docs",
		changelog: "What's new",
		support: "Support",
		imprint: "Imprint",
		privacy: "Privacy",
	},
}

let de: LandingContent = {
	htmlLang: "de",
	otherLocale: "en",
	pageTitle:
		"Alkalye - Verschlüsselter Markdown-Editor für Notizen, Texte und Folien",
	metaDescription:
		"Schreibe Markdown offline, synchronisiere Ende-zu-Ende-verschlüsselt, bearbeite gemeinsam mit Live-Cursorn und präsentiere dieselbe Datei als Folien mit Handy-Teleprompter. Kostenlose öffentliche Beta, MIT-Lizenz.",
	nav: { open: "Alkalye öffnen", switchLanguage: "English" },
	hero: {
		badge: "Kostenlose öffentliche Beta",
		title: "Schreib in Markdown. Teile es, präsentiere es, behalte es.",
		lede: "Alkalye ist ein Markdown-Editor, der im Browser läuft und sich als App installieren lässt. Er funktioniert offline und synchronisiert Ende-zu-Ende-verschlüsselt. Ein Dokument kann Notiz, gemeinsamer Entwurf oder Präsentation sein.",
		primaryAction: "Losschreiben",
		secondaryAction: "Was es kann",
		facts: ["Kein Konto zum Start nötig", "Funktioniert offline", "MIT-Lizenz"],
		sampleCaption:
			"Eine Präsentation ist ein Dokument mit einer Zeile Frontmatter. Jedes --- beginnt eine Folie, nicht eingerückte Zeilen sind Sprechernotizen.",
	},
	demo: {
		title: "Alkalye in Aktion",
		lede: "Scroll weiter, und das Dokument neben diesem Text schreibt, synchronisiert und präsentiert sich selbst. Es sind der echte Editor, die Vorschau, die Präsentation und der Teleprompter aus der App mit einem vorbereiteten Beispiel. Nichts wird gespeichert oder gesendet.",
		scenes: [
			{
				id: "write",
				title: "Schreib in schlichtem Markdown",
				body: "Eine Überschrift ist ein #, eine Folienzeile ist eingerückt, alles andere ist deine Notiz. Die Datei bleibt in jedem Texteditor lesbar.",
			},
			{
				id: "together",
				title: "Gemeinsam schreiben, live",
				body: "Teile einen Link und sieh, wer wo tippt. Jede Änderung wird auf dem Gerät der schreibenden Person verschlüsselt, bevor sie synchronisiert wird. Der Server speichert nur Daten, die er nicht lesen kann.",
			},
			{
				id: "preview",
				title: "Als Seite lesen",
				body: "Die Vorschau zeigt denselben Text als gestaltetes Dokument. Wähle ein eingebautes Theme oder bring eigenes HTML und CSS mit.",
			},
			{
				id: "present",
				title: "Dieselbe Datei präsentieren",
				body: "Füge mode: present im Frontmatter hinzu, und das Dokument wird zur Präsentation. Jedes --- beginnt eine neue Folie, und nur eingerückte Zeilen erscheinen darauf.",
			},
			{
				id: "teleprompter",
				title: "Notizen auf dem Handy",
				body: "Der Teleprompter zeigt Folien und Sprechernotizen zusammen und läuft beim Präsentieren mit, auf demselben oder einem anderen Gerät.",
			},
			{
				id: "whiteboard",
				title: "Auf dem Whiteboard skizzieren",
				body: "Füge in jedes Dokument ein Whiteboard ein und zeichne auf einer unendlichen Fläche. Es erscheint als Bild im Text, in der Vorschau und auf deinen Folien.",
			},
		],
		tldrawCredit: {
			before: "Whiteboards laufen mit ",
			link: "tldraw",
			after:
				". Alkalye nutzt es mit einer kostenlosen Hobby-Lizenz, und es macht einfach Freude, damit zu zeichnen.",
		},
	},
	twin: {
		title: "Fragen, bevor du loslegst?",
		body: "Frag Carls Syntwin, warum er Alkalye gebaut hat, wie er es nutzt oder wie du loslegst. Du kannst auch nach seinen anderen Projekten fragen. Syntwin ist eine KI, nicht Carl live.",
	},
	story: {
		title: "Auch eine Person braucht Multiplayer",
		paragraphs: [
			"Ich bewundere iA Writer und iA Presenter. Als ich Tilly entwickelt habe, schrieb ich auf dem Handy auf, was ich verbessern wollte. Dann öffnete ich dieselben Notizen auf dem Mac, um daran zu arbeiten. iA Writer fragte, welche Version ich behalten wollte. Dabei war ich nur eine Person mit zwei Geräten. Ich wollte eine Schreib-App, für die das normal ist.",
			"An Heiligabend, als mein Kind schlief und meine Frau las, habe ich es ausprobiert. Schreibgefühl und Typografie kamen zuerst. Nach drei Stunden mit Claude Opus 4.5 hatte ich einen Editor, in dem ich schreiben wollte. In den nächsten Tagen wurde daraus eine App. Dann kamen Folien und Teleprompter dazu, inspiriert von iA Presenter. Sieben Tage nach dem ersten Commit habe ich Alkalye veröffentlicht.",
			"Seitdem habe ich Alkalye stark erweitert und als Open Source veröffentlicht. Heute nutze ich es für alle meine Vorträge, Präsentationen und Notizen, auf all meinen Geräten.",
		],
		attribution: "Carl Assmann, Entwickler von Alkalye",
	},
	features: {
		title: "Was du damit machen kannst",
		lede: "Alles hier ist heute in der App. Details stehen im Changelog.",
		groups: [
			{
				title: "Schreiben",
				items: [
					{
						name: "Markdown-Editor",
						body: "Formatierungs-Kurzbefehle, mehrere Cursor, Suche, Wortzählung und Kontextmenü. Tipp einfach los, der Text landet am Ende des Dokuments.",
					},
					{
						name: "Verknüpfte Notizen",
						body: "Tippe [[, um ein anderes Dokument zu verlinken. Backlinks zeigen, was auf eine Notiz verweist.",
					},
					{
						name: "Bilder, Videos und Whiteboards",
						body: "Zieh Medien ins Dokument oder füge ein Whiteboard ein und zeichne auf einer unendlichen Fläche.",
					},
					{
						name: "Ordner, Tags und Tastatur",
						body: "Ordne in der Seitenleiste mit Ordnern, Pins und Tags. Dokumente per Tastatur auswählen, verschieben und ziehen, jede Aktion über die Befehlspalette.",
					},
				],
			},
			{
				title: "Präsentieren",
				items: [
					{
						name: "Folien aus derselben Datei",
						body: "Schreib mode: present ins Frontmatter. Trenne Folien mit ---. Eingerückte Zeilen kommen auf die Folie, der Rest sind deine Notizen.",
					},
					{
						name: "Teleprompter und Laserpointer",
						body: "Die Präsentation läuft auf einem Bildschirm, der Teleprompter auf Handy oder Laptop. Markiere Text oder zeichne verblassende Laserspuren auf die Folie.",
					},
					{
						name: "Designs und PDF",
						body: "Gestalte Vorschau und Folien mit mitgelieferten oder eigenen HTML/CSS-Designs. Drucke nur Folien oder Notizseiten, in 16:9 oder 4:3.",
					},
				],
			},
			{
				title: "Teilen",
				items: [
					{
						name: "Links mit Rollen",
						body: "Lade Leute zum Lesen oder Bearbeiten ein oder mach ein Dokument öffentlich. Live-Cursor zeigen, wer wo schreibt.",
					},
					{
						name: "Spaces",
						body: "Fasse Dokumente in einem Space zusammen und lade Leute für alles auf einmal ein, als Admin, Manager, Autor oder Leser.",
					},
					{
						name: "Kommentare",
						body: "Kommentiere direkt im Text, antworte und schließe Diskussionen dort, wo sie hingehören.",
					},
				],
			},
			{
				title: "Behalten",
				items: [
					{
						name: "Time Machine",
						body: "Geh Schritt für Schritt durch die Historie eines Dokuments und stelle jede frühere Version wieder her.",
					},
					{
						name: "Offline und installierbar",
						body: "Installiere es auf iPhone, Android, Mac, Windows oder Linux. Schreiben klappt ohne Verbindung, synchronisiert wird, sobald du wieder online bist.",
					},
					{
						name: "Einfache Dateien",
						body: "Titel, Tags und Präsentationseinstellungen stehen im Frontmatter. Lade jedes Dokument als .md oder PDF herunter.",
					},
				],
			},
		],
	},
	files: {
		title: "Deine Dateien, deine Werkzeuge",
		lede: "Alkalye arbeitet auch mit Markdown außerhalb der App.",
		items: [
			{
				name: "Lokale Ordner",
				body: "In Chromium-Browsern wie Chrome und Edge öffnest du einen Ordner von deiner Festplatte. Alkalye bearbeitet die Dateien direkt, sodass Claude Code, OpenCode oder git an denselben Dateien arbeiten können.",
			},
			{
				name: "Kommandozeile",
				body: "Dokumente lesen und schreiben, Designs, Medien und Freigaben verwalten und PDFs exportieren, alles im Terminal.",
				code: "alkalye doc export",
			},
			{
				name: "MCP für KI-Apps",
				body: "Verbinde ChatGPT, Claude, Cursor oder einen anderen MCP-Client in den Einstellungen. Er bekommt deine Berechtigungen, und du kannst ihn jederzeit trennen.",
				code: "https://www.alkalye.com/mcp",
			},
		],
	},
	privacy: {
		title: "Datenschutz, klar gesagt",
		points: [
			"Dokumente werden auf deinem Gerät verschlüsselt, bevor sie synchronisiert werden. Der Sync-Server speichert Daten, die er nicht lesen kann.",
			"Du kannst ohne Konto anfangen. Mit einer Passphrase meldest du dich an und synchronisierst zwischen Geräten. Sie bleibt auf deinem Gerät.",
			"Ausnahme ist ein verbundener MCP-Client: Dann hält der gehostete Server deinen Kontoschlüssel und kann entschlüsseln, was dieser Client abfragt.",
			"Open Source unter MIT-Lizenz. Du kannst es mit deinem eigenen Sync-Server betreiben.",
		],
	},
	recent: {
		title: "Zuletzt erschienen",
		all: "Ganzer Changelog",
		note: "Der Changelog erscheint auf Englisch.",
	},
	closing: {
		title: "Öffne ein leeres Dokument",
		body: "Keine E-Mail, keine Kreditkarte. Schreib los und entscheide später, ob du dich anmeldest.",
		action: "Losschreiben",
	},
	footer: {
		license: "MIT-Lizenz",
		docs: "Doku",
		changelog: "Neuigkeiten",
		support: "Support",
		imprint: "Impressum",
		privacy: "Datenschutz",
	},
}

let landingContent: Record<LandingLocale, LandingContent> = { en, de }
