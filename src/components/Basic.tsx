import { toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { Schema } from "prosemirror-model"
import { EditorState, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { useLayoutEffect, useMemo, useRef } from "react"

const schema = new Schema({
	nodes: {
		doc: { content: "block+" },
		paragraph: {
			group: "block",
			content: "inline*",
			parseDOM: [{ tag: "p" }],
			toDOM: () => ["p", 0],
		},
		text: { group: "inline", inline: true },
	},
	marks: {
		bold: {
			parseDOM: [{ tag: "strong" }],
			toDOM: () => ["strong", 0],
		},
	},
})

export type EditorSchema = typeof schema

type SchemaNodeType<T> = T extends Schema<infer N, infer _> ? N : never
type SchemaMarkType<T> = T extends Schema<infer _, infer M> ? M : never

export type EditorNodeType = SchemaNodeType<EditorSchema>
export type EditorMarkType = SchemaMarkType<EditorSchema>

const initialDoc = schema.node("doc", null, [
	schema.node("paragraph", null, [
		schema.text("Hello "),
		schema.text("world", [schema.marks.bold.create()]),
	]),
	schema.node("paragraph", null),
])

export function Basic() {
	const initialState = useMemo(() => {
		const doc = initialDoc
		const state = EditorState.create({
			schema: schema,
			doc: doc,
			selection: TextSelection.create(doc, 1),
			plugins: [keymap({ "Mod-b": toggleMark(schema.marks.bold) })],
		})
		return state
	}, [])

	const divRef = useRef<HTMLDivElement | null>(null)
	const viewRef = useRef<EditorView | null>(null)

	// Mount the view.
	useLayoutEffect(() => {
		const node = divRef.current
		if (!node) throw new Error("Editor did not render!")
		const view = new EditorView(
			{ mount: node },
			{
				state: initialState,
				attributes: { style: "-webkit-font-smoothing: auto" },
				dispatchTransaction(transaction) {
					const newState = view.state.apply(transaction)
					view.updateState(newState)
				},
			}
		)
		viewRef.current = view
	}, [])

	const selectAll = () => {
		const view = viewRef.current
		if (!view) return
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, 0, view.state.doc.content.size)
			)
		)
		view.focus()
	}

	return (
		<div>
			<button onClick={selectAll}>Select All</button>
			<div ref={divRef}></div>
		</div>
	)
}
