import type {
	MealRecord,
} from "./types";

import { R } from "./"
import markdownit from "markdown-it";

/**
 * Parses joule blocks in a markdown page.
 * Potentially returns multiple `MealRecord`s in a page.
 */
export function parseJoule(
	content: string,
	units: string[],
	parser: (input: string, units: Array<string>) => R.Result<MealRecord>
): R.Result<Array<MealRecord>> {
	const md = markdownit();
	const tokens = md.parse(content, {});
	const codeBlocks = tokens.filter((token) => {
		return (token.type == "fence" && token.tag == "code" &&
			token.info == "joule");
	}).map((token) => token.content.trim());

	return codeBlocks
		.map(
			block => parser(block, units)
		)
		.reduce(
			(totalResult, mealResult) => {
				return R.Bind(totalResult, total => R.FlatMap(
					mealResult,
					mealRecord => [
						...total,
						mealRecord
					]
				))
			},
			R.ok<Array<MealRecord>>([] as Array<MealRecord>)
		)
}
