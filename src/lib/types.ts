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
					// TODO fetch data here
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

export function formulaToString(formulaNode: Node): string {
	switch (formulaNode.kind) {
		case "binary":
			return `${formulaToString(formulaNode.left)} ${formulaNode.op} ${formulaToString(formulaNode.right)}`
		case "value":
			switch (formulaNode.value.kind) {
				case "number":
					return formulaNode.value.value.toString();
				case "serving":
					return "s"
				case "reference":
					return `[${formulaNode.value.document}][${formulaNode.value.mealName}]` + (formulaNode.value.offset) ? `[${formulaNode.value.offset}]` : ""
			}
	}
}

export function assembleUniversalKey(mealName: string, document: string, offset: number) {
	return `${document.split(".")[0]}-${mealName}-${offset}`
}

export function diffRecords(left: MealRecord[], right: MealRecord[]): [["left" | "right", string, number][], ["left" | "right", string, number][], ["left" | "right", string, number][]] {
	const leftKeys: ["left" | "right", string, number][] = left.map((meal, offset) => ["left", meal.name, offset])
	const rightKeys: typeof leftKeys = right.map((meal, offset) => ["right", meal.name, offset])

	let deleted: typeof leftKeys = []
	let created: typeof leftKeys = []
	let updated: typeof leftKeys = []

	// if something is absent from the left (i.e. the original set), then it has been removed
	for (const leftKey of leftKeys) {
		if (!rightKeys.some((val) => {
			return val[1] == leftKey[1] && val[2] == leftKey[2]
		})) {
			deleted.push(leftKey)
		}
	}

	// if something is absent from the right (i.e. the incoming change), then it has been created
	for (const rightKey of rightKeys) {
		if (!leftKeys.some((val) => {
			return val[1] == rightKey[1] && val[2] == rightKey[2]
		})) {
			created.push(rightKey)
		} else {
			// replace the contents of intersections with the incoming change
			updated.push(rightKey)
		}
	}

	return [deleted, created, updated]
}
