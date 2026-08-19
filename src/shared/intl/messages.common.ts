import { messages, translate } from "@ccssmnn/intl"

export { baseCommonMessages, deCommonMessages }

let baseCommonMessages = messages({
	"app.name": "Alkalye",

	"assets.title": "Assets",
	"assets.addAsset": "Add asset",
	"assets.dropMediaHere": "Drop media here",
	"assets.noAssetsYet": "No assets yet",
	"assets.insert": "Insert",
	"assets.download": "Download",
	"assets.rename": "Rename",
	"assets.muteAudio": "Mute audio",
	"assets.unmuteAudio": "Unmute audio",
	"assets.delete": "Delete",
	"assets.deleteTitle": "Delete asset?",
	"assets.deleteDescription":
		"This asset is used in the document. Deleting it will remove it from the content.",
	"assets.deleteConfirm": "Delete",
	"assets.renameAsset": "Rename asset",
	"assets.name": "Name",
	"assets.assetName": "Asset name",
	"assets.save": "Save",
	"assets.nameRequired": "Name is required",
	"assets.nameTooLong": "Name too long",
	"assets.newWhiteboard": "New whiteboard",
	"assets.editWhiteboard": "Edit whiteboard",
	"assets.uploadOrImport": "Upload or import",
	"assets.whiteboard": "Whiteboard",
	"assets.importOneWhiteboard": "Import one whiteboard at a time",
	"assets.multiplePagesUnsupported": "This tldraw file has multiple pages",
	"assets.embeddedMediaUnsupported":
		"Embedded images and media are not supported yet",
	"assets.invalidTldraw": "This is not a valid tldraw file",
	"assets.whiteboardEditorDescription":
		"Edit the whiteboard, then save or cancel your changes.",
	"assets.whiteboardLoading": "Whiteboard is still loading",
	"assets.addBeforeSaving": "Add something to the whiteboard before saving",
	"assets.whiteboardSaved": "Whiteboard saved",
	"assets.whiteboardAdded": "Whiteboard added",
	"assets.whiteboardSaveFailed": "Could not save the whiteboard",
	"assets.whiteboardPresenceOne": "1 other viewing",
	"assets.whiteboardPresenceMany": "{$count} others viewing",
	"assets.discardWhiteboardTitle": "Discard whiteboard changes?",
	"assets.discardWhiteboardDescription":
		"Your changes since opening the whiteboard will be lost.",
	"assets.discard": "Discard",
	"assets.saving": "Saving…",
	"assets.import": "Import",

	"common.goHome": "Go Home",
	"common.goBack": "Go back",
	"common.home": "Go home",
	"common.signIn": "Sign in",
	"common.logOut": "Log out",
	"common.settings": "Settings",

	"error.docNotFound.title": "Document not found",
	"error.docNotFound.description":
		"This document doesn't exist or has been deleted.",

	"error.docUnauthorized.title": "Access denied",
	"error.docUnauthorized.authenticated":
		"You don't have permission to view this document.",
	"error.docUnauthorized.unauthenticated": "Sign in to access this document.",

	"error.spaceNotFound.title": "Space not found",
	"error.spaceNotFound.description":
		"This space doesn't exist or may have been removed.",

	"error.spaceUnauthorized.title": "Access denied",
	"error.spaceUnauthorized.authenticated":
		"You don't have permission to view this space.",
	"error.spaceUnauthorized.unauthenticated": "Sign in to access this space.",

	"error.pageNotFound.title": "Page not found",
	"error.pageNotFound.description":
		"The page you're looking for doesn't exist or has been moved.",

	"error.generic.title": "Something went wrong",
	"error.generic.description":
		"An unexpected error occurred. Please try reloading the page.",
	"error.generic.reloadPage": "Reload Page",

	"help.label": "Help",
	"help.welcome": "Welcome",
	"help.tutorAlkalye": "Alkalye Tutor",
	"help.tutorMarkdown": "Markdown Tutor",
	"help.tutorPresentation": "Presentation Tutor",
	"help.linksLabel": "Links",
	"help.github": "GitHub",
	"help.twitter": "Twitter",
	"help.website": "Website",

	"footer.privacy": "Privacy",
	"footer.imprint": "Imprint",

	"sync.syncing": "Syncing",
	"sync.offline": "Offline",
	"sync.localOnly": "Local only",
	"sync.signedIn": "Signed in",

	"pwa.installTitle": "Install Alkalye",
	"pwa.installHint": "Add to your homescreen for the best experience.",
	"pwa.showMeHow": "Show me how",
	"pwa.maybeLater": "Maybe later",
	"pwa.installMobile":
		"Add Alkalye to your homescreen for instant access and the best experience.",
	"pwa.installDesktop":
		"Install Alkalye as an app for quick access and a better experience.",
	"pwa.directInstallSupport": "Your browser supports direct installation:",
	"pwa.installApp": "Install App",
	"pwa.androidManualTitle": "To install, follow these steps:",
	"pwa.androidMenuButton": "Tap the menu button",
	"pwa.androidInBrowser": "in your browser",
	"pwa.androidSelectOption": 'Select "Add to Home screen" or "Install app"',
	"pwa.androidConfirm": "Confirm the installation",
	"pwa.iosTitle": "To install on iOS, use Safari and follow these steps:",
	"pwa.iosShareButton": "Tap the Share button",
	"pwa.iosAtBottom": "at the bottom of Safari",
	"pwa.iosAddHome": 'Scroll down and tap "Add to Home Screen"',
	"pwa.iosAddButton": 'Tap "Add" in the top right corner',
	"pwa.iosNote": "Note: This only works in Safari, not other browsers on iOS.",
	"pwa.desktopVary": "Install instructions vary by browser:",
	"pwa.desktopChromeEdge": "Chrome / Edge",
	"pwa.desktopChromeEdgeSteps":
		'Look for the install icon in the address bar, or use the menu and select "Install app"',
	"pwa.desktopSafari": "Safari (macOS)",
	"pwa.desktopSafariSteps": "Click File > Add to Dock",
	"pwa.desktopFirefox": "Firefox",
	"pwa.desktopFirefoxSteps":
		"Firefox doesn't support PWA installation. Use Chrome or Edge instead.",
	"pwa.genericTitle": "To install:",
	"pwa.genericStep1": "Open your browser's menu",
	"pwa.genericStep2": 'Look for "Add to Home Screen" or "Install App"',
	"pwa.updateAvailable": "Update available",
	"pwa.updateDescription": "Reload to update to the latest version",
	"pwa.updateAction": "Reload",
	"pwa.offlineReady": "Ready to work offline",
	"pwa.offlineDescription": "App has been cached for offline use",

	"common.confirm": "Confirm",
	"common.cancel": "Cancel",
	"common.copy": "Copy",
	"common.copied": "Copied!",

	"error.reportIssue": "Report this issue →",
	"error.showDetails": "Show error details",
	"error.errorDetails": "Error Details",
	"error.errorMessage": "Error Message:",
	"error.stackTrace": "Stack Trace",
	"error.componentStack": "Component Stack",

	"appearance.theme": "Theme",
	"appearance.light": "Light",
	"appearance.dark": "Dark",
	"appearance.system": "System",

	"common.anonymous": "Anonymous",
	"common.anonymousUser": "Anonymous user",
})

