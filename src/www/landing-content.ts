import type { DemoSceneId, DemoStageLabels } from "#www/demo/demo-script"

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
	}
	demo: {
		title: string
		lede: string
		stage: DemoStageLabels
		caption: string
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
		lede: "Alkalye is a Markdown editor for notes, drafts and talks. Write on any device, even offline, edit together with live cursors, and present the same file as slides. Everything syncs end-to-end encrypted.",
		primaryAction: "Start writing",
		secondaryAction: "See what it does",
		facts: ["No account needed to start", "Works offline", "MIT licensed"],
	},
	demo: {
		title: "From blog post to talk",
		stage: {
			fileName: "why-i-built-alkalye.md",
			views: {
				editor: "Write",
				review: "Comments",
				whiteboard: "Whiteboard",
				timemachine: "Time machine",
				present: "Present",
			},
			you: "You",
			hints: {
				editor: "Click and type. Your words stay in the document.",
				review: "Click and type. Your words stay in the document.",
				whiteboard: "Click to draw. Your sketch goes on the slide.",
				timemachine: "Drag the slider through the history",
				present: "Click to change slides",
			},
		},
		caption: "Scroll to play. Click in to join. Nothing is saved or sent.",
		lede: "Scroll to follow a blog post about Alkalye becoming a talk: written on Carl's Mac and phone, reviewed by an agent, all the way to the stage. It is the real editor, comments, whiteboard, time machine, slideshow and teleprompter from the app, playing a scripted example. Click into it to type, draw, rewind or present yourself. Nothing is saved or sent.",
		scenes: [
			{
				id: "devices",
				title: "Same post, other device",
				body: "Carl picks up the phone and keeps writing while the Mac is still open. Each device is just another cursor in the same document, synced end-to-end encrypted. No export, no “which version do you want to keep?”.",
			},
			{
				id: "review",
				title: "An agent reviews it",
				body: "Through the alkalye CLI, an agent fixes a typo and leaves comments, right in the document. A friend with the link can do the same.",
			},
			{
				id: "slides",
				title: "The post becomes a talk",
				body: "One line of frontmatter, mode: present, and every --- starts a slide. Headings and indented lines go on the slide, everything else stays as speaker notes.",
			},
			{
				id: "sketch",
				title: "A sketch for one slide",
				body: "Insert a whiteboard and draw on an infinite canvas. It shows up as an image in the text and on the slides.",
			},
			{
				id: "toomuch",
				title: "A week later, it is too much",
				body: "The phone added rockets, the agent added a slide nobody asked for. Undo only knows the last edits on this device. It cannot reach back across devices, people and days.",
			},
			{
				id: "history",
				title: "The time machine goes back",
				body: "Alkalye keeps every edit from every device and every person. Drag back to the version before it got messy, then restore it or keep a copy.",
			},
			{
				id: "present",
				title: "On stage",
				body: "The Mac shows the slides. The phone is the teleprompter, with the speaker notes for each slide, following along with every click.",
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
		body: "Ask Carl's Syntwin why Carl built Alkalye, how Carl uses it, or how to get started. You can ask about Carl's other projects too. Syntwin is an AI, not Carl live.",
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
		lede: "Beyond what the talk above shows, this is all in the app today. The changelog has the details.",
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
						name: "Images and videos",
						body: "Drop media into a document. It shows up in the preview and on your slides.",
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
						name: "Laser pointer",
						body: "Highlight text or draw fading laser trails on the slide, also from the teleprompter on your phone.",
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
		lede: "Alkalye ist ein Markdown-Editor für Notizen, Entwürfe und Vorträge. Schreib auf jedem Gerät, auch offline, bearbeite gemeinsam mit Live-Cursorn und präsentiere dieselbe Datei als Folien. Alles synchronisiert Ende-zu-Ende-verschlüsselt.",
		primaryAction: "Losschreiben",
		secondaryAction: "Was es kann",
		facts: ["Kein Konto zum Start nötig", "Funktioniert offline", "MIT-Lizenz"],
	},
	demo: {
		title: "Vom Blogpost zum Vortrag",
		stage: {
			fileName: "warum-alkalye.md",
			views: {
				editor: "Schreiben",
				review: "Kommentare",
				whiteboard: "Whiteboard",
				timemachine: "Zeitmaschine",
				present: "Präsentieren",
			},
			you: "Du",
			hints: {
				editor: "Klick und schreib. Deine Worte bleiben im Dokument.",
				review: "Klick und schreib. Deine Worte bleiben im Dokument.",
				whiteboard: "Klick zum Zeichnen. Deine Skizze kommt auf die Folie.",
				timemachine: "Zieh den Regler durch die Geschichte",
				present: "Klick für die nächste Folie",
			},
		},
		caption:
			"Scroll zum Abspielen. Klick hinein, um mitzumachen. Nichts wird gespeichert oder gesendet.",
		lede: "Scroll weiter und sieh zu, wie aus einem Blogpost über Alkalye ein Vortrag wird: geschrieben auf Carls Mac und Handy, geprüft von einem Agenten, bis auf die Bühne. Es sind der echte Editor, Kommentare, Whiteboard, Zeitmaschine, Präsentation und Teleprompter aus der App mit einem vorbereiteten Beispiel. Klick hinein, um selbst zu schreiben, zu zeichnen, zurückzuspulen oder zu präsentieren. Nichts wird gespeichert oder gesendet.",
		scenes: [
			{
				id: "devices",
				title: "Derselbe Post, anderes Gerät",
				body: "Carl nimmt das Handy und schreibt weiter, während der Mac noch offen ist. Jedes Gerät ist nur ein weiterer Cursor im selben Dokument, Ende-zu-Ende-verschlüsselt synchronisiert. Kein Export, kein „Welche Version willst du behalten?“.",
			},
			{
				id: "review",
				title: "Ein Agent liest gegen",
				body: "Über die alkalye-CLI korrigiert ein Agent einen Fehler und hinterlässt Kommentare, direkt im Dokument. Eine Freundin mit dem Link kann dasselbe.",
			},
			{
				id: "slides",
				title: "Aus dem Post wird ein Vortrag",
				body: "Eine Zeile Frontmatter, mode: present, und jedes --- beginnt eine Folie. Überschriften und eingerückte Zeilen kommen auf die Folie, alles andere bleibt Sprechernotiz.",
			},
			{
				id: "sketch",
				title: "Eine Skizze für eine Folie",
				body: "Füge ein Whiteboard ein und zeichne auf einer unendlichen Fläche. Es erscheint als Bild im Text und auf den Folien.",
			},
			{
				id: "toomuch",
				title: "Eine Woche später ist es zu viel",
				body: "Das Handy hat Raketen eingefügt, der Agent eine Folie, um die niemand gebeten hat. Rückgängig kennt nur die letzten Änderungen auf diesem Gerät. Über Geräte, Personen und Tage hinweg reicht es nicht zurück.",
			},
			{
				id: "history",
				title: "Die Zeitmaschine geht zurück",
				body: "Alkalye behält jede Änderung von jedem Gerät und jeder Person. Zieh zurück zur Version, bevor es unübersichtlich wurde, und stell sie wieder her oder behalte eine Kopie.",
			},
			{
				id: "present",
				title: "Auf der Bühne",
				body: "Der Mac zeigt die Folien. Das Handy ist der Teleprompter mit den Sprechernotizen zu jeder Folie und läuft bei jedem Klick mit.",
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
		body: "Frag Carls Syntwin, warum Carl Alkalye gebaut hat, wie Carl es nutzt oder wie du loslegst. Du kannst auch nach Carls anderen Projekten fragen. Syntwin ist eine KI, nicht Carl live.",
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
		lede: "Über den Vortrag oben hinaus ist all das heute in der App. Details stehen im Changelog.",
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
						name: "Bilder und Videos",
						body: "Zieh Medien ins Dokument. Sie erscheinen in der Vorschau und auf deinen Folien.",
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
						name: "Laserpointer",
						body: "Markiere Text oder zeichne verblassende Laserspuren auf die Folie, auch vom Teleprompter auf deinem Handy aus.",
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
