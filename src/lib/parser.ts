import {
	type Token,
	type Parser,
	type Rule,
	apply,
	seq,
	alt,
	buildLexer,
	rule,
	tok,
	rep,
	type ParserOutput,
	unableToConsumeToken,
	expectEOF,
	opt_sc,
	rep_sc,
	list,
	str
} from "typescript-parsec"

import type {
	BinaryNode,
	ValueNode,
	MealItem,
	MealRecord,
	Node
} from "./types";

import { O } from "./"
import markdownit from "markdown-it";

enum TokenKind {
	Whole,
	Integer,
	Float,
	ServingVar,

	Plus,
	Minus,
	Star,
	Divide,

	LParen,
	RParen,
	LSqParen,
	RSqParen,

	String,
	Comma,
	Newline,
	Space,
	Filename,

	Colon,
}

const lexer = buildLexer([
	[true, /^\+/g, TokenKind.Plus],
	[true, /^\-/g, TokenKind.Minus],
	[true, /^\*/g, TokenKind.Star],
	[true, /^\//g, TokenKind.Divide],

	[true, /^(\d)+/g, TokenKind.Whole],
	[true, /^(\d)+/g, TokenKind.Integer],
	[true, /^(\d+(\.\d+)?)/g, TokenKind.Float],
	[true, /^s/g, TokenKind.ServingVar],


	[true, /^\(/g, TokenKind.LParen],
	[true, /^\)/g, TokenKind.RParen],
	[true, /^\{/g, TokenKind.LSqParen],
	[true, /^\}/g, TokenKind.RSqParen],

	[true, /^[A-z]+/g, TokenKind.String],
	[true, /^\:/g, TokenKind.Colon],
	[true, /^\,/g, TokenKind.Comma],
	[true, /^\n/g, TokenKind.Newline],
	[true, /^( |\t)+/g, TokenKind.Space],
])

type Span = [number, number];
type ParseNode<T, K> = {
	value: T,
	span: Span,
	kind: K
}

type ConsumePNode = ParseNode<string, "consumer"> // exists to clean up a line
type StringPNode = ParseNode<string, "string">
type WhitespacePNode = ParseNode<string, "whitespace">
type NumberPNode = ParseNode<number, "number">
type ServingPNode = ParseNode<"s", "serving">
type ReferencePNode = ParseNode<{ document: StringPNode, mealName: StringPNode, offset?: NumberPNode }, "reference">
type TagPNode = ParseNode<{ key: StringPNode, value?: StringPNode }, "tag">
type ValuePNode = ParseNode<NumberPNode | ServingPNode | ReferencePNode, "value">
type BinaryPNode = ParseNode<{
	left: BinaryPNode | ValuePNode,
	right: BinaryPNode | ValuePNode,
	op: ParseNode<"+" | "-" | "*" | "/", "+" | "-" | "*" | "/">
}, "binary">
type FormulaPNode = ParseNode<BinaryPNode | ValuePNode, "formula">
type ItemPNode = ParseNode<{
	quantity: NumberPNode;
	unit?: StringPNode;
	name: StringPNode;
	formula: FormulaPNode;
}, "item">
type MealPNode = ParseNode<{
	name: StringPNode,
	items: ItemPNode[]
}, "meal">

const Consumer = rule<TokenKind, ConsumePNode>();
const String = rule<TokenKind, StringPNode>();
const Whitespace = rule<TokenKind, WhitespacePNode>();
const Number = rule<TokenKind, NumberPNode>();
const Reference = rule<TokenKind, ReferencePNode>();
const Tag = rule<TokenKind, TagPNode>();
const Serving = rule<TokenKind, ServingPNode>();
const Terminal = rule<TokenKind, ValuePNode>();
const Div = rule<TokenKind, FormulaPNode>();
const Mult = rule<TokenKind, FormulaPNode>();
const Sub = rule<TokenKind, FormulaPNode>();
const Add = rule<TokenKind, FormulaPNode>();
const Unit = rule<TokenKind, StringPNode>();
const Item = rule<TokenKind, ItemPNode>();
const Meal = rule<TokenKind, MealPNode>();

function tokenSpan<T, P extends { span: Span }>(token: Token<T> | P): Span {
	if ("next" in token) {
		// `token` is a low-level token
		return [token.pos.index, token.pos.index + token.text.length]
	} else {
		// `token` is a parsed node
		return token.span
	}
}

// TODO this function should be able to handle tokens, nested tokens, and potentially nulled out tokens
function mergeSpans(spans: Span[]): Span {
	return spans.reduce((previous, current) => [
		previous[0] < current[0] ? previous[0] : current[0],
		previous[1] > current[1] ? previous[1] : current[1]
	])
}

Whitespace.setPattern(apply(
	seq(
		tok(TokenKind.Space),
		rep(tok(TokenKind.Space))
	),
	([head, tail]) => ({
		value: [head, ...tail.map(token => token.text)].join(''),
		span: mergeSpans([tokenSpan(head), ...tail.map(token => tokenSpan(token))]),
		kind: "whitespace"
	})
))

String.setPattern(apply(
	tok(TokenKind.String),
	token => ({
		value: token.text,
		span: tokenSpan(token),
		kind: "string"
	})
))

Number.setPattern(apply(
	seq(
		opt_sc(tok(TokenKind.Minus)),
		alt(
			tok(TokenKind.Float),
			tok(TokenKind.Whole),
			tok(TokenKind.Integer)
		),
	),
	tokens => ({
		value: (tokens[0] ? -1 : 1) * parseFloat(tokens[1].text),
		// if '-' is parsed, extend the number's span with '-''s span
		span: [tokens[0] ? tokenSpan(tokens[0])[0] : tokenSpan(tokens[1])[0], tokenSpan(tokens[1])[0]],
		kind: "number"
	})
))

Reference.setPattern(
	apply(
		seq(
			tok(TokenKind.LSqParen),
			String,
			tok(TokenKind.RSqParen),
			tok(TokenKind.LSqParen),
			String,
			tok(TokenKind.RSqParen),
			opt_sc(
				apply(
					seq(
						tok(TokenKind.LSqParen),
						tok(TokenKind.Whole),
						tok(TokenKind.RSqParen)
					),
					tokens => ({ value: parseInt(tokens[1].text), span: tokenSpan(tokens[1]) } as NumberPNode)
				)
			)
		),
		tokens => ({
			value: {
				document: tokens[1],
				mealName: tokens[4],
				offset: tokens[6]
			},
			span: mergeSpans(
				tokens.filter(token => token != undefined).map(token => tokenSpan(token))
			),
			kind: "reference"
		})
	)
)

Tag.setPattern(apply(
	seq(
		String,
		opt_sc(
			seq(
				tok(TokenKind.Colon),
				String
			)
		)
	),
	tokens => {
		return {
			kind: "tag",
			value: {
				key: tokens[0],
				value: tokens[1] ? tokens[1][1] : undefined
			},
			span: tokenSpan(tokens[0]) // TODO optionally expand span
		}
	}
))

Serving.setPattern(apply(
	tok(TokenKind.ServingVar),
	token => ({ value: "s", span: tokenSpan(token), kind: "serving" })
))

Terminal.setPattern(apply(
	alt(
		apply(Number, (token): NumberPNode & { kind: "number" } => ({ ...token, kind: "number" })),
		apply(Serving, (token): ServingPNode & { kind: "serving" } => ({ ...token, kind: "serving" })),
		apply(Reference, (token): ReferencePNode & { kind: "reference" } => ({ ...token, kind: "reference" }))
	),
	token => ({
		value: token,
		span: tokenSpan(token),
		kind: "value"
	})
))

function OperationParser(
	op: "+" | "-" | "*" | "/",
	kind: TokenKind.Divide | TokenKind.Star | TokenKind.Minus | TokenKind.Plus,
	subParser: Rule<TokenKind, FormulaPNode>

): Parser<TokenKind, FormulaPNode> {
	return apply(
		seq(
			subParser,
			opt_sc(
				seq(
					apply(
						tok(kind),
						token => ({ value: op, span: tokenSpan(token), kind: op } as ParseNode<typeof op, typeof op>)
					),
					subParser
				)
			)
		),

		(tokens): FormulaPNode => {
			if (tokens[1]) {
				return {
					kind: "formula",
					value: {
						kind: "binary",
						value: {
							left: tokens[0].value,
							right: tokens[1][1].value,
							op: tokens[1][0]
						},
						span: mergeSpans(
							[tokens[0], ...tokens[1]].filter(token => token != undefined).map(token => tokenSpan(token))
						)
					},
					span: mergeSpans(
						[tokens[0], ...tokens[1]].filter(token => token != undefined).map(token => tokenSpan(token))
					)
				}
			} else {
				return {
					value: tokens[0].value,
					span: tokens[0].span,
					kind: "formula"
				}
			}

		},
	)
}


Div.setPattern(
	apply(
		seq(
			Terminal,
			opt_sc(
				seq(
					apply(
						tok(TokenKind.Divide),
						token => ({ value: "/", span: tokenSpan(token) } as ParseNode<"/", "/">)
					),
					Terminal
				)
			)
		),
		(tokens): FormulaPNode => {
			if (tokens[1]) {
				return {
					kind: "formula",
					value: {
						kind: "binary",
						value: {
							left: tokens[0],
							right: tokens[1][1],
							op: tokens[1][0]
						},
						span: mergeSpans(
							[tokens[0], ...tokens[1]].filter(token => token != undefined).map(token => tokenSpan(token))
						)
					},
					span: mergeSpans(
						[tokens[0], ...tokens[1]].filter(token => token != undefined).map(token => tokenSpan(token))
					)
				}
			} else {
				return {
					kind: "formula",
					value: { ...tokens[0], kind: "value" },
					span: tokens[0].span
				}
			}

		}
	))

Mult.setPattern(OperationParser("*", TokenKind.Star, Div))
Sub.setPattern(OperationParser("-", TokenKind.Minus, Mult))
Add.setPattern(OperationParser("+", TokenKind.Plus, Sub))

type TrieRecord = undefined | { value: undefined | string, children: { [ch: string]: TrieRecord } };
class Trie {
	trie: TrieRecord
	constructor(units: string[]) {
		this.trie = { value: undefined, children: {} }
		units.forEach(u => this.insert(u))
	}

	insert(value: string) {
		function insertInternal(t: TrieRecord, finalValue: string, slice: string) {
			if (slice.length == 0) {
				if (t) {
					t.value = finalValue
				}
			} else {
				const ch = slice[0]!;
				if (t) {
					if (t.children[ch] === undefined) {
						t.children[ch] = { value: undefined, children: {} }
					}
					insertInternal(t.children[ch], finalValue, slice.slice(1))
				}
			}
		}

		insertInternal(this.trie, value, value);
	}

	findMatches(value: string): string[] {
		function findMatchesInternal(t: TrieRecord, slice: string): string[] {
			if (slice.length > 0) {
				const ch = slice[0]!;
				if (t!.children[ch]) {
					const current = t!.value ? [t!.value] : []
					const matches = findMatchesInternal(t!.children[ch], slice.slice(1));
					return [...matches, ...current]
				}
			} else {
				const current = t!.value ? [t!.value] : []
				return current
			}
			// I shouldn't have to return this.
			// This is a compiler bug.
			return []
		}

		return findMatchesInternal(this.trie, value)
	}
}

/**
* Parses units
*/
function unit(u: string[]): Parser<TokenKind, StringPNode> {

	const trie = new Trie(u);


	return {
		parse(token): ParserOutput<TokenKind, StringPNode> {
			if (token) {
				const matches = trie.findMatches(token.text)
				if (matches.length > 0) {
					return {
						candidates: [{
							firstToken: token,
							nextToken: token.next,
							result: { value: matches[0]!, span: tokenSpan(token), kind: "string" }
						}],
						successful: true,
						error: undefined
					}
				} else {
					return {
						successful: false,
						error: {
							kind: "Error",
							pos: token.pos,
							message: `${token.text} could not be matched to any of ${u}`
						}
					}
				}
			} else {
				return {
					successful: false,
					error: unableToConsumeToken(token)
				}
			}
		},
	}
}

// Unit's parser is set during runtime. Hopefully that works.


Item.setPattern(
	apply(
		seq(
			Number,
			opt_sc(Unit),
			apply(
				rep(alt(String, Number)),
				(tokens): StringPNode => tokens.reduce<StringPNode>((previous, current): StringPNode => {
					return {
						kind: "string",
						value: (previous.value.toString() + " " + current.value.toString()).trim(),
						span: [previous.span[0] == -1 ? current.span[0] : previous.span[0], current.span[1]]
					}
				}, { value: "", span: [-1, -1] } as StringPNode)
			),
			apply(
				seq(
					tok(TokenKind.LParen),
					Add,
					tok(TokenKind.RParen),
				),
				tokens => tokens[1]
			)
		),
		tokens => {
			return {
				kind: "item",
				value: {
					quantity: tokens[0],
					unit: tokens[1],
					name: tokens[2],
					formula: tokens[3]
				},
				span: mergeSpans(
					tokens.filter(t => t != undefined).map(
						t => tokenSpan(t)
					)
				)
			}
		}
	)
)

Meal.setPattern(
	apply(
		seq(
			apply(
				rep(alt(String, Number)),
				(tokens): StringPNode => tokens.reduce<StringPNode>((previous, current): StringPNode => {
					return {
						kind: "string",
						value: (previous.value.toString() + " " + current.value.toString()).trim(),
						span: [previous.span[0] == -1 ? current.span[0] : previous.span[0], current.span[1]]
					}
				}, { value: "", span: [-1, -1] } as StringPNode)
			),
			apply(
				rep(
					seq(
						tok(TokenKind.Newline),
						Item
					)
				),
				tokens => tokens.map(token => token[1])
			),

		),
		tokens => {
			return {
				kind: "meal",
				value: {
					name: tokens[0],
					items: tokens[1]
				},
				span: mergeSpans(
					[tokens[0], ...tokens[1]]
						.map(t => tokenSpan(t))
				)
			}
		}
	)
)

// const md = `Curd Rice\n0.75 cups Rice (s / 0.25 * 160)\n0.75 cups Greek Yogurt (s / 0.75 * 100)`
// const md = `Tea\n2 g sugar (s * 15)`

export function parseFormulaString(
	formula: string
): O.Result<Node> {
	const result = Add.parse(lexer.parse(formula))
	if (result.successful && result.candidates[0] && result.candidates[0].result) {
		return O.ok(ResolveFormulaP(result.candidates[0].result))
	} else {
		if (result.successful) {
			return O.err(new Error("Nothing was parsed."))
		} else {
			return O.err(new Error(`${formula}: ` + result.error.message))
		}
	}
}

export function parseJouleBlockToAst(units: string[], content: string): O.Result<MealPNode> {
	// we can only set this during runtime due to a dependence on `units`
	Unit.setPattern(apply(
		unit(units),
		token => token
	))

	// TODO remove these expects soon
	const result = expectEOF(Meal.parse(lexer.parse(content)))
	if (result.successful && result.candidates[0] && result.candidates[0].result) {
		return O.ok(result.candidates[0].result)
	} else {
		if (result.successful) {
			return O.err(new Error("Nothing was parsed."))
		} else {
			return O.err(new Error(result.error.message))
		}
	}
}

// BLOCK Conversion from ParseNode types to concrete types

function ResolveStringP(n: StringPNode): string {
	return n.value
}

function ResolveNumberP(n: NumberPNode): number {
	return n.value
}

function ResolveValueP(n: ValuePNode): ValueNode {
	switch (n.value.kind) {
		case "number":
			return { value: { value: ResolveNumberP(n.value), kind: "number" }, kind: "value" }
		case "serving":
			return { value: { kind: "serving" }, kind: "value" }
		case "reference":
			// ugly hack; token parsing doesn't pick up spaces.
			// now, I should really be debugging that problem.
			// But why do all that when I could just fetch the string from within the span? (kill me)
			return {
				value: {
					document: ResolveStringP(n.value.value.document),
					mealName: ResolveStringP(n.value.value.mealName),
					offset: n.value.value.offset ? ResolveNumberP(n.value.value.offset) : undefined,
					kind: "reference"
				},
				kind: "value"
			}
	}
}

function ResolveBinaryP(n: BinaryPNode | ValuePNode): BinaryNode | ValueNode {
	switch (n.kind) {
		case "binary":
			return {
				op: n.value.op.value,
				left: ResolveBinaryP(n.value.left),
				right: ResolveBinaryP(n.value.right),
				kind: "binary"
			}
		case "value":
			return ResolveValueP(n)
	}
}

function ResolveFormulaP(n: FormulaPNode): BinaryNode | ValueNode {
	switch (n.value.kind) {
		case "binary":
			return ResolveBinaryP(n.value)
		case "value":
			return ResolveValueP(n.value)
	}
}

function ResolveItemP(n: ItemPNode): MealItem {
	return {
		name: ResolveStringP(n.value.name),
		quantity: ResolveNumberP(n.value.quantity),
		formula: ResolveFormulaP(n.value.formula),
		unit: n.value.unit ? ResolveStringP(n.value.unit) : undefined
	}
}

function ResolveMealP(n: MealPNode): MealRecord {
	return {
		name: ResolveStringP(n.value.name),
		items: n.value.items.map(item => ResolveItemP(item))
	}
}

// END BLOCK

export function transformJouleAstToConcrete(tree: MealPNode): MealRecord {
	return ResolveMealP(tree)
}

export function parseJouleBlock(units: string[], content: string): O.Result<MealRecord> {
	if (content.length == 0) {
		// TODO better errors
		return O.err(new Error("No content to be parsed."))
	}
	const ast = parseJouleBlockToAst(units, content);
	return O.FlatMap(ast, ast => transformJouleAstToConcrete(ast))
}

/**
 * Parses joule blocks in a markdown page.
 * Potentially returns multiple `MealRecord`s in a page.
 */
export function parseJoule(
	content: string,
	units: string[],
): O.Result<MealRecord[]> {
	const md = markdownit();
	const tokens = md.parse(content, {});
	const codeBlocks = tokens.filter((token) => {
		return (token.type == "fence" && token.tag == "code" &&
			token.info == "joule");
	}).map((token) => token.content.trim());

	return codeBlocks
		.map((block) => parseJouleBlock(units, block))
		.reduce(
			(
				arrResult: O.Result<MealRecord[]>,
				blockResult,
			): O.Result<MealRecord[]> => {
				if (O.isErr(blockResult)) {
					return blockResult;
				} else if (O.isErr(arrResult)) {
					return arrResult;
				} else {
					return O.ok([...arrResult.value, blockResult.value]);
				}
			},
			O.ok([]),
		);
}
