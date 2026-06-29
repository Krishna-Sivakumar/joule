//@ts-types="@types/markdown-it"
import markdownit from "markdown-it";

import {
	choice,
	many,
	many1,
	map,
	optional,
	sequence,
} from "@nrsk/sigma/combinators";
import {
	defer,
	eol,
	float,
	integer,
	type Parser,
	regexp,
	run,
	string,
	whitespace,
} from "@nrsk/sigma/parsers";

import { O } from "./lib";

// ---

export type Reference = {
	document: string;
	mealName: string;
	offset: number;
};

export type ValueNode = {
	value: number | "s" | Reference;
};

export type BinaryNode = {
	left: BinaryNode | ValueNode;
	right: BinaryNode | ValueNode;
	op: "+" | "-" | "*" | "/";
};

export type Node = BinaryNode | ValueNode;

export type MealItem = {
	quantity: number;
	unit?: string;
	name: string;
	formula: Node;
};

export type MealRecord = {
	name: string;
	items: MealItem[];
};

// ---

/**
 * Parses content within a joule block into a MealRecord, potentially.
 * Throws an error if parses don't go through.
 */
export function parseJouleBlock(
	content: string,
	units: string[],
): O.Result<MealRecord> {
	const Formula = defer<Node>();

	const StringTerm = regexp(
		/(\w| |\d)+/,
		"Expected an alphanumeric string with spaces.",
	);

	const Reference: Parser<Reference> = map(
		sequence(
			sequence(
				string("["),
				// parse a filename here; would probably contain periods, so come up with some other parser
				StringTerm,
				string("]"),
			),
			sequence(
				string("["),
				// parse meal name; same as a string term
				StringTerm,
				string("]"),
			),
			optional(sequence(
				string("["),
				// parse array index; must be non-negative though. Throw an error regarding this.
				integer(),
				string("]"),
			)),
		),
		(fields) => ({
			document: fields[0][1],
			mealName: fields[1][1],
			offset: fields[2] ? fields[2][1] : 0,
		}),
	);

	const Terminal = map(
		choice(
			float(),
			integer(),
			string("s"),
			Reference,
			map(
				sequence(string("("), Formula, string(")")),
				(fields) => fields[1],
			),
		),
		(field) => {
			if (
				field == "s" || typeof field == "number" ||
				(typeof field != "string" && "document" in field)
			) {
				return { value: field } satisfies ValueNode;
			} else if (typeof field == "object") {
				return field;
			}
			throw Error("unreachable");
		},
	);

	// converts a parsed binary expression to a BinaryNode
	function mapToBinary(
		fields: [
			Node,
			[("+" | "-" | "*" | "/"), Node][],
		],
	): Node {
		const left = fields[0];
		// the expression tree is built from the bottom up
		const right = fields[1].reduceRight((prev: BinaryNode | null, curr) => {
			if (prev == null) {
				// the default case is to populate the right node and leave the left empty
				return {
					left: { value: 0 },
					right: curr[1],
					op: curr[0],
				} satisfies BinaryNode;
			} else {
				// populate the left node if it is empty
				prev.left = curr[1];
				return {
					left: { value: 0 },
					right: prev,
					op: curr[0],
				} satisfies BinaryNode;
			}
		}, null);

		if (right != null) {
			// if the parsed right node is empty, only return the left.
			right.left = left;
			return right;
		} else {
			// else, join it with the right node.
			return left;
		}
	}

	// parses items of `subParser` separated by `operation` and whitespaces.
	const OperationParser = (
		operation: "+" | "-" | "*" | "/",
		subParser: Parser<Node>,
	) => {
		return map(
			sequence(
				subParser,
				many(
					map(
						sequence(
							optional(whitespace()),
							string(operation),
							optional(whitespace()),
							subParser,
						),
						(fields) => {
							return [fields[1], fields[3]] as [
								typeof operation,
								Node,
							];
						},
					),
				),
			),
			mapToBinary,
		);
	};

	const Div = OperationParser("/", Terminal);
	const Mult = OperationParser("*", Div);
	const Sub = OperationParser("-", Mult);
	const Add = OperationParser("+", Sub);

	Formula.with(Add);

	const Unit = choice(
		// units are sorted so that larger unit names are matched before smaller ones
		...units.sort((a, b) => {
			if (a.length > b.length) return -1;
			else if (a.length < b.length) return 1;
			else return 0;
		}).map((unit) => map(string(unit), (item) => item.trim())),
	); // as Parser<string>; // I'm apalled that I have to do this. Why doesn't unwrapping work? what the fuck...

	function nullToUndefined<T>(val: T | null): T | undefined {
		if (val == null) {
			return undefined;
		} else {
			return val;
		}
	}

	const Item = map(
		sequence(
			// parses quantity
			map(
				sequence(
					optional(whitespace()),
					choice(float(), integer()),
					optional(whitespace()),
				),
				(fields) => fields[1],
			),
			// optionally parses unit
			map(
				sequence(
					optional(whitespace()),
					map(
						optional(Unit),
						nullToUndefined,
					),
					optional(whitespace()),
				),
				(fields) => fields[1],
			),
			// parses the name
			map(
				sequence(
					optional(whitespace()),
					StringTerm,
					optional(whitespace()),
				),
				(fields) => fields[1].trim(),
			),
			// parses the caloric value formula
			map(
				sequence(
					string("("),
					optional(whitespace()),
					Formula,
					optional(whitespace()),
					string(")"),
				),
				(fields) => fields[2],
			),
		),
		(fields) => {
			return {
				quantity: fields[0],
				unit: fields[1],
				name: fields[2],
				formula: fields[3],
			} satisfies MealItem;
		},
	);

	const Meal = map(
		sequence(
			optional(whitespace()),
			// parses meal name
			StringTerm,
			// parses collection of items
			many(map(sequence(many1(eol()), Item), (fields) => fields[1])),
			// ignore anything after this
			optional(whitespace()),
		),
		(fields) => {
			return {
				name: fields[1].trim(),
				items: fields[2],
			} satisfies MealRecord;
		},
	);

	// proxy parse term to make modifying the parser easier
	const Final = Meal;

	const result = run(Final).with(content);

	// check if the entire string has been successfully
	if (result.isOk && result.span[1] == content.length) {
		return O.ok(result.value);
	} else {
		return O.err(new Error(JSON.stringify(result)));
	}
}

