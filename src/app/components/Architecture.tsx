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
import React, { useLayoutEffect, useRef } from "react"
import { keydownHandler } from "./Keyboard"

export function Architecture() {
	return (
		<div>
			<div>Hello</div>
			<SimpleProsemirror />
		</div>
	)
}

function SimpleProsemirror() {
	const ref = useRef<HTMLDivElement>(null)

	useLayoutEffect(() => {
		const node = ref.current!

		const schema = createSchema([
			DocumentSchema,
			QuoteBlockSchema,
			ItalicSchema,
		])

		const statePlugins = [...QuoteBlockStatePlugins(schema)]
		const viewPlugins = []
		const commands = [...ItalicCommands(schema), ...DocumentCommands(schema)]
		// const nodeViews = createNodeViews(editorPlugins)

		const state = EditorState.create({ plugins: statePlugins, schema })
		const view = new EditorView(node, {
			state,
			plugins: viewPlugins,
			// nodeViews,
			handleKeyDown: (view, event) => {
				return handleCommandShortcut(view, commands, event)
			},
		})
	}, [])

	return <div ref={ref} style={{ border: "1px solid black" }}></div>
}

// ============================================================================
// Schema Helpers
// ============================================================================

interface SchemaSpecPlugin<N extends string = never, M extends string = never> {
	nodes?: { [K in N]?: NodeSpec }
	marks?: { [K in M]?: MarkSpec }
}

function createSchemaPlugin<N extends string = never, M extends string = never>(
	plugin: SchemaSpecPlugin<N, M>
) {
	return plugin
}
function createSchema<T extends SchemaSpecPlugin<any, any>>(plugins: T[]) {
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

// NOTE: schema is not well-typed here. It's a bit annoying, but it takes a lot
// of type mangling to make it work...
const QuoteBlockStatePlugins = (schema: Schema): Plugin<any>[] => [
	inputRules({
		rules: [wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote)],
	}),
]

// ============================================================================
// Command Plugin.
// ============================================================================

type EditorCommand = { name: string; shortcut?: string; command: Command }

const ItalicCommands = (schema: Schema): EditorCommand[] => [
	{
		name: "Italic",
		shortcut: "Meta-i",
		command: toggleMark(schema.marks.em),
	},
]

const DocumentCommands = (schema: Schema) => [
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

// TODO

// ============================================================================
// Node View.
// ============================================================================

// TODO

// TODO: nodeView
// TODO: state plugin
