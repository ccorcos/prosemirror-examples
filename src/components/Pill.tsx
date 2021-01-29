/*

Pill example.

Resources:
https://prosemirror.net/examples/footnote/

*/

import React, { useLayoutEffect, useRef } from "react"
import { MarkSpec, NodeSpec, NodeType, Schema } from "prosemirror-model"
import { EditorState, Transaction } from "prosemirror-state"
import { Decoration, EditorView, NodeView } from "prosemirror-view"
import { keymap } from "prosemirror-keymap"
import { StepMap } from "prosemirror-transform"
import { history, undo, redo } from "prosemirror-history"
import { toggleMark } from "prosemirror-commands"

// ==================================================================
// Pill Plugin
// ==================================================================

// https://github.com/DefinitelyTyped/DefinitelyTyped/pull/49646
type ProsemirrorNode<S extends Schema> = ReturnType<NodeType<S>["create"]>

const pill: NodeSpec = {
	group: "inline",
	content: "inline*",
	inline: true,
	atom: true,
	parseDOM: [{ tag: "span.pill" }],
}

const pillPlugin = keymap({
	"Mod-p": (
		state: EditorState<Schema>,
		dispatch?: (tr: Transaction<Schema>) => void,
		view?: EditorView<Schema>
	) => {
		if (dispatch) {
			dispatch(
				state.tr.insert(
					state.selection.$anchor.pos,
					state.schema.nodes.pill.create()
				)
			)
		}
		return true
	},
})

// This is an inline element with content.
class PillView implements NodeView<Schema> {
	dom: HTMLElement
	getPos: () => number

	node: ProsemirrorNode<Schema>
	outerView: EditorView<Schema>
	innerView: EditorView<Schema>

	constructor(
		node: ProsemirrorNode<Schema>,
		view: EditorView<Schema>,
		getPos: (() => number) | boolean,
		decorations: Decoration[]
	) {
		this.node = node
		this.outerView = view
		this.getPos = getPos as any

		this.dom = document.createElement("span")
		this.dom.classList.add("pill")

		// Create the inner document.
		this.innerView = new EditorView(this.dom, {
			attributes: {
				style: "display: inline; padding: 0 0.5em; border: 1px solid gray;",
			},
			state: EditorState.create({
				doc: this.node,
				plugins: [
					keymap({
						"Mod-z": () => undo(this.outerView.state, this.outerView.dispatch),
						"Mod-y": () => redo(this.outerView.state, this.outerView.dispatch),
					}),
				],
			}),
			dispatchTransaction: this.dispatchInner.bind(this),
			handleDOMEvents: {
				mousedown: () => {
					// Kludge to prevent issues due to the fact that the whole
					// footnote is node-selected (and thus DOM-selected) when
					// the parent editor is focused.
					if (this.outerView.hasFocus()) this.innerView.focus()

					return false
				},
			},
		})
	}

	dispatchInner(tr) {
		if (!this.innerView) {
			return
		}
		let { state, transactions } = this.innerView.state.applyTransaction(tr)
		this.innerView.updateState(state)

		if (!tr.getMeta("fromOutside")) {
			let outerTr = this.outerView.state.tr,
				offsetMap = StepMap.offset(this.getPos() + 1)
			for (let i = 0; i < transactions.length; i++) {
				let steps = transactions[i].steps
				for (let j = 0; j < steps.length; j++)
					outerTr.step(steps[j].map(offsetMap)!)
			}
			if (outerTr.docChanged) this.outerView.dispatch(outerTr)
		}
	}

	update(node) {
		if (!node.sameMarkup(this.node)) return false
		this.node = node
		if (this.innerView) {
			let state = this.innerView.state
			let start = node.content.findDiffStart(state.doc.content)
			if (start != null) {
				let { a: endA, b: endB } = node.content.findDiffEnd(state.doc.content)
				let overlap = start - Math.min(endA, endB)
				if (overlap > 0) {
					endA += overlap
					endB += overlap
				}
				this.innerView.dispatch(
					state.tr
						.replace(start, endB, node.slice(start, endA))
						.setMeta("fromOutside", true)
				)
			}
		}
		return true
	}

	selectNode() {
		this.dom.classList.add("ProseMirror-selectednode")
		this.innerView.focus()
	}

	deselectNode() {
		this.dom.classList.remove("ProseMirror-selectednode")
	}

	destroy() {
		this.innerView.destroy()
	}

	stopEvent(event) {
		return this.innerView.dom.contains(event.target)
	}

	ignoreMutation() {
		return true
	}
}

// ==================================================================
// ProseMirror Editor
// ==================================================================

const doc: NodeSpec = { content: "inline*" }
const text: NodeSpec = { group: "inline" }

const bold: MarkSpec = {
	parseDOM: [{ tag: "strong" }],
	toDOM() {
		return ["strong", 0]
	},
}

const nodes = {
	doc,
	text,
	pill,
}
const marks = { bold }

const schema = new Schema({ nodes, marks })
type EditorSchema = typeof schema
type EditorNodeType = keyof typeof nodes
type EditorMarkType = keyof typeof marks

type NodeJSON = {
	type: EditorNodeType
	content?: Array<NodeJSON>
	attrs?: Record<string, any>
	marks?: Array<{ type: "bold"; attrs?: Record<string, any> }>
	text?: string
}

const initialDoc: NodeJSON = {
	type: "doc",
	content: [
		{ type: "text", text: "Press cmd+p to create a pill you can type in." },
	],
}

export function Editor() {
	const ref = useRef<HTMLDivElement | null>(null)

	useLayoutEffect(() => {
		const node = ref.current
		if (!node) {
			throw new Error("Editor did not render!")
		}

		const state = EditorState.create({
			schema: schema,
			doc: schema.nodeFromJSON(initialDoc),
			plugins: [
				history(),
				keymap({ "Mod-z": undo, "Mod-y": redo }),
				keymap({ "Mod-b": toggleMark(schema.marks.bold) }),
				pillPlugin,
			],
		})

		const view = new EditorView<EditorSchema>(node, {
			state,
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
			nodeViews: {
				pill: (node, view, getPos, decorations) => {
					return new PillView(node, view, getPos, decorations)
				},
			},
		})

		window["editor"] = { view }
	}, [])
	return <div ref={ref}></div>
}
