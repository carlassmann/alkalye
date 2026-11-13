import { useIsBackedUp } from "@/app/features/auth"
import { useState, useEffect, useRef, startTransition } from "react"
import { useNavigate, Link } from "@tanstack/react-router"
import { useLibrary } from "@/app/features/documents"
import { FileText, FolderOpen, AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import { AuthDialog } from "@/app/features/auth"
import {
	acceptDocumentInvite,
	type DocInviteData,
} from "../lib/document-sharing"
import { acceptSpaceInvite, type SpaceInviteData } from "@/app/features/spaces"
import { testIds } from "@/app/lib/test-ids"
import { useIntl, T } from "@/shared/intl/setup"

export { InviteScreen }

function InviteScreen() {
	let t = useIntl()
	let navigate = useNavigate()
	let { db } = useLibrary()
	let isAuthenticated = useIsBackedUp()

	let [inviteData] = useState(() => {
		let hash = typeof window !== "undefined" ? window.location.hash : ""
		return parseInviteHash(hash)
	})

	let [status, setStatus] = useState<
		"loading" | "needs-auth" | "accepting" | "success" | "error" | "revoked"
	>(inviteData ? "loading" : "error")
	let [error, setError] = useState<string | null>(null)

	let isSpaceInvite = inviteData?.type === "space"
	let [isAccepting, setIsAccepting] = useState(false)
	let acceptInviteRef = useRef<() => void | Promise<void>>(() => {})

	async function handleAcceptInvite() {
		if (!inviteData || isAccepting) return
		setIsAccepting(true)
		setStatus("accepting")

		try {
			if (inviteData.type === "doc") {
				await acceptDocumentInvite(db, inviteData)
				setStatus("success")
				setTimeout(() => {
					navigate({ to: "/doc/$id", params: { id: inviteData.docId } })
				}, 1000)
			} else {
				await acceptSpaceInvite(db, inviteData)
				setStatus("success")
				setTimeout(() => {
					navigate({
						to: "/spaces/$spaceId",
						params: { spaceId: inviteData.spaceId },
					})
				}, 1000)
			}
		} catch (e) {
			console.error("Failed to accept invite:", e)
			setIsAccepting(false)
			if (e instanceof Error && e.message.includes("revoked")) {
				setStatus("revoked")
			} else {
				setStatus("error")
				setError(
					e instanceof Error ? e.message : t("sharing.invite.failedToAccept"),
				)
			}
		}
	}

	useEffect(() => {
		acceptInviteRef.current = handleAcceptInvite
	})

	// Derive needs-auth state during render
	let shouldShowAuth = inviteData && !isAuthenticated && status === "loading"

	// Auto-accept when authenticated and ready
	useEffect(() => {
		if (!inviteData || !isAuthenticated) return
		if (status !== "loading" || isAccepting) return
		startTransition(() => {
			void acceptInviteRef.current()
		})
	}, [isAuthenticated, inviteData, status, isAccepting])

	let pageTitle = isSpaceInvite
		? t("sharing.invite.join.space")
		: t("sharing.invite.join.document")

	return (
		<>
			<title>{pageTitle}</title>
			<div
				className="bg-background fixed inset-0"
				style={{
					paddingTop: "env(safe-area-inset-top)",
					paddingBottom: "env(safe-area-inset-bottom)",
					paddingLeft: "env(safe-area-inset-left)",
					paddingRight: "env(safe-area-inset-right)",
				}}
			>
				<TopBar />
				<div className="flex min-h-[calc(100dvh-48px)] items-center justify-center px-4">
					<div className="w-full max-w-sm">
						{shouldShowAuth ? (
							<NeedsAuthState
								onAuthSuccess={() => {
									setStatus("loading")
									setTimeout(() => {
										void acceptInviteRef.current()
									})
								}}
								isSpace={isSpaceInvite}
							/>
						) : status === "loading" || status === "accepting" ? (
							<LoadingState status={status} isSpace={isSpaceInvite} />
						) : status === "success" ? (
							<SuccessState isSpace={isSpaceInvite} />
						) : status === "revoked" ? (
							<RevokedState />
						) : (
							<ErrorState error={error} />
						)}
					</div>
				</div>
			</div>
		</>
	)
}

function TopBar() {
	return (
		<div
			className="bg-background border-border flex h-12 items-center justify-between border-b px-3"
			style={{
				marginTop: "env(safe-area-inset-top)",
			}}
		>
			<div className="flex items-center gap-2">
				<Button variant="ghost" nativeButton={false} render={<Link to="/" />}>
					<span className="text-foreground text-lg font-semibold">Alkalye</span>
				</Button>
			</div>
			<Link to="/">
				<Button size="sm">
					<T k="sharing.invite.goToApp" />
				</Button>
			</Link>
		</div>
	)
}

function LoadingState({
	status,
	isSpace,
}: {
	status: "loading" | "accepting"
	isSpace: boolean
}) {
	return (
		<div className="space-y-4 text-center">
			<Loader2 className="text-muted-foreground mx-auto size-12 animate-spin" />
			<p className="text-muted-foreground text-sm">
				{status === "loading" ? (
					<T k="sharing.invite.loadingInvite" />
				) : isSpace ? (
					<T k="sharing.invite.joiningSpace" />
				) : (
					<T k="sharing.invite.joiningDocument" />
				)}
			</p>
		</div>
	)
}

function SuccessState({ isSpace }: { isSpace: boolean }) {
	return (
		<div
			className="space-y-4 text-center"
			data-testid={testIds.invite.successState}
		>
			{isSpace ? (
				<FolderOpen className="mx-auto size-12 text-green-600 dark:text-green-400" />
			) : (
				<FileText className="mx-auto size-12 text-green-600 dark:text-green-400" />
			)}
			<div className="space-y-2">
				<h1 className="text-lg font-semibold">
					<T k="sharing.invite.successTitle" />
				</h1>
				<p className="text-muted-foreground text-sm">
					{isSpace ? (
						<T k="sharing.invite.successSpace" />
					) : (
						<T k="sharing.invite.successDocument" />
					)}
				</p>
			</div>
		</div>
	)
}

function NeedsAuthState({
	onAuthSuccess,
	isSpace,
}: {
	onAuthSuccess: () => void
	isSpace: boolean
}) {
	let [authOpen, setAuthOpen] = useState(false)

	return (
		<div className="space-y-6">
			<div className="space-y-2 text-center">
				{isSpace ? (
					<FolderOpen className="text-muted-foreground mx-auto size-12" />
				) : (
					<FileText className="text-muted-foreground mx-auto size-12" />
				)}
				<h1 className="text-lg font-semibold">
					<T k="sharing.invite.youveBeenInvited" />
				</h1>
				<p className="text-muted-foreground text-sm">
					{isSpace ? (
						<T k="sharing.invite.signInSpace" />
					) : (
						<T k="sharing.invite.signInDocument" />
					)}
				</p>
			</div>
			<div className="flex justify-center">
				<Button
					size="sm"
					onClick={() => setAuthOpen(true)}
					data-testid={testIds.invite.signInButton}
				>
					<T k="common.signIn" />
				</Button>
			</div>
			<AuthDialog
				open={authOpen}
				onOpenChange={setAuthOpen}
				onSuccess={onAuthSuccess}
			/>
		</div>
	)
}

function RevokedState() {
	return (
		<div
			className="space-y-6 text-center"
			data-testid={testIds.invite.errorState}
		>
			<AlertCircle className="text-muted-foreground mx-auto size-12" />
			<div className="space-y-2">
				<h1 className="text-lg font-semibold">
					<T k="sharing.invite.revokedTitle" />
				</h1>
				<p className="text-muted-foreground text-sm">
					<T k="sharing.invite.revokedDescription" />
				</p>
			</div>
			<div className="flex justify-center gap-2">
				<Button variant="outline" nativeButton={false} render={<Link to="/" />}>
					<T k="sharing.invite.goToApp" />
				</Button>
			</div>
		</div>
	)
}

function ErrorState({ error }: { error: string | null }) {
	let t = useIntl()
	let errorMessage = error ?? t("sharing.invite.invalidLink")

	return (
		<div className="space-y-6 text-center">
			<AlertCircle className="text-destructive mx-auto size-12" />
			<div className="space-y-2">
				<h1 className="text-lg font-semibold">
					<T k="sharing.invite.errorTitle" />
				</h1>
				<p className="border-border text-muted-foreground border p-1 font-mono text-sm">
					{t("sharing.invite.errorReason", {
						error: errorMessage,
					})}
				</p>
				<p className="text-muted-foreground text-sm">
					<T k="sharing.invite.errorDescription" />
				</p>
			</div>
			<div className="flex justify-center gap-2">
				<Button variant="outline" nativeButton={false} render={<Link to="/" />}>
					<T k="sharing.invite.goToApp" />
				</Button>
			</div>
		</div>
	)
}

type InviteData =
	| ({ type: "doc" } & DocInviteData)
	| ({ type: "space" } & SpaceInviteData)

function parseInviteHash(hash: string): InviteData | null {
	let docMatch = hash.match(/^#\/doc\/([^/]+)\/invite\/([^/]+)\/([^/]+)$/)
	if (docMatch) {
		return {
			type: "doc",
			docId: docMatch[1],
			inviteGroupId: docMatch[2],
			inviteSecret: docMatch[3],
		}
	}

	let spaceMatch = hash.match(/^#\/space\/([^/]+)\/invite\/([^/]+)\/([^/]+)$/)
	if (spaceMatch) {
		return {
			type: "space",
			spaceId: spaceMatch[1],
			inviteGroupId: spaceMatch[2],
			inviteSecret: spaceMatch[3],
		}
	}

	return null
}