let deCommonMessages = translate(baseCommonMessages, {
	"app.name": "Alkalye",

	"assets.title": "Assets",
	"assets.addAsset": "Asset hinzufügen",
	"assets.dropMediaHere": "Medien hier ablegen",
	"assets.noAssetsYet": "Noch keine Assets",
	"assets.insert": "Einfügen",
	"assets.download": "Herunterladen",
	"assets.rename": "Umbenennen",
	"assets.muteAudio": "Audio stummschalten",
	"assets.unmuteAudio": "Audio einschalten",
	"assets.delete": "Löschen",
	"assets.deleteTitle": "Asset löschen?",
	"assets.deleteDescription":
		"Dieses Asset wird im Dokument verwendet. Das Löschen entfernt es aus dem Inhalt.",
	"assets.deleteConfirm": "Löschen",
	"assets.renameAsset": "Asset umbenennen",
	"assets.name": "Name",
	"assets.assetName": "Asset-Name",
	"assets.save": "Speichern",
	"assets.nameRequired": "Name erforderlich",
	"assets.nameTooLong": "Name zu lang",
	"assets.newWhiteboard": "Neues Whiteboard",
	"assets.editWhiteboard": "Whiteboard bearbeiten",
	"assets.uploadOrImport": "Hochladen oder importieren",
	"assets.whiteboard": "Whiteboard",
	"assets.importOneWhiteboard": "Importiere jeweils nur ein Whiteboard",
	"assets.multiplePagesUnsupported":
		"Diese tldraw-Datei enthält mehrere Seiten",
	"assets.embeddedMediaUnsupported":
		"Eingebettete Bilder und Medien werden noch nicht unterstützt",
	"assets.invalidTldraw": "Dies ist keine gültige tldraw-Datei",
	"assets.whiteboardEditorDescription":
		"Bearbeite das Whiteboard und speichere oder verwirf anschließend deine Änderungen.",
	"assets.whiteboardLoading": "Das Whiteboard wird noch geladen",
	"assets.addBeforeSaving": "Füge vor dem Speichern etwas zum Whiteboard hinzu",
	"assets.whiteboardSaved": "Whiteboard gespeichert",
	"assets.whiteboardAdded": "Whiteboard hinzugefügt",
	"assets.whiteboardSaveFailed":
		"Das Whiteboard konnte nicht gespeichert werden",
	"assets.whiteboardPresenceOne": "1 weitere Sitzung",
	"assets.whiteboardPresenceMany": "{$count} weitere Sitzungen",
	"assets.discardWhiteboardTitle": "Whiteboard-Änderungen verwerfen?",
	"assets.discardWhiteboardDescription":
		"Deine Änderungen seit dem Öffnen des Whiteboards gehen verloren.",
	"assets.discard": "Verwerfen",
	"assets.saving": "Speichern…",
	"assets.import": "Importieren",

	"common.goHome": "Zur Startseite",
	"common.goBack": "Zurück",
	"common.home": "Startseite",
	"common.signIn": "Anmelden",
	"common.logOut": "Abmelden",
	"common.settings": "Einstellungen",

	"error.docNotFound.title": "Dokument nicht gefunden",
	"error.docNotFound.description":
		"Dieses Dokument existiert nicht oder wurde gelöscht.",

	"error.docUnauthorized.title": "Zugriff verweigert",
	"error.docUnauthorized.authenticated":
		"Du hast keine Berechtigung, dieses Dokument anzusehen.",
	"error.docUnauthorized.unauthenticated":
		"Melde dich an, um auf dieses Dokument zuzugreifen.",

	"error.spaceNotFound.title": "Space nicht gefunden",
	"error.spaceNotFound.description":
		"Dieser Space existiert nicht oder wurde entfernt.",

	"error.spaceUnauthorized.title": "Zugriff verweigert",
	"error.spaceUnauthorized.authenticated":
		"Du hast keine Berechtigung, diesen Space anzusehen.",
	"error.spaceUnauthorized.unauthenticated":
		"Melde dich an, um auf diesen Space zuzugreifen.",

	"error.pageNotFound.title": "Seite nicht gefunden",
	"error.pageNotFound.description":
		"Die gesuchte Seite existiert nicht oder wurde verschoben.",

	"error.generic.title": "Etwas ist schief gelaufen",
	"error.generic.description":
		"Ein unerwarteter Fehler ist aufgetreten. Bitte lade die Seite neu.",
	"error.generic.reloadPage": "Seite neu laden",

	"help.label": "Hilfe",
	"help.welcome": "Willkommen",
	"help.tutorAlkalye": "Alkalye Tutor",
	"help.tutorMarkdown": "Markdown Tutor",
	"help.tutorPresentation": "Präsentations Tutor",
	"help.linksLabel": "Links",
	"help.github": "GitHub",
	"help.twitter": "Twitter",
	"help.website": "Website",

	"footer.privacy": "Datenschutz",
	"footer.imprint": "Impressum",

	"sync.syncing": "Synchronisiere",
	"sync.offline": "Offline",
	"sync.localOnly": "Nur lokal",
	"sync.signedIn": "Angemeldet",

	"pwa.installTitle": "Installiere Alkalye",
	"pwa.installHint":
		"Füge zu deinem Startbildschirm hinzu für das beste Erlebnis.",
	"pwa.showMeHow": "Zeig mir wie",
	"pwa.maybeLater": "Vielleicht später",
	"pwa.installMobile":
		"Füge Alkalye zu deinem Startbildschirm hinzu für sofortigen Zugriff und das beste Erlebnis.",
	"pwa.installDesktop":
		"Installiere Alkalye als App für schnellen Zugriff und ein besseres Erlebnis.",
	"pwa.directInstallSupport": "Dein Browser unterstützt direkte Installation:",
	"pwa.installApp": "App installieren",
	"pwa.androidManualTitle": "Zum Installieren folge diesen Schritten:",
	"pwa.androidMenuButton": "Tippe auf die Menü-Schaltfläche",
	"pwa.androidInBrowser": "in deinem Browser",
	"pwa.androidSelectOption":
		'Wähle "Zum Startbildschirm hinzufügen" oder "App installieren"',
	"pwa.androidConfirm": "Bestätige die Installation",
	"pwa.iosTitle":
		"Um auf iOS zu installieren, nutze Safari und folge diesen Schritten:",
	"pwa.iosShareButton": "Tippe auf die Share-Schaltfläche",
	"pwa.iosAtBottom": "unten in Safari",
	"pwa.iosAddHome":
		'Scrolle nach unten und tippe auf "Zum Startbildschirm hinzufügen"',
	"pwa.iosAddButton": 'Tippe "Hinzufügen" in der oberen rechten Ecke',
	"pwa.iosNote":
		"Hinweis: Das funktioniert nur in Safari, nicht in anderen Browsern auf iOS.",
	"pwa.desktopVary": "Installationsanweisungen variieren je nach Browser:",
	"pwa.desktopChromeEdge": "Chrome / Edge",
	"pwa.desktopChromeEdgeSteps":
		'Suche nach dem Installationssymbol in der Adressleiste oder nutze das Menü und wähle "App installieren"',
	"pwa.desktopSafari": "Safari (macOS)",
	"pwa.desktopSafariSteps": "Klicke Datei > Zum Dock hinzufügen",
	"pwa.desktopFirefox": "Firefox",
	"pwa.desktopFirefoxSteps":
		"Firefox unterstützt keine PWA-Installation. Nutze stattdessen Chrome oder Edge.",
	"pwa.genericTitle": "Zum Installieren:",
	"pwa.genericStep1": "Öffne das Menü deines Browsers",
	"pwa.genericStep2":
		'Suche nach "Zum Startbildschirm hinzufügen" oder "App installieren"',
	"pwa.updateAvailable": "Update verfügbar",
	"pwa.updateDescription":
		"Lade neu, um auf die neueste Version zu aktualisieren",
	"pwa.updateAction": "Neu laden",
	"pwa.offlineReady": "Bereit für Offline-Arbeit",
	"pwa.offlineDescription": "App wurde für Offline-Nutzung gecacht",

	"common.confirm": "Bestätigen",
	"common.cancel": "Abbrechen",
	"common.copy": "Kopieren",
	"common.copied": "Kopiert!",

	"error.reportIssue": "Problem melden →",
	"error.showDetails": "Fehlerdetails anzeigen",
	"error.errorDetails": "Fehlerdetails",
	"error.errorMessage": "Fehlermeldung:",
	"error.stackTrace": "Stack Trace",
	"error.componentStack": "Komponentenstapel",

	"appearance.theme": "Design",
	"appearance.light": "Hell",
	"appearance.dark": "Dunkel",
	"appearance.system": "System",

	"common.anonymous": "Anonym",
	"common.anonymousUser": "Anonymer Nutzer",
})
