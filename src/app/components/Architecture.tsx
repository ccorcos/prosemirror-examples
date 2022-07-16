import { MarkSpec, NodeSpec, Schema } from "prosemirror-model"
import React from "react"

export function Architecture() {
	return <div>Hello</div>
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

const schema = createSchema([DocumentSchema, QuoteBlockSchema, ItalicSchema])
