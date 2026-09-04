import { type JouleTree } from "@libbindings/JouleTree";
import { R, O } from "../lib";
import { MealRecord, type BinaryNode, MealItem, type Node, type ValueNode, type Tag } from "@libtypes";

function ResolveNumberP(t: JouleTree): R.Result<number> {
	if (t.type == "integer" || t.type == "float") {
		return R.ok(t.data)
	} else {
		return R.err(new Error(`${t} is not a number`))
	}
}

function ResolveValueP(t: JouleTree): R.Result<ValueNode> {
	switch (t.type) {
		case "integer":
		case "float":
			return R.FlatMap(ResolveNumberP(t), (val: number) => {
				return { value: { value: val, kind: "number" }, kind: "value" }
			})
		case "serving":
			return R.ok({ value: { kind: "serving" }, kind: "value" })
		case "reference":
			return R.ok({
				value: {
					document: t.data.document,
					mealName: t.data.meal_name,
					offset: t.data.offset!,
					kind: "reference"
				},
				kind: "value"
			})
		case "parens":
			return R.FlatMap(ResolveFormulaP(t.data), child => ({
				value: {
					kind: "parens",
					child
				},
				kind: "value"
			}))
		default:
			return R.err(new Error(`${t} is not a number, serving or reference `))
	}
}

function ResolveBinaryP(t: JouleTree): R.Result<Node> {
	switch (t.type) {
		case "+":
		case "-":
		case "*":
		case "/":
			let result: R.Result<Array<BinaryNode | ValueNode>> = t
				.data
				.map(child => ResolveBinaryP(child))
				.reduce(
					(aggregate, currentResult) =>
						R.Bind(currentResult, childNode =>
							R.FlatMap(aggregate, array => [...array, childNode])
						)
					,
					R.ok<Array<Node>>([])
				);
			return R.FlatMap(result, children => ({
				op: t.type,
				children,
				kind: "binary"
			}))
		case "integer":
		case "float":
		case "serving":
		case "reference":
			return ResolveValueP(t)
		default:
			return R.err(new Error(`${t} is not a value node or a binary node`))
	}
}

export function ResolveFormulaP(t: JouleTree): R.Result<Node> {
	switch (t.type) {
		case "+":
		case "-":
		case "*":
		case "/":
			return ResolveBinaryP(t)
		case "integer":
		case "float":
		case "serving":
		case "reference":
			return ResolveValueP(t)
		default:
			return R.err(new Error(`${t} is not a value node or a binary node`))
	}
}

export function ResolveItemP(t: JouleTree): R.Result<MealItem> {
	if (t.type == "item") {
		const name = t.data.name;
		const quantity = ResolveFormulaP(t.data.quantity);
		const formula = ResolveFormulaP(t.data.formula);
		const unit = t.data.unit;
		return R.Bind(formula, (formula) => {
			return R.Bind(quantity, (quantity) => {
				return R.ok(new MealItem(
					quantity,
					unit,
					name,
					formula,
				))
			})
		})
	} else {
		return R.err(new Error(`${t} is not an item node`))
	}
}

export function ResolveMealP(t: JouleTree): R.Result<MealRecord> {
	if (t.type == "meal") {
		const mealItemsResult = t.data.items.data!
			.map(node => ResolveItemP(node.data!))
			.reduce(
				(array, currentResult) =>
					R.Bind(
						currentResult,
						mealItem => R.FlatMap(array, array => [...array, mealItem])
					),
				R.ok<Array<MealItem>>([])
			);

		const tags = t.data.tags.map(t => {
			if (t.type == "tag") {
				return R.ok({
					key: O.UnwrapDefault(O.Optionalize(t.data.key.data), ""),
					value: O.Optionalize(t.data.value)
				})
			} else {
				return R.err(new Error(`${t} is not a tag.`))
			}
		}).reduce((accum: R.Result<Array<Tag>>, current) => {
			return R.Bind(accum, array => R.FlatMap(current, tag => [...array, tag]))
		}, R.ok([]))

		return R.Bind(tags, unwrapped_tags =>
			R.FlatMap(mealItemsResult, mealItems => {
				return new MealRecord(
					t.data.name.data!,
					mealItems,
					t,
					unwrapped_tags
				)
			})
		)
	} else {
		return R.err(new Error(`${t} is not an item node`));
	}
}


export function JouleTreeToString(t: JouleTree): string {
	switch (t.type) {
		case "integer":
			return t.data.toString()
		case "float":
			return t.data.toString()
		case "serving":
			return "s"
		case "reference":
			return `[${t.data.document}][${t.data.meal_name}][${t.data.offset || 0}]`
		case "tag":
			return t.data.key + (t.data.value ? " : " + t.data.value : "")
		case "parens":
			return `(${JouleTreeToString(t.data)})`
		case "/":
			return t.data.map(child => JouleTreeToString(child)).join("/")
		case "*":
			return t.data.map(child => JouleTreeToString(child)).join("*")
		case "-":
			return t.data.map(child => JouleTreeToString(child)).join("-")
		case "+":
			return t.data.map(child => JouleTreeToString(child)).join("+")
		case "item":
			return `${JouleTreeToString(t.data.quantity)} ${t.data.unit} ${t.data.name.data} (${JouleTreeToString(t.data.formula)})`
		case "meal":
			return [t.data.name.data, ...t.data.items.data.map(item => JouleTreeToString(item.data))].join("\n")
	}

}
