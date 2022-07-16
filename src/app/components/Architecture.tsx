import {
	deleteSelection,
	joinBackward,
	splitBlock,
	toggleMark,
} from "prosemirror-commands"
import { inputRules, wrappingInputRule } from "prosemirror-inputrules"
import {
	DOMParser,
	DOMSerializer,
	Fragment,
	MarkSpec,
	NodeSpec,
	Schema,
} from "prosemirror-model"
import { EditorState, Plugin, Transaction } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import React, { useLayoutEffect, useRef, useState } from "react"
import { keydownHandler } from "./Keyboard"

export function Architecture() {
	const [state, setState] = useState(
		initEditorState({ ...SimpleEditor, html: `<p>Hello <em>World</em></p>` })
	)

	// Change editor state from outside Prosemirror.
	const removeMarks = () => {
		const tr = state.tr
		tr.removeMark(0, state.doc.content.size)
		const nextState = state.apply(tr)
		setState(nextState)
	}

	return (
		<div>
			<div>Simple Prosemirror Example</div>
			<div>
				<button onClick={removeMarks}>Remove Marks</button>
			</div>
			<SimpleProsemirror {...SimpleEditor} state={state} setState={setState} />
		</div>
	)
}

type Editor = {
	schemaPlugins: SchemaPlugin[]
	statePlugins?: StatePlugin[]
	viewPlugins?: ViewPlugin[]
	commandPlugins?: CommandPlugin[]
}

function initEditorState(args: {
	html?: string
	schemaPlugins: SchemaPlugin[]
	statePlugins?: StatePlugin[]
}) {
	const schema = createSchema(args.schemaPlugins)
	const plugins = (args.statePlugins || []).flatMap((fn) => fn(schema))
	const doc = args.html ? parseHtmlString(schema, args.html) : undefined
	const state = EditorState.create({ plugins, schema, doc })
	return state
}

function SimpleProsemirror(props: {
	viewPlugins?: ViewPlugin[]
	commandPlugins?: CommandPlugin[]
	state: EditorState
	setState: (nextState: EditorState) => void
}) {
	const { state, setState } = props
	const nodeRef = useRef<HTMLDivElement>(null)
	// NOTE: this doesn't ever change
	const schema = state.schema

	const viewRef = useRef<EditorView>()

	useLayoutEffect(() => {
		const node = nodeRef.current!

		// NOTE: assuming these don't change.
		const commands = (props.commandPlugins || []).flatMap((fn) => fn(schema))
		const plugins = (props.viewPlugins || []).flatMap((fn) => fn(schema))

		const view = new EditorView(node, {
			state,
			plugins,
			handleKeyDown: (view, event) => {
				// Or register commands with a command prompt or something.,
				return handleCommandShortcut(view, commands, event)
			},
			dispatchTransaction(tr) {
				const nextState = view.state.apply(tr)
				// Don't want for React to re-render to update the view state. Otherwise
				// if there are two transactions in a row, before the next render, then
				// the second transaction will not have the result of the first transaction.
				view.updateState(nextState)
				setState(nextState)
			},
		})
		viewRef.current = view
		// For debugging...
		;(window as any).view = view
	}, [])

	useLayoutEffect(() => {
		const view = viewRef.current
		if (!view) return
		if (view.state === state) return

		// This will update the view if we edit the state outside of Prosemirror.
		view.updateState(state)
	}, [state])

	return <div ref={nodeRef} style={{ border: "1px solid black" }}></div>
}

// ============================================================================
// Schema Helpers
// ============================================================================

interface SchemaPlugin<N extends string = any, M extends string = any> {
	nodes?: { [K in N]?: NodeSpec }
	marks?: { [K in M]?: MarkSpec }
}

function createSchemaPlugin<N extends string = never, M extends string = never>(
	plugin: SchemaPlugin<N, M>
) {
	return plugin
}
function createSchema<T extends SchemaPlugin<any, any>>(plugins: T[]) {
	const nodes = plugins.reduce(
		(acc, plugin) => Object.assign(acc, plugin.nodes),
		{} as Record<string, NodeSpec>
	)
	const marks = plugins.reduce(
		(acc, plugin) => Object.assign(acc, plugin.marks),
		{} as Record<string, MarkSpec>
	)

	const schema = new Schema({
		nodes: { ...nodes },
		marks: { ...marks },
	})

	// https://stackoverflow.com/questions/49401866/all-possible-keys-of-an-union-type
	type KeysOfUnion<T> = T extends T ? keyof T : never

	return schema as Schema<KeysOfUnion<T["nodes"]>, KeysOfUnion<T["marks"]>>
}

