// `vscode-regexpp` is only used by the ripgrep text search engine, which the extension host bundle
// pulls in but SideX does not drive from here. Fail loudly if anything ever reaches it.
const unsupported = () => {
	throw new Error('vscode-regexpp is not bundled in the SideX extension host');
};
export class RegExpParser {
	parsePattern() {
		return unsupported();
	}
}
export class RegExpVisitor {
	constructor() {
		unsupported();
	}
}
export const AST = {};