// ---

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
		.map((block) => parseJouleBlock(block, units))
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

// recursively evaluates a parsed formula.
// params:
// node: The parsed node
// sVal: The value of 's' within the formula
function evaluateFormula(node: Node, sVal: number): number {
	if ("op" in node) {
		switch (node.op) {
			case "/":
				return evaluateFormula(node.left, sVal) /
					evaluateFormula(node.right, sVal);
			case "*":
				return evaluateFormula(node.left, sVal) *
					evaluateFormula(node.right, sVal);
			case "-":
				return evaluateFormula(node.left, sVal) -
					evaluateFormula(node.right, sVal);
			case "+":
				return evaluateFormula(node.left, sVal) +
					evaluateFormula(node.right, sVal);
		}
	} else {
		if (node.value == "s") {
			return sVal;
		} else if (typeof node.value == "number") {
			return node.value;
		} else {
			// TODO stub
			return 1;
		}
	}
}

export function formulaString(node: Node, sVal: number): string {
	if ("op" in node) {
		return formulaString(node.left, sVal) + ` ${node.op} ` +
			formulaString(node.right, sVal);
	} else {
		if (node.value == "s") {
			return sVal.toFixed(2);
		} else {
			return node.value.toString();
		}
	}
}

export function evaluateMealItem(item: MealItem): number {
	return evaluateFormula(item.formula, item.quantity);
}

export function evaluateMealRecord(meal: MealRecord): number {
	return meal.items.map((item) => evaluateMealItem(item)).reduce(
		(prev, current) => prev + current,
		0,
	);
}
