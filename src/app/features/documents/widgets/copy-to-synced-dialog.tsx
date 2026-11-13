import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { toast } from "sonner"
import { app, useLibrary, createDocument, updateContent } from "../lib/library"
import { useAll } from "jazz-tools/react"
import { User, Plus, Copy } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
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
import { Field, FieldLabel } from "@/app/components/ui/field"
import { Input } from "@/app/components/ui/input"
import {
	createAssetFromFile,
	localEditorContent,
	assertLocalAssetReferencesAvailable,
	type LocalAsset,
} from "@/app/features/assets"

export { CopyToSyncedDialog }
export type { CopyToSyncedDialogProps }

type SpaceOption = {
	id: string
	name: string
}

interface CopyToSyncedDialogProps {
	content: string
	localAssets?: LocalAsset[]
	filename: string | null
	open: boolean
	onOpenChange: (open: boolean) => void
	onCopy?: (destination: SpaceOption | null) => void
}

function CopyToSyncedDialog({
	content,
	localAssets = [],
	filename,
	open,
	onOpenChange,
	onCopy,
}: CopyToSyncedDialogProps) {
	let t = useIntl()
	let { db, ownerId } = useLibrary()
	let { data: spaces = [] } = useAll(app.spaces.where({ ownerId }))
	let [isSubmitting, setIsSubmitting] = useState(false)
	let navigate = useNavigate()

	let defaultDestination = spaces[0]?.id ?? "personal"
	async function copy(spaceId?: string) {
		let contentCopy = localEditorContent(content, localAssets)
		let doc = await createDocument(db, ownerId, contentCopy, spaceId)
		for (let file of localAssets) {
			let asset = await createAssetFromFile(db, doc.id, {
				blob: file.blob,
				fileName: file.id,
			})
			contentCopy = contentCopy.replaceAll(
				`asset:${file.id}`,
				`asset:${asset.id}`,
			)
		}
		await updateContent(db, doc, contentCopy)
		onCopy?.(
			spaceId ? (spaces.find(space => space.id === spaceId) ?? null) : null,
		)
		handleOpenChange(false)
		if (spaceId)
			void navigate({
				to: "/spaces/$spaceId/doc/$id",
				params: { spaceId, id: doc.id },
			})
		else void navigate({ to: "/doc/$id", params: { id: doc.id } })
		return true
	}
	async function copyToPersonalSpace() {
		return copy()
	}
	async function copyToExistingSpace(id: string) {
		return copy(id)
	}
	async function copyToNewSpace(name: string) {
		if (!name) return false
		let now = new Date()
		let write = db.insert(app.spaces, {
			ownerId,
			name,
			createdAt: now,
			updatedAt: now,
		})
		await write.wait({ tier: "local" })
		return copy(write.value.id)
	}

	let form = useForm({
		defaultValues: {
			destination: defaultDestination,
			newSpaceName: "",
		},
		onSubmit: async ({ value }) => {
			setIsSubmitting(true)
			let destination = value.destination
			let newSpaceName = value.newSpaceName.trim()

			try {
				assertLocalAssetReferencesAvailable(content, localAssets)
				let success: boolean
				if (destination === "__new__") {
					success = await copyToNewSpace(newSpaceName)
				} else if (destination === "personal") {
					success = await copyToPersonalSpace()
				} else {
					success = await copyToExistingSpace(destination)
				}
				if (!success) {
					toast.error(t("spaces.copy.errorMissingData"))
					setIsSubmitting(false)
				}
			} catch (err) {
				toast.error(
					t("spaces.copy.errorGeneric", {
						error:
							err instanceof Error
								? err.message
								: t("spaces.copy.errorUnknown"),
					}),
				)
				setIsSubmitting(false)
			}
		},
	})

	function handleOpenChange(newOpen: boolean) {
		if (!newOpen) {
			form.reset({ destination: defaultDestination, newSpaceName: "" })
			setIsSubmitting(false)
		}
		onOpenChange(newOpen)
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<T k="spaces.copy.title" />
					</DialogTitle>
					<DialogDescription>
						<T
							k="spaces.copy.description"
							params={{ filename: filename ?? t("doc.untitled") }}
						/>
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={e => {
						e.preventDefault()
						e.stopPropagation()
						void form.handleSubmit()
					}}
					className="flex flex-col gap-4"
				>
					<form.Field name="destination">
						{field => (
							<Field>
								<FieldLabel>
									<T k="spaces.copy.destinationLabel" />
								</FieldLabel>
								<Select
									value={field.state.value}
									onValueChange={v => {
										if (!v) return
										field.handleChange(v)
									}}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="personal">
											<User className="mr-2 size-4" />
											<T k="spaces.copy.personal" />
										</SelectItem>
										{spaces.map(space => (
											<SelectItem key={space.id} value={space.id}>
												<SpaceInitials name={space.name} />
												{space.name}
											</SelectItem>
										))}
										<SelectItem value="__new__">
											<Plus className="mr-2 size-4" />
											<T k="spaces.copy.createNew" />
										</SelectItem>
									</SelectContent>
								</Select>
							</Field>
						)}
					</form.Field>

					<form.Subscribe selector={s => s.values.destination}>
						{destination =>
							destination === "__new__" ? (
								<form.Field name="newSpaceName">
									{field => (
										<Field>
											<FieldLabel>
												<T k="spaces.copy.newSpaceNameLabel" />
											</FieldLabel>
											<Input
												value={field.state.value}
												onChange={e => field.handleChange(e.target.value)}
												placeholder={t("spaces.copy.namePlaceholder")}
											/>
										</Field>
									)}
								</form.Field>
							) : null
						}
					</form.Subscribe>

					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => handleOpenChange(false)}
							nativeButton
						>
							<T k="spaces.button.cancel" />
						</Button>
						<form.Subscribe
							selector={s => ({
								destination: s.values.destination,
								newSpaceName: s.values.newSpaceName,
							})}
						>
							{({ destination, newSpaceName }) => (
								<Button
									type="submit"
									disabled={
										isSubmitting ||
										(destination === "__new__" && !newSpaceName.trim())
									}
									nativeButton
								>
									{isSubmitting ? (
										<>
											<T k="spaces.copy.submitting" />
										</>
									) : (
										<>
											<Copy className="mr-2 size-4" />
											<T k="spaces.copy.submit" />
										</>
									)}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function SpaceInitials({ name }: { name: string }) {
	return (
		<div className="bg-muted text-muted-foreground flex size-4 shrink-0 items-center justify-center rounded text-[8px] font-medium">
			{name
				.split(/\s+/)
				.slice(0, 2)
				.map(word => word[0])
				.join("")
				.toUpperCase()}
		</div>
	)
}
