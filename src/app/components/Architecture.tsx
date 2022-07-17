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
import { EditorState, Plugin, PluginKey, Transaction } from "prosemirror-state"
import {
	Decoration,
	DecorationSet,
	EditorView,
	NodeViewConstructor,
} from "prosemirror-view"
import React, { CSSProperties, useLayoutEffect, useRef, useState } from "react"
import { keydownHandler } from "./Keyboard"

export function Architecture() {
	const [state, setState] = useState(
		initEditorState({ ...SimpleEditor, html: `<p>Hello <em>World</em></p>` })
	)

	const [focused, setFocused] = useState(false)

	// Change editor state from outside Prosemirror.
	const removeMarks = () => {
		const tr = state.tr
		tr.removeMark(0, state.doc.content.size)
		const nextState = state.apply(tr)
		setState(nextState)
	}

	const docFocused = focusKey.getState(state) === null

	return (
		<div>
			<div>Simple Prosemirror Example</div>
			<div>
				<button onClick={removeMarks}>Remove Marks</button>
			</div>
			<ProsemirrorEditor
				{...SimpleEditor}
				state={state}
				setState={setState}
				style={{
					outline: focused && docFocused ? "1px solid green" : undefined,
					outlineOffset: -1,
				}}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
			>
				{(state, view) => (
					<>
						<PopupMenu state={state} view={view} />
						<div>Focus: {focusKey.getState(state) || "null"}</div>
					</>
				)}
			</ProsemirrorEditor>
		</div>
	)
}

