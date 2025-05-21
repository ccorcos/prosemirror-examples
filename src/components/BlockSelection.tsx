import { css } from "glamor"
import { exampleSetup } from "prosemirror-example-setup"
import { keymap } from "prosemirror-keymap"
import { Node as ProsemirrorNode, Schema } from "prosemirror-model"
import { schema as basicSchema } from "prosemirror-schema-basic"
import { addListNodes } from "prosemirror-schema-list"
import {
	EditorState,
	NodeSelection,
	Selection,
	TextSelection,
	Transaction,
} from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { useLayoutEffect, useRef } from "react"

// An extension of NodeSelection so that escape/enter toggles between block selection mode.
// Meanwhile, basic node selections can happen by arrowing past an image or an inline token.
type BlockSelection = NodeSelection & { block: true }

function createBlockSelection(doc: ProsemirrorNode, pos: number) {
	const selection = NodeSelection.create(doc, pos) as BlockSelection
	selection.block = true
	return selection
}

function isNodeSelection(selection: Selection): NodeSelection | undefined {
	if (selection instanceof NodeSelection) {
		return selection
	}
}

function isBlockSelection(selection: Selection) {
	const nodeSelection = isNodeSelection(selection) as BlockSelection | undefined
	if (nodeSelection && nodeSelection.block) {
		return nodeSelection
	}
}

// Similar to prosemirror-commands `selectParentNode`.
function selectCurrentBlock(state: EditorState, selection: Selection) {
	let { $from, to } = selection

	let same = $from.sharedDepth(to)
	if (same == 0) return
	let pos = $from.before(same)

	return createBlockSelection(state.doc, pos)
}

// A set of utility functions for transforming selections around the tree.
type SelectionAction = (
	state: EditorState,
	selection: BlockSelection
) => BlockSelection | undefined

const selectParent: SelectionAction = (state, selection) => {
	const { $from } = selection
	// We're at the top-level
	if ($from.depth <= 0) return

	const pos = $from.before()
	return createBlockSelection(state.doc, pos)
}

const selectFirstChild: SelectionAction = (state, selection) => {
	const { $from, node } = selection

	// We're at a leaf.
	if (!node.firstChild?.isBlock) return

	return createBlockSelection(state.doc, $from.pos + 1)
}

const selectNextSibling: SelectionAction = (state, selection) => {
	const { $to } = selection
	const nextIndex = $to.indexAfter()

	// We're at the last sibling.
	if (nextIndex >= $to.parent.childCount) return

	const pos = $to.posAtIndex(nextIndex)
	return createBlockSelection(state.doc, pos)
}

const selectPrevSibling: SelectionAction = (state, selection) => {
	const { $to } = selection
	const prevIndex = $to.indexAfter() - 2

	// We're at the first sibling.
	if (prevIndex < 0) return

	const pos = $to.posAtIndex(prevIndex)
	return createBlockSelection(state.doc, pos)
}

const selectNext: SelectionAction = (state, selection) => {
	let nextSelection: BlockSelection | undefined
	if ((nextSelection = selectFirstChild(state, selection))) {
		return nextSelection
	}

	if ((nextSelection = selectNextSibling(state, selection))) {
		return nextSelection
	}

	// Traverse parents looking for a sibling.
	let parent: BlockSelection | undefined = selection
	while ((parent = selectParent(state, parent))) {
		if ((nextSelection = selectNextSibling(state, parent))) {
			return nextSelection
		}
	}
}

const selectLastChild: SelectionAction = (state, selection) => {
	const first = selectFirstChild(state, selection)
	if (!first) return

	let next: BlockSelection | undefined = first
	let lastChild: BlockSelection | undefined = first
	while ((next = selectNextSibling(state, next))) {
		lastChild = next
	}

	return lastChild
}

const selectPrev: SelectionAction = (state, selection) => {
	// Prev sibling -> recursively last child
	let prevSelection: BlockSelection | undefined
	if ((prevSelection = selectPrevSibling(state, selection))) {
		let lastSelection: BlockSelection | undefined
		while ((lastSelection = selectLastChild(state, prevSelection))) {
			prevSelection = lastSelection
		}
		return prevSelection
	}

	// Traverse to parent.
	if ((prevSelection = selectParent(state, selection))) {
		return prevSelection
	}

	return undefined
}

