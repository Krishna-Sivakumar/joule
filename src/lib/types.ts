/*
	This module contains basic types used throughout the code,
	and useful functions related to those types.
*/

import type { JouleTree } from "@libbindings/JouleTree";
import type { ParseNode } from "@libbindings/ParseNode";
import { R } from "./"
import { O } from "./"
import type { DesktopDB } from "@libdb";

export type Tag = {
	key: string,
	value: O.Option<String>
}

export type ReferenceField = {
	document: string;
	mealName: string;
	offset?: number;
	kind: "reference"
};

export type ValueNode =
	{
		value: { value: number, kind: "number" }
		| { kind: "serving" }
		| ReferenceField
		| { kind: "parens", child: Node };
		kind: "value"
	};

export type BinaryNode = {
	children: (BinaryNode | ValueNode)[]
	op: "+" | "-" | "*" | "/";
	kind: "binary"
};

export type Node = BinaryNode | ValueNode;

export class MealItem {
	quantity: Node;
	unit: string;
	name: ParseNode<string>;
	formula: Node;

	constructor(quantity: Node, unit: string, name: ParseNode<string>, formula: Node) {
		this.quantity = quantity;
		this.unit = unit;
		this.name = name;
		this.formula = formula;
	}

	/**
	* Evaluates quantity and returns the resultant number
	*/
	evaluateQuantity(): R.Result<number> {
		return evaluateQuantity(this.quantity)
	}

	/**
	* Evaluates the meal item and returns a resultant number representing the calorie value
	*/
	evaluate(context: Record<string, MealRecord>): R.Result<number> {
		return R.FlatMap(
			evaluateQuantity(this.quantity),
			quantity => evaluateFormula(this.formula, quantity, context)
		)
	}

	private evaluatedFormulaStringInternal(node: Node, sVal: number, context: Record<string, MealRecord>) {
		switch (node.kind) {
			case "binary":
				const children = node.children.map(child => evaluateFormula(child, sVal, context))
				return children.join(` ${node.op} `)
			case "value":
				switch (node.value.kind) {
					case "number":
						return node.value.value.toString();
					case "reference":
						return `[${node.value.document}][${node.value.mealName}]` + (node.value.offset) ? `[${node.value.offset}]` : "";
					case "parens":
						return `(${formulaString(node.value.child, sVal, context)})`
					case "serving":
						return sVal.toFixed(2);
				}
		}
	}

	/**
	* Returns a string of the formula with servings and other values substituted in
	*/
	evaluatedFormulaString(context: Record<string, MealRecord>): R.Result<string> {
		return R.FlatMap(
			evaluateQuantity(this.quantity),
			quantity => this.evaluatedFormulaStringInternal(this.formula, quantity, context)
		)
	}

	/**
	* Returns a string of the formula as it is
	*/
	formulaString(node: Node): string {
		switch (node.kind) {
			case "binary":
				return node.children.map(child => formulaToString(child)).join(` ${node.op} `)
			case "value":
				switch (node.value.kind) {
					case "number":
						return node.value.value.toString();
					case "serving":
						return "s"
					case "parens":
						return `(${formulaToString(node.value.child)})`
					case "reference":
						return `[${node.value.document}][${node.value.mealName}]` + (node.value.offset) ? `[${node.value.offset}]` : ""
				}
		}
	}

	getDependentsFromFormula(): ReferenceField[] {
		return getDependentsFromFormula(this.formula)
	}
};

export class MealRecord {
	name: string;
	items: MealItem[];
	tags: Array<Tag>;
	dependsOn: O.Option<Array<{ filepath: string, name: string, offset: number }>>;
	parseTree: JouleTree;

	constructor(name: string, items: MealItem[], parseTree: JouleTree, tags: Array<Tag>, depends_on?: { filepath: string, name: string, offset: number }[]) {
		this.name = name;
		this.items = items;
		this.dependsOn = O.Optionalize(depends_on);
		this.parseTree = parseTree;
		this.tags = tags;
		return this
	}

