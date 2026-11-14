import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { useLibrary, type LibraryDocument } from "@/app/features/documents"
import { useSpaces, createSpace } from "../lib/spaces"
import { sharingRequest } from "@/app/features/sharing"
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

export { MoveToSpaceDialog }
export type { MoveToSpaceDialogProps }

type LoadedDocument = LibraryDocument

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
	let { db, ownerId } = useLibrary()
	let [lastOpen, setLastOpen] = useState(false)
	let [destination, setDestination] = useState("")
	let [newSpaceName, setNewSpaceName] = useState("")
	let [isSubmitting, setIsSubmitting] = useState(false)

	let spaces = useSpaces().filter(
		space => space.role && space.role !== "reader",
	)
	let availableSpaces = currentSpaceId
		? spaces.filter(s => s.id !== currentSpaceId)
		: spaces

	let defaultDestination = currentSpaceId
		? "personal"
		: (availableSpaces[0]?.id ?? "")

	let form = useForm({
		defaultValues: {
			destination: defaultDestination,
			newSpaceName: "",
		},
		onSubmit: async ({ value }) => {
			let { destination, newSpaceName } = value
			if (destination === "personal" && !currentSpaceId) return
			if (destination === currentSpaceId) return
			if (destination === "__new__" && !newSpaceName.trim()) return

			setIsSubmitting(true)
			try {
				let selectedSpace: SpaceOption | null = null

				if (destination === "__new__") {
					let space = await createSpace(db, ownerId, newSpaceName.trim())
					selectedSpace = { id: space.id, name: space.name }
				} else if (destination !== "personal") {
					let space = spaces.find(s => s.id === destination)
					if (space) {
						selectedSpace = { id: space.id, name: space.name }
					}
				}

				await sharingRequest(db, "move", {
					documentId: doc.id,
					spaceId: selectedSpace?.id ?? null,
				})

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
		? (spaces.find(s => s.id === currentSpaceId)?.name ?? "Space")
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
														s => s.id === field.state.value,
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
												<SelectItem key={space.id} value={space.id}>
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
