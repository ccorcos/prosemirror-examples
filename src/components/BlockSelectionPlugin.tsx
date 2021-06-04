import React, { useLayoutEffect, useRef } from "react"

import { Decoration, DecorationSet, EditorView } from "prosemirror-view"
import { Schema, NodeType, ResolvedPos } from "prosemirror-model"
import { schema as basicSchema } from "prosemirror-schema-basic"
import { addListNodes } from "prosemirror-schema-list"
import { exampleSetup } from "prosemirror-example-setup"

import {
	EditorState,
	Selection,
	TextSelection,
	Transaction,
	Plugin,
	PluginKey,
} from "prosemirror-state"
import { css } from "glamor"
import { keydownHandler } from "prosemirror-keymap"

// TODO:
// - how can we use this same logic as a 'custom' Selection on state.selection?
//   - main goal here is to get blur the text selection during block selection, both browser and proremirror.
// - expand selections with shift-arrow keys,

// Annoying hack so that we can use this type.
type ProsemirrorNode<S extends Schema = Schema> = ReturnType<
	NodeType<S>["create"]
>

function resolveNode($from: ResolvedPos) {
	const node = $from.nodeAfter!
	const $to = $from.node(0).resolve($from.pos + node.nodeSize)
	return { $from, $to, node }
}

class BlockSelection {
	public $from: ResolvedPos
	public $to: ResolvedPos
	constructor($from: ResolvedPos, $to?: ResolvedPos) {
		if (!$to) {
			$to = resolveNode($from).$to
		}
		this.$from = $from
		this.$to = $to
	}

	static create(doc: ProsemirrorNode, from: number, to?: number) {
		if (to === undefined) {
			return new this(doc.resolve(from))
		} else {
			return new this(doc.resolve(from), doc.resolve(to))
		}
	}
}

// Similar to prosemirror-commands `selectParentNode`.
function selectCurrentBlock(
	state: EditorState<EditorSchema>,
	selection: Selection
) {
	let { $from, to } = selection

	let same = $from.sharedDepth(to)
	if (same == 0) return
	let pos = $from.before(same)

	return BlockSelection.create(state.doc, pos)
}

// A set of utility functions for transforming selections around the tree.
type SelectionAction = (
	state: EditorState<EditorSchema>,
	selection: BlockSelection
) => BlockSelection | undefined

const selectParent: SelectionAction = (state, selection) => {
	const { $from } = selection
	// We're at the top-level
	if ($from.depth <= 0) return

	const pos = $from.before()
	return BlockSelection.create(state.doc, pos)
}

const selectFirstChild: SelectionAction = (state, selection) => {
	const { $from } = selection

	// We're at a leaf.
	// if (!node.firstChild?.isBlock) return
	if (!$from.nodeAfter?.firstChild?.isBlock) return

	return BlockSelection.create(state.doc, $from.pos + 1)
}

const selectNextSibling: SelectionAction = (state, selection) => {
	const { $to } = selection
	const nextIndex = $to.indexAfter()

	// We're at the last sibling.
	if (nextIndex >= $to.parent.childCount) return

	const pos = $to.posAtIndex(nextIndex)
	return BlockSelection.create(state.doc, pos)
}

