#!/usr/bin/env bun

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

let root = readRequiredEnv("WORK_ROOT")
let sourceRoot = readRequiredEnv("WORK_SOURCE_ROOT")
let workspace = readRequiredEnv("WORK_WORKSPACE")
let isSourceWorkspace = root === sourceRoot

await main()

async function main() {
	if (!isSourceWorkspace) {
		writeWorkspaceEnv()
	}

	execFileSync("bun", ["install"], { cwd: root, stdio: "inherit" })
	console.log(`Workspace ready: ${workspace}`)
}

function writeWorkspaceEnv() {
	let sourceEnvPath = getSourceEnvPath()
	let workspaceEnvPath = join(root, ".env")
	let envFile = readFileSync(sourceEnvPath, "utf-8")
	let syncServer = `wss://sync.${workspace}.alkalye.localhost`
	let mcpBaseUrl = `https://${workspace}.alkalye.localhost`

	envFile = setEnvValue(envFile, "PUBLIC_JAZZ_SYNC_SERVER", syncServer)
	envFile = setEnvValue(envFile, "ALKALYE_MCP_BASE_URL", mcpBaseUrl)

	mkdirSync(dirname(workspaceEnvPath), { recursive: true })
	writeFileSync(workspaceEnvPath, envFile)
}

function getSourceEnvPath() {
	let sourceEnvPath = join(sourceRoot, ".env")
	if (existsSync(sourceEnvPath)) return sourceEnvPath

	let exampleEnvPath = join(sourceRoot, ".env.example")
	if (existsSync(exampleEnvPath)) return exampleEnvPath

	throw new Error(`Missing source .env at ${sourceEnvPath}`)
}

function readRequiredEnv(key: string): string {
	let value = process.env[key]
	if (!value) throw new Error(`Missing ${key}`)
	return value
}

function setEnvValue(content: string, key: string, value: string): string {
	let lines = content.split("\n")
	let nextLine = `${key}=${value}`
	let replaced = false

	lines = lines.map(line => {
		if (!line.startsWith(`${key}=`)) return line

		replaced = true
		return nextLine
	})

	if (!replaced) {
		if (lines.at(-1) !== "") lines.push("")
		lines.push(nextLine)
	}

	return lines.join("\n")
}
