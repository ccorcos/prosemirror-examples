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
// - Allow cmd+shift+clicking to select multiple disjointed blocks.
// - move blocks around
// - drag and drop
//
// LATER:
// - expandPrev and expandNext should call selectNext when shrinking.

// Annoying hack so that we can use this type.
type ProsemirrorNode<S extends Schema = Schema> = ReturnType<
	NodeType<S>["create"]
>

function resolveNode($from: ResolvedPos) {
	const node = $from.nodeAfter!
	const $to = $from.node(0).resolve($from.pos + node.nodeSize)
	return { $from, $to, node }
}

class BlockPosition {
	public $from: ResolvedPos
	public $to: ResolvedPos

	constructor($from: ResolvedPos, $to?: ResolvedPos) {
		if (!$to) {
			$to = resolveNode($from).$to
		}
		this.$from = $from
		this.$to = $to
	}

	static create(doc: ProsemirrorNode, from: number) {
		return new this(doc.resolve(from))
	}
}

class BlockSelection {
	public $anchor: BlockPosition
	public $head: BlockPosition

	constructor($anchor: BlockPosition, $head?: BlockPosition) {
		$head = $head || $anchor

		// When the head encapsulated the anchor.
		if (
			$head.$from.pos <= $anchor.$from.pos &&
			$head.$to.pos >= $anchor.$to.pos
		) {
			this.$anchor = $head
			this.$head = $head
			// } else if (
			// 	$head.$from.pos >= $anchor.$from.pos &&
			// 	$head.$to.pos <= $anchor.$to.pos
			// ) {
		} else {
			this.$anchor = $anchor
			this.$head = $head
		}
	}