const selectPrevSibling: SelectionAction = (state, selection) => {
	const { $from } = selection
	const prevIndex = $from.indexAfter() - 1

	// We're at the first sibling.
	if (prevIndex < 0) return

	const pos = $from.posAtIndex(prevIndex)
	return BlockSelection.create(state.doc, pos)
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

const expandNext: SelectionAction = (state, selection) => {
	const next = selectNext(state, selection)
	if (!next) {
		return
	}

	return BlockSelection.create(
		state.doc,
		Math.min(selection.$from.pos, next.$from.pos),
		Math.max(selection.$to.pos, next.$to.pos)
	)
}

const expandPrev: SelectionAction = (state, selection) => {
	const prev = selectPrev(state, selection)
	if (!prev) {
		return
	}

	return BlockSelection.create(
		state.doc,
		Math.min(selection.$from.pos, prev.$from.pos),
		Math.max(selection.$to.pos, prev.$to.pos)
	)
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

// Mix the nodes from prosemirror-schema-list into the basic schema to
// create a schema with list support.
const schema = new Schema({
	nodes: addListNodes(basicSchema.spec.nodes, "paragraph block*", "block"),
	marks: basicSchema.spec.marks,
})

type EditorSchema = typeof schema

export function BlockSelectionPlugin() {
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
				plugins: [selectionPlugin, ...exampleSetup({ schema })],
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

		window["editor"] = { view }
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

type BlockSelectionPluginState = null | BlockSelection

type BlockSelectionPluginAction = { newState: BlockSelectionPluginState }

const pluginKey = new PluginKey("block-selection")

const selectionPlugin = new Plugin<BlockSelectionPluginState, EditorSchema>({
	key: pluginKey,
	state: {
		init() {
			return null
		},
		apply(tr, state) {
			const action: BlockSelectionPluginAction | undefined =
				tr.getMeta(pluginKey)
			if (action) {
				return action.newState
			}
			return state
		},
	},

	props: {
		handleKeyDown(view, event) {
			const pluginState = this.getState(view.state)

			const pluginDispatch = (action: BlockSelectionPluginAction) => {
				view.dispatch(view.state.tr.setMeta(pluginKey, action))
			}

			function selectionCommmand(
				action: SelectionAction,
				// Capture the keyboard input when we try to arrow past the end rather than
				// return to TextSelection.
				capture: boolean = false
			) {
				return (state: EditorState, dispatch?: (tr: Transaction) => void) => {
					if (pluginState === null) {
						return false
					}

					const selection = action(state, pluginState)
					if (!selection) return capture

					if (dispatch) {
						pluginDispatch({ newState: selection })
					}
					return true
				}
			}

			const handler = keydownHandler({
				// Select current block.
				Escape: (state, dispatch) => {
					if (pluginState !== null) {
						return false
					}
					const nodeSelection = selectCurrentBlock(state, state.selection)
					if (!nodeSelection) {
						return false
					}
					if (dispatch) {
						// dispatch(view.state.tr.setSelection(nodeSelection))
						pluginDispatch({ newState: nodeSelection })
					}
					return true
				},
				// Edit current block.
				Enter: (state, dispatch) => {
					if (pluginState === null) {
						return false
					}
					if (dispatch) {
						pluginDispatch({ newState: null })
						dispatch(
							state.tr.setSelection(
								TextSelection.create(state.tr.doc, pluginState.$to.pos - 1)
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
				"Shift-ArrowDown": selectionCommmand(expandNext, true),

				// Select previous block
				ArrowUp: selectionCommmand(selectPrev, true),
				"Shift-ArrowUp": selectionCommmand(expandPrev, true),
			})

			return handler(view, event)
		},
		decorations(editorState) {
			const state: BlockSelectionPluginState = this.getState(editorState)

			if (state === null) {
				return null
			}
			console.log(`BlockSelection(${state.$from.pos}, ${state.$to.pos})`)

			const ranges: Array<[number, number]> = []

			// Set to true to show nested highlights.
			const showNested = false

			let lastPos = -1
			let nodeRange = new BlockSelection(state.$from)
			while (nodeRange.$from.pos < state.$to.pos) {
				if (showNested) {
					ranges.push([nodeRange.$from.pos, nodeRange.$to.pos])
				} else if (nodeRange.$from.pos >= lastPos) {
					ranges.push([nodeRange.$from.pos, nodeRange.$to.pos])
					lastPos = nodeRange.$to.pos
				}

				const nextRange = selectNext(editorState, nodeRange)
				if (!nextRange) {
					break
				}
				nodeRange = nextRange
			}

			return DecorationSet.create(
				editorState.doc,
				ranges.map(([from, to]) =>
					Decoration.node(from, to, {
						class: "custom-selection",
					})
				)
			)
		},
	},
})
