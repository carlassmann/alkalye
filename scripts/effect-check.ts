import ts from "typescript"

export function checkEffects() {
	let configuration = ts.readConfigFile("tsconfig.json", ts.sys.readFile)
	let parsed = ts.parseJsonConfigFileContent(
		configuration.config,
		ts.sys,
		process.cwd(),
	)
	let program = ts.createProgram(parsed.fileNames, parsed.options)
	let checker = program.getTypeChecker()
	let failures: string[] = []
	for (let source of program.getSourceFiles()) {
		if (source.isDeclarationFile || source.fileName.includes("node_modules"))
			continue
		inspect(source)
	}
	function inspect(source: ts.SourceFile) {
		let production =
			source.fileName.includes("/src/") || source.fileName.endsWith("/cli.ts")
		let cryptoAdapter =
			source.fileName.endsWith("/platform/cipher.ts") ||
			source.fileName.endsWith("/platform/web-crypto.ts") ||
			source.fileName.endsWith("/platform/signatures.ts")
		let cryptoReported = false
		ts.forEachChild(source, visit)
		function visit(node: ts.Node) {
			if (
				production &&
				!cryptoAdapter &&
				!cryptoReported &&
				((ts.isIdentifier(node) && node.text === "crypto") ||
					ts.isElementAccessExpression(node))
			) {
				let type = checker.getTypeAtLocation(node)
				if (
					checker.getPropertyOfType(type, "subtle") &&
					checker.getPropertyOfType(type, "getRandomValues")
				) {
					failures.push(
						`${source.fileName}: use the captured Effect Crypto or Cipher service`,
					)
					cryptoReported = true
				}
			}
			if (
				ts.isExpressionStatement(node) &&
				ts.isBinaryExpression(node.expression) &&
				node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
			) {
				ts.forEachChild(node, visit)
				return
			}
			let expression = ts.isExpressionStatement(node)
				? node.expression
				: ts.isAwaitExpression(node) || ts.isVoidExpression(node)
					? node.expression
					: undefined
			if (
				expression &&
				!ts.isYieldExpression(expression) &&
				isEffect(checker.getTypeAtLocation(expression))
			) {
				let position = source.getLineAndCharacterOfPosition(
					node.getStart(source),
				)
				failures.push(
					`${source.fileName}:${position.line + 1}: execute Effects with yield*, a scoped runner or an explicit runtime boundary`,
				)
			}
			ts.forEachChild(node, visit)
		}
	}
	if (failures.length) throw new Error(failures.join("\n"))
	function isEffect(type: ts.Type): boolean {
		return type.isUnion()
			? type.types.some(isEffect)
			: Boolean(checker.getPropertyOfType(type, "~effect/Effect"))
	}
}
