import { messages, translate } from "@ccssmnn/intl"

export { baseAuthMessages, deAuthMessages }

let baseAuthMessages = messages({
	"migration.disclosure":
		"Sync has moved. Synced notes are no longer end-to-end encrypted: Alkalye and Jazz Cloud can read them. Old invite links no longer work. Reconnect AI and MCP clients in Settings.",
	"migration.complete": "Classic import finished.",
	"migration.progress": "Importing your Classic library…",
	"migration.retry": "Retry import",
	"migration.dismiss": "Dismiss",
	"migration.opening": "Opening your library…",

	"auth.initial.description":
		"Sign in with your recovery phrase to sync your notes across devices and collaborate with others.",
	"auth.initial.createAccount": "Create new account",
	"auth.initial.signIn": "Sign in",
	"auth.create.title": "Your recovery phrase",
	"auth.create.description":
		"Alkalye uses recovery phrases instead of passwords. No email required - just save this phrase to access your notes anywhere.",
	"auth.create.copyError":
		"Could not copy recovery phrase. Please copy it manually.",
	"auth.create.copied": "Copied",
	"auth.create.copy": "Copy",
	"auth.create.back": "Back",
	"auth.create.submit": "Create account",
	"auth.create.error.registerFailed": "Failed to register",
	"auth.login.title": "Enter your recovery phrase",
	"auth.login.description":
		"Enter the recovery phrase from when you created your account.",
	"auth.login.placeholder": "word1 word2 word3 ...",
	"auth.login.back": "Back",
	"auth.login.submit": "Sign in",
	"auth.login.error.invalidPassphrase": "Invalid passphrase",
	"auth.dialog.defaultTitle": "Sign in",
})

let deAuthMessages = translate(baseAuthMessages, {
	"migration.disclosure":
		"Die Synchronisierung ist umgezogen. Synchronisierte Notizen sind nicht mehr Ende-zu-Ende-verschlüsselt: Alkalye und Jazz Cloud können sie lesen. Alte Einladungslinks funktionieren nicht mehr. Verbinde KI- und MCP-Clients in den Einstellungen neu.",
	"migration.complete": "Classic-Import abgeschlossen.",
	"migration.progress": "Deine Classic-Bibliothek wird importiert…",
	"migration.retry": "Import erneut versuchen",
	"migration.dismiss": "Schließen",
	"migration.opening": "Deine Bibliothek wird geöffnet…",

	"auth.initial.description":
		"Melde dich mit deiner Recovery-Phrase an, um deine Notizen auf allen Geräten zu synchronisieren und mit anderen zu arbeiten.",
	"auth.initial.createAccount": "Neues Konto erstellen",
	"auth.initial.signIn": "Anmelden",
	"auth.create.title": "Deine Recovery-Phrase",
	"auth.create.description":
		"Alkalye verwendet Recovery-Phrasen statt Passwörter. Keine E-Mail erforderlich - speichere diese Phrase einfach, um von überall auf deine Notizen zuzugreifen.",
	"auth.create.copyError":
		"Recovery-Phrase konnte nicht kopiert werden. Bitte kopiere sie manuell.",
	"auth.create.copied": "Kopiert",
	"auth.create.copy": "Kopieren",
	"auth.create.back": "Zurück",
	"auth.create.submit": "Konto erstellen",
	"auth.create.error.registerFailed": "Registrierung fehlgeschlagen",
	"auth.login.title": "Gib deine Recovery-Phrase ein",
	"auth.login.description":
		"Gib die Recovery-Phrase von der Erstellung deines Kontos ein.",
	"auth.login.placeholder": "wort1 wort2 wort3 ...",
	"auth.login.back": "Zurück",
	"auth.login.submit": "Anmelden",
	"auth.login.error.invalidPassphrase": "Ungültige Phrase",
	"auth.dialog.defaultTitle": "Anmelden",
})
