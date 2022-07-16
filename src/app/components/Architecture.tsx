import {
	deleteSelection,
	joinBackward,
	splitBlock,
	toggleMark,
} from "prosemirror-commands"
import { inputRules, wrappingInputRule } from "prosemirror-inputrules"
import { MarkSpec, NodeSpec, Schema } from "prosemirror-model"
import { Command, EditorState, Plugin } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import React, { useLayoutEffect, useRef, useState } from "react"
import { keydownHandler } from "./Keyboard"

export function Architecture() {
	const [state, setState] = useState(initEditorState())

	return (
		<div>
			<div>Hello</div>
			<SimpleProsemirror state={state} setState={setState} />
		</div>
	)
}

function initEditorState() {
	const schema = createSchema([DocumentSchema, QuoteBlockSchema, ItalicSchema])
	const plugins = [...QuoteBlockStatePlugins(schema)]
	const state = EditorState.create({ plugins, schema })
	return state
}

function SimpleProsemirror(props: {
	state: EditorState
	setState: (nextState: EditorState) => void
}) {
	const { state, setState } = props
	const nodeRef = useRef<HTMLDivElement>(null)
	const schema = state.schema // NOTE: this doesn't ever change

	const viewRef = useRef<EditorView>()

	useLayoutEffect(() => {
		const node = nodeRef.current!

		const viewPlugins = []
		const commands = [...ItalicCommands(schema), ...DocumentCommands(schema)]

		const view = new EditorView(node, {
			state,
			plugins: viewPlugins,
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

interface SchemaPlugin<N extends string = never, M extends string = never> {
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

type EditorCommand = { name: string; shortcut?: string; command: Command }

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

function handleCommandShortcut(
	view: EditorView,
	commands: EditorCommand[],
	event: KeyboardEvent
): boolean {
	for (const command of commands) {
		if (!command.shortcut) continue
		if (
			keydownHandler({
				[command.shortcut]: () => command.command(view.state, view.dispatch),
			})(event)
		)
			return true
	}
	return false
}

// ============================================================================
// Node View.
// ============================================================================

// TODO: controlled app state
// TODO: nodeView
// TODO: view vs state plugin
// TODO: internal state vs external state
