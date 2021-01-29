/*

Autocomplete example.

Resources:
https://discuss.prosemirror.net/t/how-to-update-plugin-state-from-handlekeydown-props/3420
https://discuss.prosemirror.net/t/how-to-get-a-selection-rect/3430

*/

import ReactDOM from "react-dom"
import React, { useLayoutEffect, useRef } from "react"
import { MarkSpec, NodeSpec, NodeType, Schema } from "prosemirror-model"
import { Plugin, PluginKey, EditorState } from "prosemirror-state"
import { Decoration, DecorationSet, EditorView } from "prosemirror-view"
import { history, undo, redo } from "prosemirror-history"
import { keymap } from "prosemirror-keymap"
import { toggleMark } from "prosemirror-commands"
import "./Autocomplete.css"

// ==================================================================
// Autocomplete Plugin
// ==================================================================

type AutocompleteTokenPluginState =
	| { active: false }
	| {
			active: true
			// The cursor selection where we get text from
			range: { from: number; to: number }
			// The text we use to search
			queryText: string
			// The search results
			suggestions: Array<string>
			// Which result is selected
			index: number
			// Where to position the popup
			rect: { bottom: number; left: number }
			// How times we got no suggestions, close menu after 5.
			misses: number
	  }

type AutocompleteTokenPluginAction =
	| { type: "open"; pos: number; rect: { bottom: number; left: number } }
	| { type: "down" }
	| { type: "up" }
	| { type: "close" }

function createAutocompletePlugin<T extends string>(args: {
	tokenName: T
	triggerChar: string
	tokenStyle: Partial<HTMLElement["style"]>
	getSuggestions: (queryText: string) => Array<string>
	renderPopup: (state: AutocompleteTokenPluginState) => void
	wrapNode?: (schema: Schema<any>) => NodeType<Schema<any>>
}): { plugin: Plugin; nodes: { [key in T]: NodeSpec } } {
	const {
		tokenName,
		triggerChar,
		tokenStyle,
		getSuggestions,
		renderPopup,
	} = args
	const pluginKey = new PluginKey(tokenName)
	const dataAttr = `data-${tokenName}`

	// Get the style attribute text for the token.
	const span = document.createElement("span")
	for (const key in tokenStyle) {
		span.style[key] = tokenStyle[key] as any
	}
	const tokenStyleText = span.getAttribute("style") || ""

	const autocompleteTokenNode: NodeSpec = {
		group: "inline",
		inline: true,
		atom: true,
		attrs: { [tokenName]: { default: "" } },
		toDOM: (node) => {
			const span = document.createElement("span")
			span.setAttribute(dataAttr, node.attrs[tokenName])
			for (const key in tokenStyle) {
				span.style[key] = tokenStyle[key] as any
			}
			span.innerText = triggerChar + node.attrs[tokenName]
			return span
		},
		parseDOM: [
			{
				tag: `span[${dataAttr}]`,
				getAttrs: (dom) => {
					if (dom instanceof HTMLElement) {
						var value = dom.getAttribute(dataAttr)
						return { [tokenName]: value }
					}
				},
			},
		],
	}

	const autocompleteTokenPlugin = new Plugin<
		AutocompleteTokenPluginState,
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
						const newState: AutocompleteTokenPluginState = {
							active: true,
							range: { from: pos, to: pos },
							queryText: "",
							index: 0,
							suggestions: [],
							rect: rect,
							misses: 0,
						}
						return newState
					} else if (state.active && action.type === "down") {
						return {
							...state,
							index: Math.min(state.index + 1, state.suggestions.length - 1),
						}
					} else if (state.active && action.type === "up") {
						return {
							...state,
							index: Math.max(state.index - 1, 0),
						}
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
					if (!text.startsWith(triggerChar)) {
						// Close when deleting the #.
						return { active: false }
					}

					const queryText = text.slice(1) // Remove the leading "#"
					const suggestions = getSuggestions(queryText)
					const newState: AutocompleteTokenPluginState = {
						...state,
						range: { from, to },
						queryText,
						suggestions,
						misses: suggestions.length === 0 ? state.misses + 1 : state.misses,
					}
					return newState
				}

				return { active: false }
			},
		},
		props: {
			handleKeyDown(view, e) {
				var state = this.getState(view.state)

				const dispatch = (action: AutocompleteTokenPluginAction) => {
					view.dispatch(view.state.tr.setMeta(pluginKey, action))
				}

				// if key is #, check that the previous position is blank and the next position is blank.
				if (e.key === triggerChar) {
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

				if (!state.active) {
					return false
				}

				if (e.key === "ArrowDown") {
					dispatch({ type: "down" })
					return true
				}

				if (e.key === "ArrowUp") {
					dispatch({ type: "up" })
					return true
				}

				if (e.key === "Escape") {
					dispatch({ type: "close" })
					return true
				}

				if (e.key === "Enter") {
					if (state.index >= state.suggestions.length) {
						dispatch({ type: "close" })
						return true
					}

					const value = state.suggestions[state.index]

					// Where is the best place to put this code? Feels like a side-effect.
					const node = view.state.schema.nodes[tokenName].create({
						[tokenName]: value,
					})

					console.log("node", node)
					const tr = view.state.tr.replaceWith(
						state.range.from,
						state.range.to,
						node
					)
					console.log("tr", tr)
					const newState = view.state.apply(tr)
					view.updateState(newState)

					dispatch({ type: "close" })
					return true
				}

				return false
			},
			decorations(editorState) {
				const state: AutocompleteTokenPluginState = this.getState(editorState)
				if (!state.active) {
					return null
				}
				const { range } = state
				return DecorationSet.create(editorState.doc, [
					Decoration.inline(range.from, range.to, {
						nodeName: "span",
						style: tokenStyleText,
					}),
				])
			},
		},
		view() {
			return {
				update(view) {
					var state: AutocompleteTokenPluginState = pluginKey.getState(
						view.state
					)
					renderPopup(state)
				},
				destroy() {},
			}
		},
	})

	return {
		nodes: { [tokenName]: autocompleteTokenNode } as any,
		plugin: autocompleteTokenPlugin,
	}
}

// ==================================================================
// Mention Token Autocomplete
// ==================================================================

const mentionPopupElement = document.createElement("div")
document.body.append(mentionPopupElement)

const mentionAutocomplete = createAutocompletePlugin({
	tokenName: "mention",
	triggerChar: "@",
	tokenStyle: { color: "green" },
	getSuggestions: (queryText: string) => {
		return [
			"Max Einhorn",
			"Sean O'Rielly",
			"Sam Corcos",
			"Haris Butt",
			"Simon Last",
		].filter((str) => str.toLowerCase().includes(queryText.toLowerCase()))
	},
	renderPopup: (state) => {
		ReactDOM.render(<AutocompletePopup {...state} />, mentionPopupElement)
	},
})

function AutocompletePopup(props: AutocompleteTokenPluginState) {
	if (!props.active) {
		return null
	}
	const { suggestions, index, rect, queryText } = props
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
			<div>Query: "{queryText}"</div>
			{suggestions.length === 0 && <div>No Results</div>}
			{suggestions.map((suggestion, i) => {
				return (
					<div key={i} style={{ color: i === index ? "red" : undefined }}>
						@{suggestion}
					</div>
				)
			})}
		</div>
	)
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
				mentionAutocomplete.plugin,
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

		window["editor"] = { view }
	}, [])
	return <div ref={ref}></div>
}