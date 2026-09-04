import {
	type MarkdownPostProcessorContext,
	EditorSuggest,
	App,
	Editor,
	TFile,
	type EditorPosition,
	type EditorSuggestTriggerInfo,
	type EditorSuggestContext,
	SuggestModal,
	MarkdownView,
} from "obsidian";
import {
	parseJoule,
} from "./lib/parser.ts";
import {
	assembleUniversalKey,
	type MealRecord
} from "./lib/types.ts";
import { mount } from "svelte";
import { R, O } from "./lib/index.ts";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, StateField } from "@codemirror/state";
import { PageSummary, PreviewCard } from "./lib/index.ts";
import MarkdownIt from "markdown-it";
import { DesktopDB } from "@libdb.ts";
import { JouleTreeToString } from "@libresolver.ts";

export function PreviewJouleBlock(units: string[], parser: (input: string, units: Array<string>) => R.Result<MealRecord>, ddb: DesktopDB) {
	return async (
		source: string,
		el: HTMLElement,
		_ctx: MarkdownPostProcessorContext,
	): Promise<void> => {
		const meal = parser(source, units);

		R.Match(meal, {
			onOk: (meal) => {
				mount(PreviewCard, {
					target: el,
					context: new Map().set("meal", meal).set("ddb", ddb),
				});
			},
			onErr: (err) => {
				const errMessage = el.createEl("p");
				errMessage.style = "color: red; padding: 0.5em;";
				errMessage.setText(err.message);
			},
		});
	};
}

type Suggestions = {
	id: string,
	name: string,
	action: () => void
}

export class MealFetchModal extends SuggestModal<MealRecord> {
	ddb: DesktopDB

	constructor(app: App, ddb: DesktopDB) {
		super(app)
		this.ddb = ddb;
	}

	async getSuggestions(query: string): Promise<MealRecord[]> {
		console.log(await this.ddb.searchMealRecords({ arg: query, kind: "name" }))
		return R.UnwrapDefault(await this.ddb.searchMealRecords({ arg: query, kind: "name" }), [])
	}

	async renderSuggestion(meal: MealRecord, el: HTMLElement): Promise<void> {
		const context = await this.ddb.getDependentMeals(meal.getDependents().map(ref => assembleUniversalKey(ref.mealName, ref.document, ref.offset || 0)))

		R.FlatMap(context, context => {
			R.Bind(meal.evaluate(context), totalCalories => {
				el.createEl("div", { text: `${meal.name}: ${Math.round(totalCalories)} kcal` });

				// el.createEl("div", { text: `${item.quantity} ${item.unit} ${item.name.data}: ${Math.round(itemCalories)} kcal`, attr: { style: "font-size: smaller" } });

				meal.items.forEach(item => {
					R.FlatMap(item.evaluate(context), itemCalories => R.Bind(
						item.evaluateQuantity(),
						quantity => R.ok(
							el.createEl(
								"div",
								{
									text: [quantity.toString(), item.unit, item.name.data, Math.round(itemCalories).toString(), "kcal"].filter(str => str.length > 0).join(" "),
									attr: { style: "font-size: smaller" }
								}
							)
						)
					))
				})

				return R.ok({})
			})
		})
	}

	onChooseSuggestion(meal: MealRecord, _evt: MouseEvent | KeyboardEvent): void {
		const wrapInCodeBlock = (content: string) => {
			return `\`\`\`joule\n${content}\n\`\`\``
		}

		const view = this.app.workspace.getActiveViewOfType(MarkdownView)
		if (view) {
			const cursor = view.editor.getCursor();
			view.editor.replaceRange(wrapInCodeBlock(JouleTreeToString(meal.parseTree)), cursor)
		}
	}
}

export class JouleBlockSuggest extends EditorSuggest<Suggestions> {
	meal_parser: (input: string) => R.Result<MealRecord>;

	constructor(app: App, meal_parser: (input: string) => R.Result<MealRecord>) {
		super(app)
		this.meal_parser = meal_parser;
	}

	getMealInFocus(editor: Editor): O.Option<MealRecord> {
		const cursor = editor.getCursor()
		const token = MarkdownIt()
			.parse(editor.getValue(), {})
			.filter(
				token =>
				(token.map ?
					cursor.line > token.map[0] && cursor.line < token.map[1]
					: false
				)
			).at(0)

		if (token && token.tag == "code" && token.info == "joule") {
			return R.Optionalize(this.meal_parser(token.content))
		} else {
			return O.none()
		}
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		return O.Match(this.getMealInFocus(editor), {
			onSome(_) {
				return {
					start: cursor,
					end: cursor,
					query: ""
				}
			},
			onNone() {
				return null
			}
		});
	}

	getSuggestions(context: EditorSuggestContext): Suggestions[] | Promise<Suggestions[]> {
		return O.UnwrapDefault(O.FlatMap(this.getMealInFocus(context.editor), meal => {
			return []
		}), [])

		return [{
			id: "get-item",
			name: "Get Item",
			action: () => { }
		}, {
			id: "get-meal",
			name: "Get Meal",
			action: () => { }
		}, {
			id: "ref-meal",
			name: "Reference Meal",
			action: () => { }
		}]
	}

	renderSuggestion(value: Suggestions, el: HTMLElement): void {
		// el.addClass("suggestion-container")
		el
			.createEl("div", { cls: "suggestion-item" })
			.createEl("div", { cls: "suggestion-content" })
			.createEl("div", { cls: "suggestion-title" })
			.createEl("span").setText(value.name)
	}

	selectSuggestion(value: Suggestions, evt: MouseEvent | KeyboardEvent): void {
		value.action()
		this.close()
	}
}



class PageSummaryWidget extends WidgetType {
	records: MealRecord[];
	ddb: DesktopDB
	constructor(records: MealRecord[], ddb: DesktopDB) {
		super();
		this.records = records;
		this.ddb = ddb;
	}
	toDOM(_view: EditorView): HTMLElement {
		const container = createEl("div");
		mount(PageSummary, {
			target: container,
			context: new Map().set("meals", this.records).set("ddb", this.ddb),
		});
		return container;
	}
}

export const PageSummaryStateField = (units: string[], parser: (input: string, units: Array<string>) => R.Result<MealRecord>, ddb: DesktopDB) =>
	StateField.define<DecorationSet>({
		create: (_) => {
			return Decoration.none;
		},
		update: (_, tx) => {

			tx.state

			/*
		NOTE TO SELF
		Right now, I parse the entire page whenever I detect a change here.
		This seems to be absolutely fine performance-wise, right now.

		If this ever becomes an issue, a good idea is to detect if a particular block has changed, and then reparse it.
		This would cut down on processing way more than trying to build an incremental parser.

		Maybe this can be rewritten into a View plugin.
		But the problem there is the edge case that a markdown block takes up the entire screen.

		There is also the problem that I have to do bookkeeping on my side to make sure that
		I'm not grouping two overlapping markdown blocks into one entry.
		*/
			return R.Match(
				R.FlatMap(
					parseJoule(tx.state.doc.toString(), units, parser),
					(blocks) => {
						const widget = new PageSummaryWidget(blocks, ddb);
						const b = new RangeSetBuilder<Decoration>();
						b.add(
							tx.state.doc.length,
							tx.state.doc.length,
							Decoration.widget({
								widget: widget,
								side: 1,
								block: true,
							}),
						);
						return b.finish();
					},
				),
				{
					onOk: (decorations) => decorations,
					onErr: (_) => Decoration.none,
				},
			);
		},
		provide: (field) => {
			return EditorView.decorations.from(field);
		},
	});
