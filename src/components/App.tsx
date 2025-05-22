import "prosemirror-view/style/prosemirror.css"
import { Link, Route, HashRouter as Router, Routes } from "react-router-dom"
import "../index.css"
import { Architecture } from "./Architecture"
import { Editor as Autocomplete } from "./Autocomplete"
import { Basic } from "./Basic"
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
					<div style={{ display: "inline-block", paddingRight: "1em" }}>
						<Link to="/architecture">Architecture</Link>
					</div>
					<div style={{ display: "inline-block", paddingRight: "1em" }}>
						<Link to="/basic">Basic</Link>
					</div>
				</div>

				<Routes>
					<Route path="/basic" element={<Basic />} />
					<Route path="/architecture" element={<Architecture />} />
					<Route path="/focus" element={<Focus />} />
					<Route path="/property" element={<Property />} />
					<Route path="/block-selection" element={<BlockSelection />} />
					<Route
						path="/block-selection-plugin"
						element={<BlockSelectionPlugin />}
					/>
					<Route path="/" element={<Autocomplete />} />
				</Routes>
			</div>
		</Router>
	)
}