type Editor = {
	schemaPlugins: SchemaPlugin[]
	statePlugins?: StatePlugin[]
	viewPlugins?: ViewPlugin[]
	commandPlugins?: CommandPlugin[]
	nodeViewPlugins?: NodeViewPlugin[]
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

function ProsemirrorEditor(props: {
	viewPlugins?: ViewPlugin[]
	commandPlugins?: CommandPlugin[]
	nodeViewPlugins?: NodeViewPlugin[]
	state: EditorState
	style?: CSSProperties
	setState: (nextState: EditorState) => void
	// NOTE: This abstraction might change back to a view plugin, because we need to figure out
	// a way to plumb React context into node views anyways...
	children?: (state: EditorState, view: EditorView) => React.ReactNode

	onFocus?: () => void
	onBlur?: () => void
}) {
	const { state, setState, style } = props
	const nodeRef = useRef<HTMLDivElement>(null)
	// NOTE: this doesn't ever change
	const schema = state.schema

	const [view, setView] = useState<EditorView>()
	useLayoutEffect(() => {
		const node = nodeRef.current!

		// NOTE: assuming these don't change.
		const commands = (props.commandPlugins || []).flatMap((fn) => fn(schema))
		const plugins = (props.viewPlugins || []).flatMap((fn) => fn(schema))

		const nodeViews = (props.nodeViewPlugins || []).reduce<NodeViewPlugin>(
			(a, b) => Object.assign(a, b),
			{}
		)

		const view = new EditorView(node, {
			state,
			plugins,
			nodeViews,
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
		setView(view)
		// For debugging...
		;(window as any).view = view

		return () => {
			view.destroy()
		}
	}, [])

	useLayoutEffect(() => {
		if (!view) return
		if (view.state === state) return

		// This will update the view if we edit the state outside of Prosemirror.
		view.updateState(state)
	}, [view, state])

	useLayoutEffect(() => {
		if (!view) return
		if (!props.onFocus) return
		const onFocus = props.onFocus
		view.dom.addEventListener("focus", onFocus)
		return () => {
			view.dom.removeEventListener("focus", onFocus)
		}
	}, [view, props.onFocus])

	useLayoutEffect(() => {
		if (!view) return
		if (!props.onBlur) return
		const onBlur = props.onBlur
		view.dom.addEventListener("blur", onBlur)
		return () => {
			view.dom.removeEventListener("blur", onBlur)
		}
	}, [view, props.onBlur])

	return (
		<>
			{props.children && view && props.children(state, view)}
			<div ref={nodeRef} style={{ border: "1px solid #ddd", ...style }}></div>
		</>
	)
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

// ============================================================================
// FocusState.
// ============================================================================

type FocusPluginState = string | null

const focusKey = new PluginKey<FocusPluginState>("focus")

const FocusStatePlugins: StatePlugin = (schema) => [
	new Plugin<FocusPluginState>({
		key: focusKey,
		state: {
			init: () => null,
			apply: (tr, state) => {
				const action = tr.getMeta(focusKey)
				if (action !== undefined) return action
				return state
			},
		},
	}),
]

function setFocus(tr: Transaction, focusState: FocusPluginState) {
	tr.setMeta(focusKey, focusState)
}

// ============================================================================
// PopupMenu.
// ============================================================================

type PopupPluginOpenState = { open: true; index: number }
type PopupPluginState = { open: false } | PopupPluginOpenState

const popupMenuKey = new PluginKey<PopupPluginState>("popupMenu")

const PopupMenuStatePlugins: StatePlugin = (schema) => [
	new Plugin<PopupPluginState>({
		key: popupMenuKey,
		state: {
			init: () => ({ open: false }),
			apply: (tr, state) => {
				const action = tr.getMeta(popupMenuKey)
				if (action) return action
				return state
			},
		},
		appendTransaction(trs, oldState, newState) {
			if (newState.selection.empty && popupMenuKey.getState(newState)!.open) {
				const tr = newState.tr
				tr.setMeta(popupMenuKey, { open: false })
				setFocus(tr, null)
				return tr
			}
			return null
		},
	}),
]

const PopupMenuCommands: CommandPlugin = (schema) => [
	{
		name: "Toggle Popup Menu",
		shortcut: "Meta-/",
		command: (state, dispatch, view) => {
			const tr = state.tr

			if (state.selection.empty) return true

			const popupState = popupMenuKey.getState(state)!
			if (popupState.open) {
				tr.setMeta(popupMenuKey, { open: false })
				setFocus(tr, null)
			} else {
				tr.setMeta(popupMenuKey, { open: true, index: 0 })
				setFocus(tr, "popup")
			}

			if (dispatch) dispatch(tr)

			return true
		},
	},
]

const PopupMenuViewPlugins: ViewPlugin = (schema) => [
	new Plugin({
		props: {
			decorations: (state) => {
				const popupState = popupMenuKey.getState(state)!
				if (!popupState.open) return null
				const { selection } = state
				return DecorationSet.create(state.doc, [
					Decoration.inline(selection.from, selection.to, {
						nodeName: "span",
						style: "background:#222;color:white;",
					}),
				])
			},
		},
	}),
]

function PopupMenu(props: { state: EditorState; view: EditorView }) {
	const popupState = popupMenuKey.getState(props.state)!
	if (!popupState.open) return null

	return <PopupMenuOpen {...props} popupState={popupState} />
}

function PopupMenuOpen(props: {
	popupState: PopupPluginOpenState
	state: EditorState
	view: EditorView
}) {
	const { view, state, popupState } = props
	const [rect, setRect] = useState<{ left: number; bottom: number }>()

	useLayoutEffect(() => {
		setRect(view.coordsAtPos(state.selection.from))
	}, [state])

	if (!rect) return null

	const focused = focusKey.getState(state) === "popup"

	return (
		<div
			style={{
				position: "fixed",
				left: rect.left,
				top: rect.bottom + 4,
				background: "white",
				boxShadow: `rgba(15, 15, 15, 0.05) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 3px 6px, rgba(15, 15, 15, 0.2) 0px 9px 24px`,
				padding: 4,
				outline: focused ? "1px solid green" : undefined,
				outlineOffset: -1,
				borderRadius: 4,
			}}
		>
			Hello
		</div>
	)
}

// ============================================================================
// ColorSwatch.
// ============================================================================

const ColorSwatchSchema = createSchemaPlugin({
	nodes: {
		color: {
			group: "inline",
			inline: true,
			atom: true,
		},
		toDOM: ["span.color"],
		fromDOM: ["span.color"],
	},
})

const ColorSwatchCommands: CommandPlugin = (schema) => [
	{
		name: "Insert Color Swatch",
		shortcut: "Meta-e",
		command: (state, dispatch, view) => {
			const tr = state.tr
			const node = schema.nodes.color.create()
			const { from, to } = state.selection
			tr.replaceWith(from, to, node)
			if (dispatch) dispatch(tr)
			return true
		},
	},
]

type NodeViewPlugin = { [key: string]: NodeViewConstructor }

const ColorSwatchNodeViews: NodeViewPlugin = {
	color: (node, view, getPos) => {
		const div = document.createElement("div")
		div.style.display = "inline-block"
		div.style.height = "16px"
		div.style.width = "16px"
		div.style.border = "1px solid #999"
		div.style.borderRadius = "2px"
		div.style.backgroundColor = "red"

		return { dom: div }
	},
}

// TODO:
// - controlled focus.
//   - can we persist focus across refresh?
// - nodeView
// 	 - how can we plumb react context through?
// - syncing internal/external state
//   - how to "pass external props" to a node view
//     1. we can subscribe to some state somewhere.
//        this does not work when you're trying to update a plugin state based on external state.
//     2. we can denormalize that state into a plugin state.
//   - how to "pass external props" to a state plugin
//     1. we can re-construct the plugin and call state.reconfigure.
//     2. we can denormalize that state into some plugin state.
//     3. we can dispatch a transaction meta so the plugin updates its internal state.
//     Either way, we will be denormalizing for this to work.
//   - how to "pass external props" to a view plugin
//     1. For decorations, I'm not sure how to "reconfigure" the view...
//     2. For popups and stuff, it seems pretty easy to pass it "around"
//     3. Views can also just subscribe to some data somewhere.

// TODO: need to think through some more concrete examples.

// ============================================================================
// SimpleEditor.
// ============================================================================

const SimpleEditor: Editor = {
	schemaPlugins: [
		DocumentSchema,
		QuoteBlockSchema,
		ItalicSchema,
		ColorSwatchSchema,
	],
	statePlugins: [
		FocusStatePlugins,
		QuoteBlockStatePlugins,
		PopupMenuStatePlugins,
	],
	commandPlugins: [
		DocumentCommands,
		ItalicCommands,
		PopupMenuCommands,
		ColorSwatchCommands,
	],
	viewPlugins: [PopupMenuViewPlugins],
	nodeViewPlugins: [ColorSwatchNodeViews],
}
