import type { ChangelogEntry } from "../../shared/changelog"
import { html, joinMarkup, rawMarkup } from "../../shared/html"
import { markdown } from "../../shared/markdown"

export function sitePage(title: string, content: string, language = "en") {
	return String(
		html`<!doctype html>
			<html lang="${language}">
				<head>
					<meta charset="utf-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1" />
					<meta name="theme-color" content="#101110" />
					<meta
						name="description"
						content="Alkalye: write offline, collaborate, and present your ideas."
					/>
					<title>${title} · Alkalye</title>
					<link rel="icon" href="/icons/alkalye-icon.png" />
					<link rel="stylesheet" href="/components/site.css" />
				</head>
				<body data-site>
					<header>
						<a class="brand" href="/"><span>α</span> alkalye</a>
						<nav>
							<a href="/changelog">Changelog</a><a href="/support">Support</a
							><a class="start" href="/app">Open workspace ↗</a>
						</nav>
					</header>
					<main>${rawMarkup(content)}</main>
					<footer>
						<a href="/privacy">Privacy</a><a href="/terms">Terms</a
						><a href="/imprint">Imprint</a><a href="/en">English</a
						><a href="/de">Deutsch</a><span>Your words. On your devices.</span>
					</footer>
				</body>
			</html>`,
	)
}
export function landingPage(language = "en") {
	let german = language === "de"
	let features = german
		? [
				[
					"Offline schreiben",
					"Deine Texte bleiben auf deinem Gerät. Sobald du wieder online bist, werden Änderungen synchronisiert.",
				],
				[
					"Zusammen denken",
					"Teile einen Link, wähle Berechtigungen und schreibe gleichzeitig mit deinem Team.",
				],
				[
					"Die Zeit zurückdrehen",
					"Jede Änderung bleibt erhalten. Finde frühere Versionen und stelle sie wieder her.",
				],
				[
					"Ideen präsentieren",
					"Markdown wird zur Präsentation. Notizen und Teleprompter bleiben bei dir.",
				],
				[
					"Deinen Stil finden",
					"Gestalte Dokumente und Folien mit CSS, HTML und einer direkten Vorschau.",
				],
				[
					"Agenten verbinden",
					"Erlaube einem MCP-Client Zugriff auf ausgewählte Bereiche. Du entscheidest, was er sehen darf.",
				],
			]
		: [
				[
					"Write anywhere",
					"Your documents stay on your device. Keep writing without a connection; changes sync when you reconnect.",
				],
				[
					"Think together",
					"Share a link, choose permissions, and write with your team in real time.",
				],
				[
					"Turn back time",
					"Every edit stays in history. Find an earlier version and restore what you need.",
				],
				[
					"Present your ideas",
					"Turn Markdown into slides. Keep your notes and teleprompter beside you.",
				],
				[
					"Make it yours",
					"Shape documents and slides with CSS, HTML, and an immediate preview.",
				],
				[
					"Connect your tools",
					"Give an MCP client access to selected spaces. You choose what it can read and change.",
				],
			]
	let content = html`<section class="hero">
			<p class="eyebrow">
				${german ? "Dein Raum für gute Gedanken" : "A little room for your thoughts"}
			</p>
			<h1>
				${german ? "Deine Worte." : "Your words."}<br /><em
					>${german ? "Überall zuhause." : "At home, anywhere."}</em
				>
			</h1>
			<p>
				${german ? "Ein ruhiger Ort zum Schreiben, Zusammenarbeiten und Präsentieren. Direkt im Browser. Auch offline." : "A quiet place to write, collaborate, and present. Right in your browser. Even offline."}
			</p>
			<a class="start" href="/app"
				>${german ? "Mit dem Schreiben beginnen ↗" : "Start writing ↗"}</a
			><small
				>${german ? "Kein Download. Kein Konto nötig." : "No download. No account required."}</small
			>
		</section>
		<section class="features">
			${joinMarkup(
				features.map(
					([title, description], index) =>
						html`<article>
							<span>${String(index + 1).padStart(2, "0")}</span>
							<h2>${title}</h2>
							<p>${description}</p>
						</article>`,
				),
			)}
		</section>
		<section class="closing">
			<h2>
				${german ? "Ein Dokument. Viele Möglichkeiten." : "One document. Room to grow."}
			</h2>
			<p>
				${german ? "Markdown, lokale Dateien, Zeichnungen, Medien und unabhängige Sicherungskopien. Deine Arbeit bleibt deine Arbeit." : "Markdown, local files, drawings, media, and independent backups. Your work stays yours."}
			</p>
			<a class="start" href="/app"
				>${german ? "Alkalye öffnen ↗" : "Open Alkalye ↗"}</a
			>
		</section>`
	return sitePage(
		german ? "Überall schreiben" : "Write anywhere",
		content.value,
		language,
	)
}
export function legalPage(title: string, source: string) {
	return sitePage(
		title,
		String(
			html`<article class="prose">${rawMarkup(markdown(source))}</article>`,
		),
	)
}
export function changelogPage(entries: ChangelogEntry[]) {
	return sitePage(
		"Changelog",
		String(
			html`<article class="prose">
				<h1>What’s new</h1>
				${joinMarkup(
					entries.map(
						entry =>
							html`<section class="release">
								<time datetime="${entry.date}">${entry.date}</time>
								<h2>${entry.title}</h2>
								<ul>
									${joinMarkup(entry.notes.map(note => html`<li>${note}</li>`))}
								</ul>
							</section>`,
					),
				)}
			</article>`,
		),
	)
}
