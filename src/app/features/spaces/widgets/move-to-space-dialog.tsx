import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { co } from "jazz-tools"
import { useAccount } from "jazz-tools/react"
import { User, ArrowRight, Plus } from "lucide-react"
import { useIntl, T } from "@/shared/intl/setup"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/app/components/ui/dialog"
import { Button } from "@/app/components/ui/button"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/app/components/ui/select"
import { SpaceInitials } from "./space-selector"
import { Field, FieldLabel } from "@/app/components/ui/field"
import { Input } from "@/app/components/ui/input"
import { Document, UserAccount, createSpace } from "@/schema"
import { getSpaceGroup } from "../lib/spaces"
import { moveDocumentToSpace } from "@/app/features/documents"
import { waitForLocalJazzStorage } from "@/app/lib/local-jazz-poke"

export { MoveToSpaceDialog }
export type { MoveToSpaceDialogProps }

type LoadedDocument = co.loaded<typeof Document>

let spacesQuery = {
	root: {
		documents: true,
		spaces: { $each: { avatar: true, documents: true } },
	},
} as const
type LoadedSpaces = co.loaded<typeof UserAccount, typeof spacesQuery>

type SpaceOption = {
	id: string
	name: string
}

interface MoveToSpaceDialogProps {
	doc: LoadedDocument
	open: boolean
	onOpenChange: (open: boolean) => void
	currentSpaceId?: string
	onMove?: (destination: SpaceOption | null) => void
}