// Turn a SelectionAction into a Prosemirror Command.
function selectionCommmand(
	action: SelectionAction,
	// Capture the keyboard input when we try to arrow past the end rather than
	// return to TextSelection.
	capture: boolean = false
) {
	return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
		const nodeSelection = isBlockSelection(state.selection)
		if (!nodeSelection) return false

		const selection = action(state, nodeSelection)
		if (!selection) return capture

		if (dispatch) {
			dispatch(state.tr.setSelection(selection).scrollIntoView())
		}
		return true
	}
}

// Mix the nodes from prosemirror-schema-list into the basic schema to
// create a schema with list support.
const schema = new Schema({
	nodes: addListNodes(basicSchema.spec.nodes, "paragraph block*", "block"),
	marks: basicSchema.spec.marks,
})

type EditorSchema = typeof schema

export function BlockSelection() {
	const ref = useRef<HTMLDivElement | null>(null)

	useLayoutEffect(() => {
		// Hide the menu.
		css.global(".ProseMirror-menubar", { display: "none" })

		const node = ref.current
		if (!node) {
			throw new Error("Editor did not render!")
		}

		const doc = schema.nodeFromJSON(initialDocJson)

		const view = new EditorView(node, {
			state: EditorState.create({
				doc: doc,
				schema: schema,
				plugins: [
					keymap({
						// Select current block.
						Escape: (state, dispatch) => {
							if (isBlockSelection(state.selection)) {
								return false
							}
							const nodeSelection = selectCurrentBlock(state, state.selection)
							if (!nodeSelection) {
								return false
							}
							if (dispatch) {
								dispatch(state.tr.setSelection(nodeSelection))
							}
							return true
						},
						// Edit current block.
						Enter: (state, dispatch) => {
							const nodeSelection = isBlockSelection(state.selection)
							if (!nodeSelection) {
								return false
							}
							if (dispatch) {
								// TODO: what if this is an image?
								dispatch(
									state.tr.setSelection(
										TextSelection.create(
											state.tr.doc,
											nodeSelection.$to.pos - 1
										)
									)
								)
							}
							return true
						},

						// Select parent block
						ArrowLeft: selectionCommmand(selectParent, true),

						// Select child block
						ArrowRight: selectionCommmand(selectFirstChild, true),

						// Select next sibling block
						"Ctrl-ArrowDown": selectionCommmand(selectNextSibling, true),

						// Select previous sibling block
						"Ctrl-ArrowUp": selectionCommmand(selectPrevSibling, true),

						// Select next block
						ArrowDown: selectionCommmand(selectNext, true),

						// Select previous block
						ArrowUp: selectionCommmand(selectPrev, true),
					}),
					...exampleSetup({ schema }),
				],
			}),
			attributes: {
				style: [
					"outline: 0px solid transparent",
					"line-height: 1.5",
					"-webkit-font-smoothing: auto",
					"padding: 2em",
				].join(";"),
			},
			dispatchTransaction(transaction) {
				view.updateState(view.state.apply(transaction))
			},
		})

		view.focus()
		;(window as any)["editor"] = { view }
	}, [])
	return <div ref={ref}></div>
}

type NodeJSON = {
	type: string
	content?: Array<NodeJSON>
	attrs?: Record<string, any>
	marks?: Array<{ type: "bold"; attrs?: Record<string, any> }>
	text?: string
}

const initialDocJson: NodeJSON = {
	type: "doc",
	content: [
		{
			type: "heading",
			attrs: { level: 1 },
			content: [{ type: "text", text: "Block Selection" }],
		},
		{
			type: "paragraph",
			content: [{ type: "text", text: "Similar to Notion…" }],
		},
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "Press escape, then arrow keys, then enter..." },
			],
		},
		{
			type: "paragraph",
			content: [
				{ type: "text", text: "This uses the internal NodeSelection." },
			],
		},
		{
			type: "bullet_list",
			content: [
				{
					type: "list_item",
					content: [
						{
							type: "paragraph",
							content: [{ type: "text", text: "List items" }],
						},
						{
							type: "paragraph",
							content: [{ type: "text", text: "With children…" }],
						},
						{
							type: "ordered_list",
							attrs: { order: 1 },
							content: [
								{
									type: "list_item",
									content: [
										{
											type: "paragraph",
											content: [{ type: "text", text: "Nested" }],
										},
									],
								},
								{
									type: "list_item",
									content: [
										{
											type: "paragraph",
											content: [{ type: "text", text: "Lists" }],
										},
									],
								},
							],
						},
					],
				},
				{
					type: "list_item",
					content: [
						{ type: "paragraph", content: [{ type: "text", text: "As well" }] },
					],
				},
			],
		},
		{ type: "paragraph", content: [{ type: "text", text: "And we’re back…" }] },
	],
}
