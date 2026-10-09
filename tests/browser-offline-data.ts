export {}
process.argv.push("--offline-data")
await import("./browser-document-app")
