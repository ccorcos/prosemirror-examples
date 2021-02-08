/*

Autocomplete example.

Resources:
https://discuss.prosemirror.net/t/how-to-update-plugin-state-from-handlekeydown-props/3420
https://discuss.prosemirror.net/t/how-to-get-a-selection-rect/3430

*/

import ReactDOM from "react-dom"
import React, {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { MarkSpec, NodeSpec, Schema } from "prosemirror-model"
import {
	Plugin,
	PluginKey,
	EditorState,
	NodeSelection,
} from "prosemirror-state"
import { Decoration, DecorationSet, EditorView } from "prosemirror-view"
import { history, undo, redo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { toggleMark } from "prosemirror-commands"
import "./Autocomplete.css"
import { keyboardStack, useKeyboard } from "./Keyboard"

// ==================================================================
// Autocomplete Plugin
// ==================================================================

type AutocompleteTokenPluginState<T> =
	| { active: false }
	| AutocompleteTokenPluginActiveState<T>

type AutocompleteTokenPluginActiveState<T> = {
	active: true
	// The cursor selection where we get text from
	range: { from: number; to: number }
	// The text we use to search
	text: string
	// Where to position the popup
	rect: { bottom: number; left: number }
}

type AutocompleteTokenPluginAction =
	| { type: "open"; pos: number; rect: { bottom: number; left: number } }
	| { type: "close" }

function createAutocompleteTokenPlugin<N extends string, T>(args: {
	nodeName: N
	triggerCharacter: string
	renderToken: (span: HTMLSpanElement, nodeAttr: string) => void
	renderPopup: (
		state: AutocompleteTokenPluginState<T>,
		actions: {
			onCreate: (nodeAttr: string, range: { from: number; to: number }) => void
			onClose: () => void
		}
	) => void
}): { plugins: Plugin[]; nodes: { [key in N]: NodeSpec } } {
	const { nodeName, triggerCharacter, renderToken, renderPopup } = args
	const pluginKey = new PluginKey(nodeName)
	const dataAttr = `data-${nodeName}`

	const autocompleteTokenNode: NodeSpec = {
		group: "inline",
		inline: true,
		atom: true,
		attrs: { [nodeName]: { default: "" } },
		toDOM: (node) => {
			const span = document.createElement("span")
			const nodeAttr = node.attrs[nodeName]
			span.setAttribute(dataAttr, node.attrs[nodeName])
			renderToken(span, nodeAttr)
			return span
		},
		parseDOM: [
			{
				tag: `span[${dataAttr}]`,
				getAttrs: (dom) => {
					if (dom instanceof HTMLElement) {
						var value = dom.getAttribute(dataAttr)
						return { [nodeName]: value }
					}
				},
			},
		],
	}

	const autocompleteTokenPlugin = new Plugin<
		AutocompleteTokenPluginState<T>,
		Schema<any>
	>({
		key: pluginKey,
		state: {
			init() {
				return { active: false }
			},
			apply(tr, state) {
				const action: AutocompleteTokenPluginAction | undefined = tr.getMeta(
					pluginKey
				)
				if (action) {
					if (action.type === "open") {
						const { pos, rect } = action
						const newState: AutocompleteTokenPluginState<T> = {
							active: true,
							range: { from: pos, to: pos },
							text: "",
							rect: rect,
						}
						return newState
					} else if (action.type === "close") {
						return { active: false }
					}
				}

				// Update the range and compute query.
				if (state.active) {
					const { range } = state
					const from =
						range.from === range.to ? range.from : tr.mapping.map(range.from)
					const to = tr.mapping.map(range.to)

					const text = tr.doc.textBetween(from, to, "\n", "\0")
					if (!text.startsWith(triggerCharacter)) {
						// Close when deleting the #.
						return { active: false }
					}

					const queryText = text.slice(1) // Remove the leading "#"
					const newState: AutocompleteTokenPluginState<T> = {
						...state,
						range: { from, to },
						text: queryText,
					}
					return newState
				}

				return { active: false }
			},
		},
		props: {
			handleKeyDown(view, e) {
				const state = this.getState(view.state)

				const dispatch = (action: AutocompleteTokenPluginAction) => {
					view.dispatch(view.state.tr.setMeta(pluginKey, action))
				}

				// if key is #, check that the previous position is blank and the next position is blank.
				if (e.key === triggerCharacter) {
					const tr = view.state.tr
					var selection = tr.selection
					// Collapsed selection
					if (selection.from === selection.to) {
						const $position = selection.$from
						const isStart = $position.pos === $position.start()
						const isEnd = $position.pos === $position.end()
						const emptyPrev = Boolean(
							!isStart &&
								$position.doc
									.textBetween($position.pos - 1, $position.pos, "\n", "\0")
									.match(/\s/)
						)
						const emptyNext = Boolean(
							!isEnd &&
								$position.doc
									.textBetween($position.pos, $position.pos + 1, "\n", "\0")
									.match(/\s/)
						)

						if ((isStart || emptyPrev) && (isEnd || emptyNext)) {
							const pos = $position.pos
							const rect = view.coordsAtPos(pos)
							dispatch({ type: "open", pos, rect })

							// Don't override the actual input.
							return false
						}
					}
				}

				return false
			},
			decorations(editorState) {
				const state: AutocompleteTokenPluginState<T> = this.getState(
					editorState
				)
				if (!state.active) {
					return null
				}
				const { range } = state
				return DecorationSet.create(editorState.doc, [
					Decoration.inline(range.from, range.to, {
						nodeName: "span",
						style: "color:#999;",
					}),
				])
			},
		},
		view() {
			return {
				update(view) {
					var state: AutocompleteTokenPluginState<T> = pluginKey.getState(
						view.state
					)

					const onCreate = (
						value: string,
						range: { from: number; to: number }
					) => {
						const node = view.state.schema.nodes[nodeName].create({
							[nodeName]: value,
						})
						view.dispatch(view.state.tr.replaceWith(range.from, range.to, node))
					}

					const dispatch = (action: AutocompleteTokenPluginAction) => {
						view.dispatch(view.state.tr.setMeta(pluginKey, action))
					}
					const onClose = () => dispatch({ type: "close" })

					renderPopup(state, { onCreate, onClose })
				},
				destroy() {},
			}
		},
	})

	return {
		nodes: { [nodeName]: autocompleteTokenNode } as any,
		plugins: [
			autocompleteTokenPlugin,
			// Delete token when it is selected.
			keymap<Schema>({
				Backspace: (state, dispatch) => {
					const { node } = state.selection as NodeSelection
					if (node) {
						node.type === state.schema.nodes[nodeName]
						console.log(node)
						if (dispatch) {
							dispatch(state.tr.deleteSelection())
						}
						return true
					}
					return false
				},
			}),
		],
	}
}

// ==================================================================
// Mention Token Autocomplete
// ==================================================================

const mentionPopupElement = document.createElement("div")
document.body.append(mentionPopupElement)

const getSuggestions = (queryText: string) => {
	return [
		"Max Einhorn",
		"Sean O'Rielly",
		"Sam Corcos",
		"Haris Butt",
		"Simon Last",
	].filter((str) => str.toLowerCase().includes(queryText.toLowerCase()))
}

const mentionAutocomplete = createAutocompleteTokenPlugin({
	nodeName: "mention",
	triggerCharacter: "@",
	renderToken: (span, attr) => {
		ReactDOM.render(<MentionToken value={attr} />, span)
	},
	renderPopup: (state, actions) => {
		ReactDOM.render(
			<AutocompletePopup state={state} actions={actions} />,
			mentionPopupElement
		)
	},
})

function MentionToken(props: { value: string }) {
	return <span style={{ color: "blue" }}>@{props.value}</span>
}

function AutocompletePopup(props: {
	state: AutocompleteTokenPluginState<string>
	actions: {
		onCreate: (nodeAttr: string, range: { from: number; to: number }) => void
		onClose: () => void
	}
}) {
	if (!props.state.active) {
		return null
	}

	return <AutocompletePopupInner {...props.state} {...props.actions} />
}

function AutocompletePopupInner(
	props: AutocompleteTokenPluginActiveState<string> & {
		onCreate: (nodeAttr: string, range: { from: number; to: number }) => void
		onClose: () => void
	}
) {
	const { rect, text, onClose, range, onCreate } = props

	const misses = useRef(0)

	const suggestions = useMemo(() => {
		const list = getSuggestions(text)
		if (list.length === 0) {
			misses.current++
		} else {
			misses.current = 0
		}
		return list
	}, [text])

	const [index, setIndex] = useState(0)

	useKeyboard({
		ArrowUp: () => {
			setIndex(strangle(index - 1, [0, suggestions.length - 1]))
			return true
		},
		ArrowDown: () => {
			console.log("Down")
			setIndex(strangle(index + 1, [0, suggestions.length - 1]))
			return true
		},
		Enter: () => {
			if (index < suggestions.length) {
				onCreate(suggestions[index], range)
				onClose()
			}
			return true
		},
		Escape: () => {
			onClose()
			return true
		},
	})

	useEffect(() => {
		if (misses.current > 5) {
			onClose()
		}
	}, [misses.current > 5])

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				position: "fixed",
				top: rect.bottom + 4,
				left: rect.left,
				width: "20em",
				height: "10em",
				background: "white",
				borderRadius: 4,
				border: "1px solid black",
			}}
		>
			<div>Query: "{text}"</div>
			{suggestions.length === 0 && <div>No Results</div>}
			{suggestions.map((suggestion, i) => {
				return (
					<div key={i} style={{ background: i === index ? "#ddd" : undefined }}>
						<MentionToken value={suggestion} />
					</div>
				)
			})}
		</div>
	)
}

function strangle(n: number, minMax: [number, number]) {
	return Math.max(Math.min(n, minMax[1]), minMax[0])
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
	...mentionAutocomplete.nodes,
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
	content: [{ type: "text", text: "Type @ to create a mention." }],
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
				...mentionAutocomplete.plugins,
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
			handleKeyDown(view, event) {
				// Delegate to the global keyboard stack.
				if (keyboardStack.handleKeyDown(event)) {
					// Don't bubble up so we only handle this event once.
					event.stopPropagation()
					return true
				}
				return false
			},
		})

		window["editor"] = { view }
	}, [])
	return <div ref={ref}></div>
}
