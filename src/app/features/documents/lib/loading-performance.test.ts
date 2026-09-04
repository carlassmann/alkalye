import { describe, expect, test } from "vitest"
import { loaderResolve, meResolve } from "./queries"
import { personalMeResolve } from "../screens/doc-screen"
import {
	findFallbackHomeDocument,
	homeDocumentsQuery,
} from "../screens/home-screen"
import {
	spaceLoaderResolve,
	spaceMeResolve,
	spaceResolve,
} from "../screens/space-doc-screen"
import {
	matchesSearchTerms,
	matchesTypeFilter,
} from "../widgets/sidebar-document-list"
import { needsMetadataBackfill } from "./metadata"

describe("document loading performance queries", () => {
	test("account launch query loads document metadata shallowly", () => {
		expect(meResolve.root.documents).toEqual({ $each: true })
		expect(meResolve.root.spaces.$each.documents).toEqual({ $each: true })
		expect(personalMeResolve.root.documents).toEqual({ $each: true })
		expect(spaceMeResolve.root.documents).toEqual({ $each: true })
	})

	test("home fallback and space loaders avoid document content scans", () => {
		expect(homeDocumentsQuery.root.documents).toEqual({ $each: true })
		expect(spaceLoaderResolve.documents).toBe(true)
		expect(spaceResolve.documents).toEqual({ $each: true })
	})

	test("opened document loader blocks only on content", () => {
		expect(loaderResolve).toEqual({ content: true })
	})

	test("home fallback skips deleted documents", () => {
		let older = {
			$isLoaded: true,
			deletedAt: undefined,
			updatedAt: new Date("2026-01-01T00:00:00Z"),
		}
		let active = {
			$isLoaded: true,
			deletedAt: undefined,
			updatedAt: new Date("2026-01-02T00:00:00Z"),
		}
		let deleted = {
			$isLoaded: true,
			deletedAt: new Date(),
			updatedAt: new Date("2026-01-03T00:00:00Z"),
		}

		expect(findFallbackHomeDocument([active, older, deleted])).toBe(active)
	})

	test("sidebar filters omit legacy rows when metadata cannot prove a match", () => {
		let legacyDoc = { title: undefined }

		expect(needsMetadataBackfill(legacyDoc)).toBe(true)
		expect(matchesSearchTerms(legacyDoc, "missing title")).toBe(false)
		expect(matchesTypeFilter(legacyDoc, "presentation")).toBe(false)
		expect(matchesSearchTerms(legacyDoc, "")).toBe(true)
		expect(matchesTypeFilter(legacyDoc, "all")).toBe(true)
	})

	test("sidebar filters omit read-only metadata-stale rows", () => {
		let staleReadOnlyDoc = {
			title: "Old title",
			tags: [],
			pinned: false,
			isPresentation: false,
			contentUpdatedAt: new Date("2026-01-02T00:00:00Z"),
			metadataUpdatedAt: new Date("2026-01-01T00:00:00Z"),
			updatedAt: new Date("2026-01-02T00:00:00Z"),
		}

		expect(needsMetadataBackfill(staleReadOnlyDoc)).toBe(true)
		expect(matchesSearchTerms(staleReadOnlyDoc, "missing title")).toBe(false)
		expect(matchesTypeFilter(staleReadOnlyDoc, "presentation")).toBe(false)
		expect(matchesSearchTerms(staleReadOnlyDoc, "")).toBe(true)
		expect(matchesTypeFilter(staleReadOnlyDoc, "all")).toBe(true)
	})

	test("non-content checkpoints do not remain metadata-stale", () => {
		let contentUpdatedAt = new Date("2026-01-01T00:00:00Z")
		let metadataUpdatedAt = new Date("2026-01-02T00:00:00Z")
		let doc = {
			title: "Current",
			tags: [],
			pinned: false,
			isPresentation: false,
			contentUpdatedAt,
			metadataUpdatedAt,
			updatedAt: metadataUpdatedAt,
		}

		expect(needsMetadataBackfill(doc)).toBe(false)
	})

	test("sidebar search uses denormalized title and tags", () => {
		let doc = {
			title: "Launch Notes",
			tags: ["performance"],
			pinned: false,
			isPresentation: false,
			contentUpdatedAt: new Date("2026-01-01T00:00:00Z"),
			metadataUpdatedAt: new Date("2026-01-01T00:00:00Z"),
			updatedAt: new Date("2026-01-01T00:00:00Z"),
		}

		expect(matchesSearchTerms(doc, "launch, performance")).toBe(true)
		expect(matchesSearchTerms(doc, "unrelated")).toBe(false)
	})
})
