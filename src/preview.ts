import {
	type MarkdownPostProcessorContext,
	EditorSuggest,
	App,
	Editor,
	TFile,
	type EditorPosition,
	type EditorSuggestTriggerInfo,
	type EditorSuggestContext,
} from "obsidian";
import {
	parseJoule,
} from "./lib/parser.ts";
import {
	type MealRecord
} from "./lib/types.ts";
import { mount } from "svelte";
import { R } from "./lib/index.ts";
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

export class JouleSuggest extends EditorSuggest<Suggestions> {
	constructor(app: App) {
		super(app)
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		let tokenOfConcern = MarkdownIt()
			.parse(editor.getValue(), {})
			.filter(
				token =>
				(token.map ?
					cursor.line > token.map[0] && cursor.line < token.map[1]
					: false
				)
			).at(0)

		if (tokenOfConcern && tokenOfConcern.tag == "code" && tokenOfConcern.info == "joule") {
			return {
				start: cursor,
				end: cursor,
				query: ""
			}
		} else {
			return null;
		}

	}

	getSuggestions(_context: EditorSuggestContext): Suggestions[] | Promise<Suggestions[]> {
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
