import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { toast } from "sonner"
import { useLibrary } from "@/app/features/documents"
import {
	useSpaces,
	createSpace,
	copyToSynced,
	type LocalCopyAsset,
} from "../lib/spaces"
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
import { SpaceInitials } from "./space-selector"
import { Field, FieldLabel } from "@/app/components/ui/field"
import { Input } from "@/app/components/ui/input"
export { CopyToSyncedDialog }
export type { CopyToSyncedDialogProps }

type SpaceOption = {
	id: string
	name: string
}

interface CopyToSyncedDialogProps {
	content: string
	localAssets?: LocalCopyAsset[]
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
	let [isSubmitting, setIsSubmitting] = useState(false)
	let navigate = useNavigate()

	let spaces = useSpaces().filter(
		space => space.role && space.role !== "reader",
	)
	let defaultDestination = spaces[0]?.id ?? "personal"

	async function copyToNewSpace(name: string) {
		let space = await createSpace(db, ownerId, name)
		return copyToExistingSpace(space.id)
	}
	async function copyToPersonalSpace() {
		let doc = await copyToSynced(db, ownerId, null, content, localAssets)
		onCopy?.(null)
		handleOpenChange(false)
		void navigate({ to: "/doc/$id", params: { id: doc.id } })
		return true
	}
	async function copyToExistingSpace(spaceId: string) {
		let doc = await copyToSynced(db, ownerId, spaceId, content, localAssets)
		onCopy?.({
			id: spaceId,
			name: spaces.find(space => space.id === spaceId)?.name ?? "",
		})
		handleOpenChange(false)
		void navigate({
			to: "/spaces/$spaceId/doc/$id",
			params: { spaceId, id: doc.id },
		})
		return true
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
