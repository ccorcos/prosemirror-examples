import * as React from "react"
import { HashRouter as Router, Switch, Route, Link } from "react-router-dom"

export function App() {
	return (
		<Router>
			<div>
				<div style={{ display: "inline-block", padding: "2px 4px" }}>
					<Link to="/">Autocomplete</Link>
				</div>
				<div style={{ display: "inline-block", padding: "2px 4px" }}>
					<Link to="/pill">Pill</Link>
				</div>

				<Switch>
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

function Pill() {
	return <div>pill</div>
}

function Autocomplete() {
	return <div>autocomplete</div>
}
