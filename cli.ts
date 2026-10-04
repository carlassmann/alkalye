#!/usr/bin/env bun
import * as Effect from "effect/Effect"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { cliEffect } from "./src/cli/application"
import { runMain } from "./src/cli/runtime"
export { runCli } from "./src/cli/application"

if (import.meta.main)
	runMain(
		cliEffect(process.argv.slice(2)).pipe(
			Effect.provide(FetchHttpClient.layer),
		),
		{
			disableErrorReporting: true,
		},
	)
