import "prosemirror-view/style/prosemirror.css"
import * as React from "react"
import { HashRouter as Router, Link, Route, Switch } from "react-router-dom"
import "../index.css"
import { Editor as Autocomplete } from "./Autocomplete"
import { BlockSelection } from "./BlockSelection"
import { BlockSelectionPlugin } from "./BlockSelectionPlugin"
import { Focus } from "./Focus"
import { Editor as Property } from "./Property"

export function App() {
	return (
		<Router>
			<div>
				<div style={{ padding: "2em 2em 0.5em 2em" }}>
					<div style={{ display: "inline-block", paddingRight: "1em" }}>
						Examples:
					</div>
					<div style={{ display: "inline-block", paddingRight: "1em" }}>
						<Link to="/">Autocomplete</Link>
					</div>
					<div style={{ display: "inline-block", paddingRight: "1em" }}>
						<Link to="/property">Property</Link>
					</div>
					<div style={{ display: "inline-block", paddingRight: "1em" }}>
						<Link to="/focus">Focus</Link>
					</div>
					<div style={{ display: "inline-block", paddingRight: "1em" }}>
						<Link to="/block-selection">Block Selection</Link>
					</div>
					<div style={{ display: "inline-block", paddingRight: "1em" }}>
						<Link to="/block-selection-plugin">Block Selection Plugin</Link>
					</div>
				</div>

				<Switch>
					<Route path="/focus">
						<Focus />
					</Route>
					<Route path="/property">
						<Property />
					</Route>
					<Route path="/block-selection">
						<BlockSelection />
					</Route>
					<Route path="/block-selection-plugin">
						<BlockSelectionPlugin />
					</Route>
					<Route path="/">
						<Autocomplete />
					</Route>
				</Switch>
			</div>
		</Router>
	)
}