// ============================================================================
// Schema Plugins.
// ============================================================================

const DocumentSchema = createSchemaPlugin({
	nodes: {
		text: {
			group: "inline",
		},

		paragraph: {
			content: "inline*",
			group: "block",
			toDOM() {
				return ["p", 0]
			},
			parseDOM: [{ tag: "p" }],
		},

		doc: { content: "block+" },
	},
})

const QuoteBlockSchema = createSchemaPlugin({
	nodes: {
		blockquote: {
			content: "block+",
			group: "block",
			defining: true,
			parseDOM: [{ tag: "blockquote" }],
			toDOM() {
				return ["blockquote", 0]
			},
		},
	},
})

const ItalicSchema = createSchemaPlugin({
	marks: {
		em: {
			parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }],
			toDOM() {
				return ["em", 0]
			},
		},
	},
})

// ============================================================================
// View Plugin.
// ============================================================================

type ViewPlugin = (schema: Schema) => Plugin<any>[]

// ============================================================================
// State Plugin.
// ============================================================================

type StatePlugin = (schema: Schema) => Plugin<any>[]

// NOTE: schema is not well-typed here. It's a bit annoying, but it takes a lot
// of type mangling to make it work...
const QuoteBlockStatePlugins: StatePlugin = (schema) => [
	inputRules({
		rules: [wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote)],
	}),
]

// ============================================================================
// Command Plugin.
// ============================================================================

type EditorCommand = {
	name: string
	shortcut?: string
	command: (
		state: EditorState,
		dispatch: ((tr: Transaction) => void) | undefined,
		view: EditorView
	) => boolean
}

type CommandPlugin = (schema: Schema) => EditorCommand[]

const ItalicCommands: CommandPlugin = (schema) => [
	{
		name: "Italic",
		shortcut: "Meta-i",
		command: toggleMark(schema.marks.em),
	},
]

const DocumentCommands: CommandPlugin = (schema) => [
	{
		name: "Split block",
		category: "structure",
		shortcut: "Enter",
		command: splitBlock,
	},
	{
		name: "Delete selection",
		category: "structure",
		shortcut: "Backspace",
		command: deleteSelection,
	},
	{
		name: "Join backward",
		category: "structure",
		shortcut: "Backspace",
		command: joinBackward,
	},
]

// NOTE: this thing is hard to test currently -- you need to mangle some things.
// 1. You need to make sure React is batching updates so onKeyDown needs to be
//    registered through React.
// 2. You can see that it doesn't work if we delete view.updateState from the
//    dispatchTransaction callback.
const DoubleDispatchCommands: CommandPlugin = (schema) => [
	{
		name: "Double Dispatch",
		shortcut: "Meta-d",
		command: (state, dispatch, view) => {
			console.log("DISPATCH1")
			DELETE_FIRST: {
				const tr = view.state.tr
				tr.replace(1, 2)
				if (dispatch) dispatch(tr)
			}
			console.log("DISPATCH2")
			DELETE_LAST: {
				const tr = view.state.tr
				tr.replace(tr.doc.content.size - 2, tr.doc.content.size - 1)
				if (dispatch) dispatch(tr)
			}
			return true
		},
	},
]

function handleCommandShortcut(
	view: EditorView,
	commands: EditorCommand[],
	event: KeyboardEvent
): boolean {
	for (const command of commands) {
		if (!command.shortcut) continue
		if (
			keydownHandler({
				[command.shortcut]: () =>
					command.command(view.state, view.dispatch, view),
			})(event)
		)
			return true
	}
	return false
}

// ============================================================================
// Node View.
// ============================================================================

// ============================================================================
// Parsing.
// ============================================================================

function parseHtmlString(schema: Schema, htmlString: string) {
	const doc = document.implementation.createHTMLDocument("New Document")
	const div = doc.createElement("div")
	div.innerHTML = htmlString
	return DOMParser.fromSchema(schema).parse(div)
}

function formatHtmlString(schema: Schema, content: Fragment) {
	const doc = document.implementation.createHTMLDocument("New Document")
	const div = doc.createElement("div")
	const fragment = DOMSerializer.fromSchema(schema).serializeFragment(content)
	div.appendChild(fragment)
	return div.innerHTML
}

const SimpleEditor: Editor = {
	schemaPlugins: [DocumentSchema, QuoteBlockSchema, ItalicSchema],
	statePlugins: [QuoteBlockStatePlugins],
	commandPlugins: [DocumentCommands, ItalicCommands],
	viewPlugins: [],
}

// TODO: double-dispatch should work without re-render in between.
// TODO: nodeView
// TODO: view vs state plugin
// TODO: internal state vs external state
