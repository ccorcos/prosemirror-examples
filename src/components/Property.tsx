/*

Property example.

Resources:
https://prosemirror.net/examples/footnote/


TODO:
- arrow token, select but dont focus on inner editor yet.
- enter will focus the inner editor. escape will go to the outer editor.
- enter inside the inner editor will place the cursor after the token in the outer editor.
- clicking a token will focus inside, lets select all inside as well, when enter -- we almost always want to overwrite.

- don't edit on select - edit only after enter on select, exit goes back to select.


- Write lots of comments. Understand every line of code.
- Selection inside is saved and does not place correctly based on arrowkeys.
- Undo when deleting from the inside.

QA Doc: https://www.notion.so/ProseMirror-QA-65c6e1e971084547b6d6778c8e14bc6a

*/

import React, {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { MarkSpec, NodeSpec, NodeType, Schema } from "prosemirror-model"
import {
	EditorState,
	NodeSelection,
	Plugin,
	PluginKey,
	TextSelection,
} from "prosemirror-state"
import {
	Decoration,
	DecorationSet,
	EditorView,
	NodeView,
} from "prosemirror-view"
import { keymap } from "prosemirror-keymap"
import { StepMap } from "prosemirror-transform"
import { history, undo, redo } from "prosemirror-history"
import { toggleMark } from "prosemirror-commands"
import { css } from "glamor"
import ReactDOM from "react-dom"
import { keyboardStack, useKeyboard } from "./Keyboard"

const nbsp = "\xa0"

// ==================================================================
// Autocomplete Plugin
// ==================================================================

// https://github.com/DefinitelyTyped/DefinitelyTyped/pull/49646
type ProsemirrorNode<S extends Schema> = ReturnType<NodeType<S>["create"]>

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

type AutocompleteTokenPluginActions = {
	onCreate: (nodeAttr: string, range: { from: number; to: number }) => void
	onClose: () => void
}

type AutocompleteTokenPluginAction =
	| { type: "open"; pos: number; rect: { bottom: number; left: number } }
	| { type: "close" }

type Extension<N extends string> = {
	plugins: Plugin[]
	nodes: { [key in N]: NodeSpec }
	nodeViews: {
		[key in N]: (
			node: ProsemirrorNode<Schema>,
			view: EditorView<Schema>,
			getPos: (() => number) | boolean,
			decorations: Decoration[]
		) => NodeView<Schema>
	}
}

function createAutocompleteTokenPlugin<N extends string, T>(args: {
	nodeName: N
	triggerCharacter: string
	renderPopup: (
		state: AutocompleteTokenPluginState<T>,
		actions: AutocompleteTokenPluginActions
	) => void
}): Extension<N> {
	const { nodeName, triggerCharacter, renderPopup } = args
	const pluginKey = new PluginKey(nodeName)
	const dataAttr = `data-${nodeName}`

	const autocompleteTokenNode: NodeSpec = {
		group: "inline",
		content: "inline*",
		inline: true,
		atom: true,
		attrs: { [nodeName]: { default: "" } },
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
		// TODO: use NodeView instead.
		// toDOM: (node) => {
		// 	const span = document.createElement("span")
		// 	const nodeAttr = node.attrs[nodeName]
		// 	span.setAttribute(dataAttr, node.attrs[nodeName])
		// 	renderToken(span, nodeAttr)
		// 	return span
		// },
	}

	// This is an inline element with content.
	class TokenNodeView implements NodeView<Schema> {
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

			const property = node.attrs[nodeName]
			this.dom.setAttribute(dataAttr, property)

			this.dom.style.background = "#ddd"

			const label = document.createElement("span")
			label.innerText = "." + property + ":" + nbsp // non-breaking space; nbsp;
			this.dom.appendChild(label)

			const value = document.createElement("span")
			this.dom.appendChild(value)
			this.dom.appendChild(document.createTextNode(nbsp))

			// Create the inner document.
			this.innerView = new EditorView(value, {
				attributes: {
					style: [
						"display: inline",
						"outline: 0px solid transparent",
						"-webkit-font-smoothing: auto",
						"min-width:2em",
					].join(";"),
				},
				state: EditorState.create({
					doc: this.node,
					plugins: [
						keymap({
							"Mod-z": () =>
								undo(this.outerView.state, this.outerView.dispatch),
							"Mod-y": () =>
								redo(this.outerView.state, this.outerView.dispatch),
							"Mod-Shift-z": () =>
								redo(this.outerView.state, this.outerView.dispatch),
						}),
						new Plugin({
							props: {
								decorations(state) {
									let doc = state.doc
									if (doc.childCount === 0) {
										const span = document.createElement("span")
										span.innerText = "_"
										span.style.color = "#bbb"
										return DecorationSet.create(doc, [
											Decoration.widget(0, span),
										])
									}
								},
							},
						}),
					],
				}),
				handleKeyDown: (view, event) => {
					if (event.key === "Enter") {
						const { tr, doc, selection } = this.outerView.state
						this.outerView.dispatch(
							tr.setSelection(TextSelection.create(doc, selection.$head.pos))
						)
						this.outerView.focus()
						return true
					}
					return false
				},
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
			if (!node.sameMarkup(this.node)) {
				// Not sure when this happens.
				return false
			}
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

		handleKeyboard = (event: KeyboardEvent) => {
			// Focus on enter.
			if (this.outerView.hasFocus() && event.key === "Enter") {
				const {
					state: { tr, doc },
				} = this.innerView

				const selection = TextSelection.between(
					doc.resolve(0),
					doc.resolve(doc.content.size)
				)

				this.innerView.dispatch(tr.setSelection(selection))
				this.innerView.focus()
				return true
			}

			// Unfocus on escape
			if (
				this.innerView.hasFocus() &&
				event.key === "Escape" &&
				// If the value is empty, then don't allow blur so that when you type,
				// you don't overwrite.
				this.innerView.state.doc.childCount !== 0
			) {
				this.outerView.focus()
				return true
			}

			return false
		}

		selectNode() {
			this.dom.classList.add("ProseMirror-selectednode")

			// Another example of the gymnastics this keyboardStack helps with.
			keyboardStack.add(this.handleKeyboard)

			// Automatically focus if it's empty. This allows us to focus immediately
			// after creation and means that you cannot overwrite an empty property node.
			if (this.innerView.state.doc.childCount === 0) {
				this.innerView.focus()
			}
		}

		deselectNode() {
			this.dom.classList.remove("ProseMirror-selectednode")
			keyboardStack.remove(this.handleKeyboard)
		}

		destroy() {
			this.innerView.destroy()
			keyboardStack.remove(this.handleKeyboard)
		}

		stopEvent(e: Event) {
			if (e.type === "keydown") {
				const event = e as KeyboardEvent

				// Delete from the beginning will allow bubbling up to delete the node.
				// We'll also bring focus back to the outer editor so we can keep typing.
				const selection = this.innerView.state.selection
				if (
					selection.$anchor.pos === 0 &&
					selection.$head.pos === 0 &&
					event.key === "Backspace"
				) {
					console.log("Allow")
					this.outerView.focus()
					return false
				}
			}

			return this.innerView.dom.contains(e.target as HTMLElement)
		}

		ignoreMutation() {
			return true
		}
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

						const tr = view.state.tr.replaceWith(range.from, range.to, node)

						// Select the node to enter data inside.
						view.dispatch(
							tr.setSelection(NodeSelection.create(tr.doc, range.from))
						)
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

	const nodeView: Extension<N>["nodeViews"][N] = (
		node,
		view,
		getPos,
		decorations
	) => new TokenNodeView(node, view, getPos, decorations)

	const extension: Extension<N> = {
		nodes: { [nodeName]: autocompleteTokenNode } as Extension<N>["nodes"],
		nodeViews: {
			[nodeName]: nodeView,
		} as Extension<N>["nodeViews"],
		plugins: [
			autocompleteTokenPlugin,
			// Delete token when it is selected (and allowed to bubble up from stopEvent).
			keymap<Schema>({
				Backspace: (state, dispatch) => {
					const { node } = state.selection as NodeSelection
					if (node) {
						node.type === state.schema.nodes[nodeName]
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

	return extension
}

// ==================================================================
// Property Token Autocomplete
// ==================================================================

const propertyPopupElement = document.createElement("div")
document.body.append(propertyPopupElement)

const getSuggestions = (queryText: string) => {
	return ["Phone Number", "Email"].filter((str) =>
		str.toLowerCase().includes(queryText.toLowerCase())
	)
}

css.global("[data-property].ProseMirror-selectednode", {
	outline: "1px solid blue",
})

const propertyAutocomplete = createAutocompleteTokenPlugin({
	nodeName: "property",
	triggerCharacter: ".",
	renderPopup: (state, actions) => {
		ReactDOM.render(
			<AutocompletePopup state={state} actions={actions} />,
			propertyPopupElement
		)
	},
})

function AutocompletePopup(props: {
	state: AutocompleteTokenPluginState<string>
	actions: AutocompleteTokenPluginActions
}) {
	if (!props.state.active) {
		return null
	}

	return <AutocompletePopupInner {...props.state} {...props.actions} />
}

function AutocompletePopupInner(
	props: AutocompleteTokenPluginActiveState<string> &
		AutocompleteTokenPluginActions
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
						<span>
							.{suggestion}:{nbsp}{" "}
						</span>
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
	...propertyAutocomplete.nodes,
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
	content: [{ type: "text", text: "Type . to create a property-value." }],
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
				keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
				keymap({ "Mod-b": toggleMark(schema.marks.bold) }),
				...propertyAutocomplete.plugins,
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
				...propertyAutocomplete.nodeViews,
			},
		})

		window["editor"] = { view }
	}, [])
	return <div ref={ref}></div>
}