	static create(doc: ProsemirrorNode, from: number) {
		return new this(new BlockPosition(doc.resolve(from)))
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

// TODO: SelectionAction should use BlockPos, not BlockSelection.
// A set of utility functions for transforming selections around the tree.
type SelectionAction = (
	state: EditorState<EditorSchema>,
	selection: BlockPosition
) => BlockPosition | undefined

const selectParent: SelectionAction = (state, selection) => {
	const { $from } = selection
	// We're at the top-level
	if ($from.depth <= 0) return

	const pos = $from.before()
	return BlockPosition.create(state.doc, pos)
}

const selectFirstChild: SelectionAction = (state, selection) => {
	const { $from } = selection

	// We're at a leaf.
	// if (!node.firstChild?.isBlock) return
	if (!$from.nodeAfter?.firstChild?.isBlock) return

	return BlockPosition.create(state.doc, $from.pos + 1)
}

const selectNextSibling: SelectionAction = (state, selection) => {
	const { $to } = selection
	const nextIndex = $to.indexAfter()

	// We're at the last sibling.
	if (nextIndex >= $to.parent.childCount) return

	const pos = $to.posAtIndex(nextIndex)
	return BlockPosition.create(state.doc, pos)
}

const selectPrevSibling: SelectionAction = (state, selection) => {
	const { $from } = selection
	const prevIndex = $from.indexAfter() - 1

	// We're at the first sibling.
	if (prevIndex < 0) return

	const pos = $from.posAtIndex(prevIndex)
	return BlockPosition.create(state.doc, pos)
}

const selectNext: SelectionAction = (state, selection) => {
	let nextSelection: BlockPosition | undefined
	if ((nextSelection = selectFirstChild(state, selection))) {
		return nextSelection
	}

	if ((nextSelection = selectNextSibling(state, selection))) {
		return nextSelection
	}

	// Traverse parents looking for a sibling.
	return selectNextParentSubling(state, selection)
}

const selectNextParentSubling: SelectionAction = (state, selection) => {
	let nextSelection: BlockPosition | undefined

	// Traverse parents looking for a sibling.
	let parent: BlockPosition | undefined = selection
	while ((parent = selectParent(state, parent))) {
		if ((nextSelection = selectNextSibling(state, parent))) {
			return nextSelection
		}
	}
}

const selectLastChild: SelectionAction = (state, selection) => {
	const first = selectFirstChild(state, selection)
	if (!first) return

	let next: BlockPosition | undefined = first
	let lastChild: BlockPosition | undefined = first
	while ((next = selectNextSibling(state, next))) {
		lastChild = next
	}

	return lastChild
}

const selectPrev: SelectionAction = (state, selection) => {
	// Prev sibling -> recursively last child
	let prevSelection: BlockPosition | undefined
	if ((prevSelection = selectPrevSibling(state, selection))) {
		let lastSelection: BlockPosition | undefined
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

type ExpandAction = (
	state: EditorState<EditorSchema>,
	selection: BlockSelection
) => BlockSelection | undefined

const expandNext: ExpandAction = (state, selection) => {
	const nextSibling = selectNextSibling(state, selection.$head)
	if (nextSibling) {
		return new BlockSelection(selection.$anchor, nextSibling)
	}

	const nextAbove = selectNextParentSubling(state, selection.$head)
	if (nextAbove) {
		return new BlockSelection(selection.$anchor, nextAbove)
	}
}

const expandPrev: ExpandAction = (state, selection) => {
	const prevSibling = selectPrevSibling(state, selection.$head)
	if (prevSibling) {
		return new BlockSelection(selection.$anchor, prevSibling)
	}

	const parent = selectParent(state, selection.$head)
	if (parent) {
		return new BlockSelection(selection.$anchor, parent)
	}
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
			content: [{ type: "text", text: "Block Selection Plugin" }],
		},
		{
			type: "paragraph",
			content: [{ type: "text", text: "Similar to Notion…" }],
		},
		{
			type: "paragraph",
			content: [
				{
					type: "text",
					text: "Press escape, then arrow keys, then enter... Try holding to expand the selection.",
				},
			],
		},
		{
			type: "paragraph",
			content: [
				{
					type: "text",
					text: "Also try shift clicking to expand the selection.",
				},
			],
		},

		{
			type: "paragraph",
			content: [
				{
					type: "text",
					text: "This uses a custom BlockSelection implementation.",
				},
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

					const $head = action(state, pluginState.$head)
					if (!$head) return capture

					if (dispatch) {
						pluginDispatch({ newState: new BlockSelection($head) })
					}
					return true
				}
			}

			function expandCommmand(
				action: ExpandAction,
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
						pluginDispatch({ newState: null })
						return true
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
								TextSelection.create(
									state.tr.doc,
									pluginState.$head.$to.pos - 1
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
				"Shift-ArrowDown": expandCommmand(expandNext, true),

				// Select previous block
				ArrowUp: selectionCommmand(selectPrev, true),
				"Shift-ArrowUp": expandCommmand(expandPrev, true),
			})

			return handler(view, event)
		},

		handleDOMEvents: {
			mousedown(view, event) {
				// Handle shift-click to expand selection.
				const pluginState: BlockSelectionPluginState = this.getState(view.state)
				if (pluginState === null) {
					return false
				}

				const pluginDispatch = (action: BlockSelectionPluginAction) => {
					view.dispatch(view.state.tr.setMeta(pluginKey, action))
				}

				if (!event.shiftKey) {
					pluginDispatch({ newState: null })
					return false
				}

				const result = view.posAtCoords({
					left: event.clientX,
					top: event.clientY,
				})
				if (!result) {
					return false
				}

				// Prevent text selection.
				event.preventDefault()

				const $pos = view.state.doc.resolve(result.pos)

				// TODO: sometimes this doesn't work great and there's a runtime error...
				const nodePos = $pos.depth === 0 ? $pos.pos : $pos.before()

				const $node = new BlockPosition(view.state.doc.resolve(nodePos))
				const { $anchor, $head } = pluginState

				const $start = $anchor.$from.pos < $head.$from.pos ? $anchor : $head
				const $end = $anchor.$from.pos > $head.$from.pos ? $anchor : $head

				// If node is before start
				if ($node.$from.pos < $start.$from.pos) {
					pluginDispatch({ newState: new BlockSelection($end, $node) })
					return true
				}
				// If node is after end
				if ($node.$to.pos > $end.$to.pos) {
					pluginDispatch({ newState: new BlockSelection($start, $node) })
					return true
				}
				// If node is inside
				pluginDispatch({ newState: new BlockSelection($anchor, $node) })
				return true
			},
		},
		decorations(editorState) {
			const state: BlockSelectionPluginState = this.getState(editorState)

			if (state === null) {
				return null
			}
			console.log(
				`BlockSelection(${state.$anchor.$from.pos}, ${state.$head.$to.pos})`
			)

			const ranges: Array<[number, number]> = []

			// Set to true to show nested highlights.
			const showNested = false

			let lastPos = -1

			const { $anchor, $head } = state
			const $start = $anchor.$from.pos < $head.$from.pos ? $anchor : $head
			const $end = $anchor.$from.pos > $head.$from.pos ? $anchor : $head

			let $node = $start
			while ($node.$from.pos < $end.$to.pos) {
				if (showNested) {
					ranges.push([$node.$from.pos, $node.$to.pos])
				} else if ($node.$from.pos >= lastPos) {
					ranges.push([$node.$from.pos, $node.$to.pos])
					lastPos = $node.$to.pos
				}

				const $next = selectNext(editorState, $node)
				if (!$next) {
					break
				}
				$node = $next
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
