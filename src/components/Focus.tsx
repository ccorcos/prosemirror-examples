/*

Autocomplete example.

Resources:
https://discuss.prosemirror.net/t/how-to-update-plugin-state-from-handlekeydown-props/3420
https://discuss.prosemirror.net/t/how-to-get-a-selection-rect/3430

*/

import React, { useLayoutEffect, useRef } from "react"
import { MarkSpec, NodeSpec, Schema } from "prosemirror-model"
import { EditorState, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { history, undo, redo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { toggleMark } from "prosemirror-commands"

const doc: NodeSpec = {
	content: "block+",
}

const paragraph: NodeSpec = {
	content: "inline*",
	group: "block",
	parseDOM: [{ tag: "p" }],
	toDOM() {
		return [
			"p",
			{ style: "max-width: 40rem; margin: 0px auto; padding: 3px 2px;" },
			0,
		]
	},
}

const text: NodeSpec = {
	group: "inline",
}

const bold: MarkSpec = {
	parseDOM: [{ tag: "strong" }],
	toDOM() {
		return ["strong", 0]
	},
}

const nodes = {
	doc,
	paragraph,
	text,
}
const marks = { bold }

const schema = new Schema({ nodes, marks })
export type EditorSchema = typeof schema
export type EditorNodeType = keyof typeof nodes
export type EditorMarkType = keyof typeof marks

type NodeJSON = {
	type: EditorNodeType
	content?: Array<NodeJSON>
	attrs?: Record<string, any>
	marks?: Array<{ type: "bold"; attrs?: Record<string, any> }>
	text?: string
}

const initialDocJson: NodeJSON = {
	type: "doc",
	content: [
		{
			type: "paragraph",
			content: [{ type: "text", text: "Initial focus should be here ->" }],
		},
		{
			type: "paragraph",
			content: [],
		},
		{
			type: "paragraph",
			content: [{ type: "text", text: "Third paragraph." }],
		},
	],
}

export function Focus() {
	const ref = useRef<HTMLDivElement | null>(null)

	useLayoutEffect(() => {
		const node = ref.current
		if (!node) {
			throw new Error("Editor did not render!")
		}

		const doc = schema.nodeFromJSON(initialDocJson)

		const state = EditorState.create({
			selection: TextSelection.atEnd(doc.firstChild!),
			schema: schema,
			doc: doc,
			plugins: [
				history(),
				keymap({ "Mod-z": undo, "Mod-y": redo }),
				keymap({ "Mod-b": toggleMark(schema.marks.bold) }),
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
		})

		view.focus()

		window["editor"] = { view }
	}, [])
	return <div ref={ref}></div>
}