function MoveToSpaceDialog({
	doc,
	open,
	onOpenChange,
	currentSpaceId,
	onMove,
}: MoveToSpaceDialogProps) {
	let t = useIntl()
	let me = useAccount(UserAccount, { resolve: spacesQuery })
	let [lastOpen, setLastOpen] = useState(false)
	let [destination, setDestination] = useState("")
	let [newSpaceName, setNewSpaceName] = useState("")
	let [isSubmitting, setIsSubmitting] = useState(false)

	let spaces = me?.$isLoaded ? getSortedSpaces(me.root.spaces) : []
	let availableSpaces = currentSpaceId
		? spaces.filter(s => s.$jazz.id !== currentSpaceId)
		: spaces

	let defaultDestination = currentSpaceId
		? "personal"
		: (availableSpaces[0]?.$jazz.id ?? "")

	let form = useForm({
		defaultValues: {
			destination: defaultDestination,
			newSpaceName: "",
		},
		onSubmit: async ({ value }) => {
			if (!me?.$isLoaded || !me.root) return

			let { destination, newSpaceName } = value
			if (destination === "personal" && !currentSpaceId) return
			if (destination === currentSpaceId) return
			if (destination === "__new__" && !newSpaceName.trim()) return

			setIsSubmitting(true)
			try {
				let selectedSpace: SpaceOption | null = null

				if (destination === "__new__") {
					let space = createSpace(newSpaceName.trim(), me.root)
					selectedSpace = { id: space.$jazz.id, name: space.name }
				} else if (destination !== "personal") {
					let space = spaces.find(s => s.$jazz.id === destination)
					if (space) {
						selectedSpace = { id: space.$jazz.id, name: space.name }
					}
				}

				await moveDocumentToSpace({
					doc,
					destination: selectedSpace,
					currentSpaceId,
					me,
				})
				if (destination === "__new__") await waitForLocalJazzStorage(me)

				onMove?.(selectedSpace)
				onOpenChange(false)
			} catch (err) {
				console.error("Failed to move document:", err)
			} finally {
				setIsSubmitting(false)
			}
		},
	})

	if (open && !lastOpen) {
		form.reset({
			destination: defaultDestination,
			newSpaceName: "",
		})
		setDestination(defaultDestination)
		setNewSpaceName("")
		setIsSubmitting(false)
	}
	if (open !== lastOpen) {
		setLastOpen(open)
	}

	let isCreatingNew = destination === "__new__"

	let currentLocation = currentSpaceId
		? (spaces.find(s => s.$jazz.id === currentSpaceId)?.name ?? "Space")
		: t("spaces.move.personal")

	let isDisabled =
		isSubmitting ||
		(destination === "personal" && !currentSpaceId) ||
		destination === currentSpaceId ||
		(isCreatingNew && !newSpaceName.trim())

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<T k="spaces.move.title" />
					</DialogTitle>
					<DialogDescription>
						<T k="spaces.move.description" />
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={e => {
						e.preventDefault()
						form.handleSubmit()
					}}
				>
					<div className="space-y-4">
						<div className="text-muted-foreground flex items-center gap-2 text-sm">
							<span>
								<T k="spaces.move.from" />
							</span>
							<span className="text-foreground font-medium">
								{currentLocation}
							</span>
						</div>

						<form.Field name="destination">
							{field => (
								<div className="flex items-center gap-2">
									<ArrowRight className="text-muted-foreground size-4" />
									<Select
										value={field.state.value}
										onValueChange={v => {
											if (!v) return
											field.handleChange(v)
											setDestination(v)
										}}
									>
										<SelectTrigger className="flex-1">
											{field.state.value === "personal" ? (
												<div className="inline-flex items-center gap-3">
													<User />
													<span>
														<T k="spaces.move.personal" />
													</span>
												</div>
											) : field.state.value === "__new__" ? (
												<div className="inline-flex items-center gap-3">
													<Plus className="size-4" />
													<span>
														<T k="spaces.move.createNew" />
													</span>
												</div>
											) : (
												(() => {
													let space = availableSpaces.find(
														s => s.$jazz.id === field.state.value,
													)
													return space ? (
														<div className="inline-flex items-center gap-3">
															<SpaceInitials name={space.name} size="sm" />
															<span>{space.name}</span>
														</div>
													) : (
														<SelectValue />
													)
												})()
											)}
										</SelectTrigger>
										<SelectContent>
											{!currentSpaceId ? null : (
												<SelectItem value="personal">
													<User className="size-4" />
													<span>
														<T k="spaces.move.personal" />
													</span>
												</SelectItem>
											)}
											{availableSpaces.map(space => (
												<SelectItem key={space.$jazz.id} value={space.$jazz.id}>
													<SpaceInitials name={space.name} size="sm" />
													<span>{space.name}</span>
												</SelectItem>
											))}
											<SelectItem value="__new__">
												<Plus className="size-4" />
												<span>
													<T k="spaces.move.createNew" />
												</span>
											</SelectItem>
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						{isCreatingNew && (
							<form.Field name="newSpaceName">
								{field => (
									<Field>
										<FieldLabel htmlFor={field.name}>
											<T k="spaces.move.spaceNameLabel" />
										</FieldLabel>
										<Input
											id={field.name}
											name={field.name}
											value={field.state.value}
											onChange={e => {
												field.handleChange(e.target.value)
												setNewSpaceName(e.target.value)
											}}
											placeholder={t("spaces.move.namePlaceholder")}
											autoComplete="off"
											autoFocus
										/>
									</Field>
								)}
							</form.Field>
						)}
					</div>

					<DialogFooter className="mt-4">
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
						>
							<T k="spaces.button.cancel" />
						</Button>
						<Button type="submit" size="sm" disabled={isDisabled}>
							{isSubmitting ? (
								<T k="spaces.move.submitting" />
							) : (
								<T k="spaces.move.submit" />
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

// --- Helpers ---

type LoadedSpaceWithAvatar = NonNullable<
	NonNullable<LoadedSpaces["root"]["spaces"]>[number]
>

function getSortedSpaces(
	spaces: LoadedSpaces["root"]["spaces"],
): LoadedSpaceWithAvatar[] {
	if (!spaces) return []

	return [...spaces.values()]
		.filter((s): s is LoadedSpaceWithAvatar => {
			if (!s?.$isLoaded) return false
			let spaceGroup = getSpaceGroup(s)
			let role = spaceGroup?.myRole()
			return role === "admin" || role === "writer"
		})
		.sort((a, b) => a.name.localeCompare(b.name))
}
