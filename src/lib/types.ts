/*
	This module contains basic types used throughout the code,
	and useful functions related to those types.
*/

export type ReferenceField = {
	document: string;
	mealName: string;
	offset?: number;
	kind: "reference"
};

export type ValueNode =
	{
		value: { value: number, kind: "number" } | { kind: "serving" } | ReferenceField;
		kind: "value"
	};

export type BinaryNode = {
	left: BinaryNode | ValueNode;
	right: BinaryNode | ValueNode;
	op: "+" | "-" | "*" | "/";
	kind: "binary"
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
	depends_on?: { filepath: string, name: string, offset: number }[]
};

/**
* recursively evaluates a parsed formula.
* params:
* node: The parsed node
* sVal: The value of 's' within the formula
*/
function evaluateFormula(node: Node, sVal: number): number {
	switch (node.kind) {
		case "binary":
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
		case "value":
			switch (node.value.kind) {
				case "serving":
					return sVal;
				case "number":
					return node.value.value
				case "reference":
					return 1
			}
	}
}

export function formulaString(node: Node, sVal: number): string {
	switch (node.kind) {
		case "binary":
			return formulaString(node.left, sVal) + ` ${node.op} ` +
				formulaString(node.right, sVal);
		case "value":
			switch (node.value.kind) {
				case "number":
					return node.value.value.toString();
				case "reference":
					return `[${node.value.document}][${node.value.mealName}]` + (node.value.offset) ? `[${node.value.offset}]` : "";
				case "serving":
					return sVal.toFixed(2);
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

export function getDependentsFromFormula(formulaNode: Node): ReferenceField[] {
	switch (formulaNode.kind) {
		case "value":
			if (formulaNode.value.kind == "reference") {
				return [formulaNode.value]
			} else {
				return []
			}
		case "binary":
			return [
				...getDependentsFromFormula(formulaNode.left),
				...getDependentsFromFormula(formulaNode.right)
			]
	}
}