	/**
	* Evaluates the meal record and returns a resultant number representing the calorie value
	*/
	evaluate(context: Record<string, MealRecord>): R.Result<number> {
		return (this.items.map(item => item.evaluate(context))).reduce(
			(totalResult, itemValueResult) => R.Bind(itemValueResult, itemValue => R.FlatMap(totalResult, total => total + itemValue)),
			R.ok(0)
		)
	}

	getDependents(): ReferenceField[] {
		function getDeps(t: JouleTree): ReferenceField[] {
			switch (t.type) {
				case "reference":
					return [{
						"document": t.data.document,
						"mealName": t.data.meal_name,
						"offset": t.data.offset,
						"kind": "reference"
					} as ReferenceField]
				case "/":
				case "*":
				case "+":
				case "-":
					return t.data.flatMap(getDeps)
				case "parens":
					return getDeps(t.data)
				case "item":
					return getDeps(t.data.formula)
				case "meal":
					return t.data.items.data.flatMap(parseNode => getDeps(parseNode.data))
				default:
					return []
			}
		}

		return getDeps(this.parseTree)
	}
};

function evaluateQuantity(node: Node): R.Result<number> {
	switch (node.kind) {
		case "binary":
			const children = node.children.map(child => evaluateQuantity(child))
			if (children.length == 0) {
				return R.err(new Error(`operator ${node} has no children.`))
			}
			const [first, tail] = [children[0]!, children.slice(1)]
			switch (node.op) {
				case "/":
					return tail.reduce((previous, current) => {
						return R.Bind(previous, previousValue => {
							return R.FlatMap(current, currentValue => previousValue / currentValue)
						})
					}, first)
				case "*":
					return tail.reduce((previous, current) => {
						return R.Bind(previous, previousValue => {
							return R.FlatMap(current, currentValue => previousValue * currentValue)
						})
					}, first)
				case "-":
					return tail.reduce((previous, current) => {
						return R.Bind(previous, previousValue => {
							return R.FlatMap(current, currentValue => previousValue - currentValue)
						})
					}, first)
				case "+":
					return tail.reduce((previous, current) => {
						return R.Bind(previous, previousValue => {
							return R.FlatMap(current, currentValue => previousValue + currentValue)
						})
					}, first)
			}
		case "value":
			switch (node.value.kind) {
				case "serving":
				case "reference":
					return R.err(new Error(`${JSON.stringify(node)} is not a number.`))
				case "number":
					return R.ok(node.value.value)
				case "parens":
					return evaluateQuantity(node.value.child)
			}
	}
}

/**
* recursively evaluates a parsed formula.
* params:
* node: The parsed node
* sVal: The value of 's' within the formula
*/
function evaluateFormula(node: Node, sVal: number, context: Record<string, MealRecord>): number {
	switch (node.kind) {
		case "binary":
			const children = node.children.map(child => evaluateFormula(child, sVal, context))
			const [first, tail] = [children[0]!, children.slice(1)]
			switch (node.op) {
				case "/":
					return tail.reduce((previous, current) => (previous / current), first)
				case "*":
					return tail.reduce((previous, current) => (previous * current), first)
				case "-":
					return tail.reduce((previous, current) => (previous - current), first)
				case "+":
					return tail.reduce((previous, current) => (previous + current), first)
			}
		case "value":
			switch (node.value.kind) {
				case "serving":
					return sVal;
				case "number":
					return node.value.value
				case "parens":
					return evaluateFormula(node.value.child, sVal, context)
				case "reference":
					return R.UnwrapDefault(R.Bind(O.Resultize(O.Optionalize(
						context[assembleUniversalKey(node.value.mealName, node.value.document, node.value.offset || 0)]
					)), meal => meal.evaluate(context)), 1)
			}
	}
}

function formulaString(node: Node, sVal: number, context: Record<string, MealRecord>): string {
	switch (node.kind) {
		case "binary":
			const children = node.children.map(child => evaluateFormula(child, sVal, context))
			return children.join(` ${node.op} `)
		case "value":
			switch (node.value.kind) {
				case "number":
					return node.value.value.toString();
				case "reference":
					return `[${node.value.document}][${node.value.mealName}]` + (node.value.offset) ? `[${node.value.offset}]` : "";
				case "parens":
					return `(${formulaString(node.value.child, sVal, context)})`
				case "serving":
					return sVal.toFixed(2);
			}
	}
}

