import { useState } from "react"
import { Link, useRouter } from "@tanstack/react-router"
import { FileX, FolderLock, FolderSearch, ShieldOff } from "lucide-react"
import { useIsAuthenticated } from "jazz-tools/react"
import { Button } from "@/app/components/ui/button"
import { AuthDialog } from "@/app/features/auth"
import {
	Empty,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
	EmptyDescription,
	EmptyContent,
} from "@/app/components/ui/empty"
import { T } from "@/shared/intl/setup"
import { testIds } from "@/app/lib/test-ids"

export {
	DocumentNotFound,
	DocumentUnauthorized,
	SpaceNotFound,
	SpaceUnauthorized,
}

function DocumentNotFound() {
	return (
		<div
			className="bg-background flex h-full items-center justify-center"
			data-testid={testIds.error.documentNotFound}
		>
			<Empty>
				<EmptyHeader>
					<EmptyMedia>
						<FileX className="text-muted-foreground size-12" />
					</EmptyMedia>
					<EmptyTitle>
						<T k="error.docNotFound.title" />
					</EmptyTitle>
					<EmptyDescription>
						<T k="error.docNotFound.description" />
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button nativeButton={false} render={<Link to="/" />}>
						<T k="common.goHome" />
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	)
}

function DocumentUnauthorized() {
	let isAuthenticated = useIsAuthenticated()
	let router = useRouter()
	let [authOpen, setAuthOpen] = useState(false)

	return (
		<div className="bg-background flex h-full items-center justify-center">
			<Empty>
				<EmptyHeader>
					<EmptyMedia>
						<ShieldOff className="text-muted-foreground size-12" />
					</EmptyMedia>
					<EmptyTitle>
						<T k="error.docUnauthorized.title" />
					</EmptyTitle>
					<EmptyDescription>
						{isAuthenticated ? (
							<T k="error.docUnauthorized.authenticated" />
						) : (
							<T k="error.docUnauthorized.unauthenticated" />
						)}
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<div className="flex w-full flex-col items-center gap-3">
						<Button nativeButton={false} render={<Link to="/" />}>
							<T k="common.goHome" />
						</Button>
						{!isAuthenticated && (
							<>
								<Button variant="outline" onClick={() => setAuthOpen(true)}>
									<T k="common.signIn" />
								</Button>
								<AuthDialog
									open={authOpen}
									onOpenChange={setAuthOpen}
									onSuccess={() => router.invalidate()}
								/>
							</>
						)}
					</div>
				</EmptyContent>
			</Empty>
		</div>
	)
}

function SpaceNotFound() {
	return (
		<div className="bg-background flex h-full items-center justify-center">
			<Empty>
				<EmptyHeader>
					<EmptyMedia>
						<FolderSearch className="text-muted-foreground size-12" />
					</EmptyMedia>
					<EmptyTitle>
						<T k="error.spaceNotFound.title" />
					</EmptyTitle>
					<EmptyDescription>
						<T k="error.spaceNotFound.description" />
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button nativeButton={false} render={<Link to="/" />}>
						<T k="common.goHome" />
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	)
}

function SpaceUnauthorized() {
	let isAuthenticated = useIsAuthenticated()
	let router = useRouter()
	let [authOpen, setAuthOpen] = useState(false)

	return (
		<div className="bg-background flex h-full items-center justify-center">
			<Empty>
				<EmptyHeader>
					<EmptyMedia>
						<FolderLock className="text-muted-foreground size-12" />
					</EmptyMedia>
					<EmptyTitle>
						<T k="error.spaceUnauthorized.title" />
					</EmptyTitle>
					<EmptyDescription>
						{isAuthenticated ? (
							<T k="error.spaceUnauthorized.authenticated" />
						) : (
							<T k="error.spaceUnauthorized.unauthenticated" />
						)}
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<div className="flex w-full flex-col items-center gap-3">
						<Button nativeButton={false} render={<Link to="/" />}>
							<T k="common.goHome" />
						</Button>
						{!isAuthenticated && (
							<>
								<Button variant="outline" onClick={() => setAuthOpen(true)}>
									<T k="common.signIn" />
								</Button>
								<AuthDialog
									open={authOpen}
									onOpenChange={setAuthOpen}
									onSuccess={() => router.invalidate()}
								/>
							</>
						)}
					</div>
				</EmptyContent>
			</Empty>
		</div>
	)
}
