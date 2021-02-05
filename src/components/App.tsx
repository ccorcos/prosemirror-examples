import * as React from "react"
import { HashRouter as Router, Switch, Route, Link } from "react-router-dom"
import { Editor as Autocomplete } from "./Autocomplete"
import { Focus } from "./Focus"
import { Editor as Pill } from "./Pill"

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
						<Link to="/pill">Pill</Link>
					</div>
					<div style={{ display: "inline-block", paddingRight: "1em" }}>
						<Link to="/focus">Focus</Link>
					</div>
				</div>

				<Switch>
					<Route path="/focus">
						<Focus />
					</Route>
					<Route path="/pill">
						<Pill />
					</Route>
					<Route path="/">
						<Autocomplete />
					</Route>
				</Switch>
			</div>
		</Router>
	)
}