function getDependentsFromFormula(formulaNode: Node): ReferenceField[] {
	switch (formulaNode.kind) {
		case "value":
			if (formulaNode.value.kind == "reference") {
				return [formulaNode.value]
			} else {
				return []
			}
		case "binary":
			return formulaNode.children.flatMap(child => getDependentsFromFormula(child))
	}
}

export function formulaToString(formulaNode: Node): string {
	switch (formulaNode.kind) {
		case "binary":
			return formulaNode.children.map(child => formulaToString(child)).join(` ${formulaNode.op} `)
		case "value":
			switch (formulaNode.value.kind) {
				case "number":
					return formulaNode.value.value.toString();
				case "serving":
					return "s"
				case "parens":
					return `(${formulaToString(formulaNode.value.child)})`
				case "reference":
					return `[${formulaNode.value.document}][${formulaNode.value.mealName}]` + (formulaNode.value.offset) ? `[${formulaNode.value.offset}]` : ""
			}
	}
}

export function assembleUniversalKey(mealName: string, document: string, offset: number) {
	return `${document.split(".")[0]}-${mealName}-${offset}`
}

export function aggregatedOffsets(meals: MealRecord[]): Record<string, Array<MealRecord>> {
	let table: Record<string, MealRecord[]> = {}
	for (const meal of meals) {
		table[meal.name] = [...table[meal.name] || [], meal]
	}
	return table
}

/**
* `diffRecords` compares MealRecords in `left` (old records) vs the ones in `right` (incoming records).
* The comparison is done by matching computed universal keys.
* 
* Imagine a venn diagram with two circles intersecting;
* The intersection of records are updated, the right is created and the left is deleted.
*/
export function diffRecords(left: MealRecord[], right: MealRecord[], path: string): [Array<{ meal: MealRecord, offset: number }>, Array<{ meal: MealRecord, offset: number }>, Array<{ meal: MealRecord, offset: number }>] {
	let deleted: Array<{ meal: MealRecord, offset: number }> = []
	let created: Array<{ meal: MealRecord, offset: number }> = []
	let updated: Array<{ meal: MealRecord, offset: number }> = []

	const leftAggregatedMeals = aggregatedOffsets(left);
	const rightAggregatedMeals = aggregatedOffsets(right);

	// the following two object are a hashmap of universal keys to a <MealRecord, offset> pair
	const leftKeys = Object.values(leftAggregatedMeals)
		.flatMap(meals => {
			return meals.map((meal, offset) => [assembleUniversalKey(meal.name, path, offset), meal, offset] as [string, MealRecord, number])
		})
		.reduce((accumulator, [ukey, meal, offset]) => {
			accumulator[ukey] = { meal, offset }
			return accumulator
		}, {} as Record<string, { meal: MealRecord, offset: number }>)


	const rightKeys = Object.values(rightAggregatedMeals)
		.flatMap(meals => {
			return meals.map((meal, offset) => [assembleUniversalKey(meal.name, path, offset), meal, offset] as [string, MealRecord, number])
		})
		.reduce((accumulator, [ukey, meal, offset]) => {
			accumulator[ukey] = { meal, offset }
			return accumulator
		}, {} as Record<string, { meal: MealRecord, offset: number }>)


	// if there is a key in left ("old") that's not in right, that means it's been deleted
	for (const leftKey of Object.keys(leftKeys)) {
		if (!(leftKey in rightKeys)) {
			deleted.push(leftKeys[leftKey]!)
		}
	}

	for (const rightKey of Object.keys(rightKeys)) {
		if (rightKey in leftKeys) {
			// if there is a key in right ("incoming") that's in left, it's assumed to have been updated (but not necessarily)
			// TODO a deeper check can be done by match parse trees and checking if they have the same inorder traversal, but that might be too much computation
			// TODO but is it too much computation compared to calling IndexedDB multiple times?
			updated.push(rightKeys[rightKey]!)
		} else {
			// if there is a key in right ("incoming") that's not in left, that means it's been created
			created.push(rightKeys[rightKey]!)
		}
	}

	return [deleted, created, updated]
}
