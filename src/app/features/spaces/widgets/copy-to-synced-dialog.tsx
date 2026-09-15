import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import { toast } from "sonner"
import { co, Group } from "jazz-tools"
import { useAccount } from "jazz-tools/react"
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
import {
	Document,
	UserAccount,
	createSpace,
	createSpaceDocument,
} from "@/schema"
import { getSpaceGroup } from "../lib/spaces"
import { createDocumentMetadata } from "@/app/features/documents"
import { waitForLocalJazzStorage } from "@/app/lib/local-jazz-poke"
import {
	prepareLocalAssetCopy,
	attachLocalAssetCopy,
	assertLocalAssetReferencesAvailable,
	type LocalAsset,
} from "@/app/features/assets"

export { CopyToSyncedDialog }
export type { CopyToSyncedDialogProps }

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
	let me = useAccount(UserAccount, { resolve: spacesQuery })
	let [isSubmitting, setIsSubmitting] = useState(false)
	let navigate = useNavigate()

	let spaces = me?.$isLoaded ? getSortedSpaces(me.root.spaces) : []
	let defaultDestination = spaces[0]?.$jazz.id ?? "personal"

	async function copyToNewSpace(newSpaceName: string) {
		if (!me?.$isLoaded || !newSpaceName) return false

		let space = createSpace(newSpaceName, me.root)
		if (!space.documents?.$isLoaded) return false

		let newDoc = createSpaceDocument(space.$jazz.owner, space.$jazz.id, "")
		let copy = await prepareLocalAssetCopy(
			content,
			localAssets,
			newDoc.$jazz.owner,
		)
		newDoc.content.$jazz.applyDiff(copy.content)
		newDoc.$jazz.applyDiff(createDocumentMetadata(copy.content, new Date()))
		attachLocalAssetCopy(newDoc, copy.assets, newDoc.$jazz.owner)
		space.documents.$jazz.push(newDoc)
		await waitForLocalJazzStorage(me)

		onCopy?.({ id: space.$jazz.id, name: newSpaceName })
		handleOpenChange(false)
		void navigate({
			to: "/spaces/$spaceId/doc/$id",
			params: { spaceId: space.$jazz.id, id: newDoc.$jazz.id },
		})
		return true
	}

	async function copyToPersonalSpace() {
		if (!me?.$isLoaded) return false

		let now = new Date()
		let owner = Group.create()
		let copy = await prepareLocalAssetCopy(content, localAssets, owner)
		let newDoc = Document.create(
			{
				version: 1,
				content: co.plainText().create(copy.content, owner),
				...createDocumentMetadata(copy.content, now),
				createdAt: now,
				updatedAt: now,
			},
			owner,
		)
		attachLocalAssetCopy(newDoc, copy.assets, owner)

		let docs = me.root.documents
		if (!docs) {
			docs = co.list(Document).create([])
			me.root.$jazz.set("documents", docs)
		}
		docs.$jazz.push(newDoc)
		await waitForLocalJazzStorage(me)

		onCopy?.({ id: "personal", name: t("spaces.copy.personal") })
		handleOpenChange(false)
		void navigate({
			to: "/doc/$id",
			params: { id: newDoc.$jazz.id },
		})
		return true
	}

	async function copyToExistingSpace(spaceId: string) {
		if (!me?.$isLoaded) return false

		let space = spaces.find(s => s.$jazz.id === spaceId)
		if (!space?.documents?.$isLoaded) return false

		let newDoc = createSpaceDocument(space.$jazz.owner, space.$jazz.id, "")
		let copy = await prepareLocalAssetCopy(
			content,
			localAssets,
			newDoc.$jazz.owner,
		)
		newDoc.content.$jazz.applyDiff(copy.content)
		newDoc.$jazz.applyDiff(createDocumentMetadata(copy.content, new Date()))
		attachLocalAssetCopy(newDoc, copy.assets, newDoc.$jazz.owner)
		space.documents.$jazz.push(newDoc)
		await waitForLocalJazzStorage(me)

		onCopy?.({ id: space.$jazz.id, name: space.name })
		handleOpenChange(false)
		void navigate({
			to: "/spaces/$spaceId/doc/$id",
			params: { spaceId: space.$jazz.id, id: newDoc.$jazz.id },
		})
		return true
	}

	let form = useForm({
		defaultValues: {
			destination: defaultDestination,
			newSpaceName: "",
		},
		onSubmit: async ({ value }) => {
			if (!me?.$isLoaded) return

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

	{
		let currentSpaces = me?.$isLoaded ? getSortedSpaces(me.root.spaces) : []
		let newDefault = currentSpaces[0]?.$jazz.id ?? "personal"
		if (me?.$isLoaded && form.state.values.destination !== newDefault) {
			form.reset({ destination: newDefault, newSpaceName: "" })
		}
	}

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
											<SelectItem key={space.$jazz.id} value={space.$jazz.id}>
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
