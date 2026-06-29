// ---

import { Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	type JouleSettings,
	JouleSettingsTab,
} from "./settings.ts";
import { JouleSuggest, PageSummaryStateField, PreviewJouleBlock } from "./preview.ts";
import { parseJoule } from "./lib/parser.ts"

type MealItem = {
	quantity: number;
	name: string;
	formula: string;
};

type MealRecord = {
	name: string;
	items: MealItem[];
};

// 2. Function to store meal records in a local SQLite file

async function saveData(meal: MealRecord[], page: string) {
	// prepare 1
	// prepare 2
	// mealid = prepare1.write(meal)
	// meal.items.forEach(mealitem => prepare2.write(mealid, mealitem))
}

// 3. Function to query SQLite file for a certain meal name (tags can be either meal name or meal type or ingredient type)
// 4. Function to generate summary statistics from SQLite file
// 5. Svelte view to visualize statistics

export default class Joule extends Plugin {
	settings!: JouleSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new JouleSettingsTab(this.app, this));

		this.addCommand({
			id: "insert-joule-block",
			name: "Insert Block",
			editorCallback(editor, ctx) {
				editor.transaction({
					changes: [{
						text: "```joule\n\n```",
						from: editor.getCursor()
					}]
				})
			},
		})

		this.registerEditorSuggest(new JouleSuggest(this.app));

		this.registerMarkdownCodeBlockProcessor(
			"joule",
			PreviewJouleBlock(this.settings.units),
		);

		this.registerEditorExtension([
			PageSummaryStateField(this.settings.units),
		]);

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on("create", (file) => {
			}, this));
			this.registerEvent(this.app.vault.on("modify", async (file) => {
				const concreteFile = this.app.vault.getFileByPath(file.path);
				if (concreteFile) {
					const blocks = parseJoule(
						await this.app.vault.cachedRead(concreteFile),
						this.settings.units,
					);
				}
			}, this));
			this.registerEvent(this.app.vault.on("delete", (file) => {
			}, this));
			this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			}, this));
		});
	}

	onunload() { }

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<JouleSettings>,
		);
	}

	async saveSettings() {
		this.saveData(this.settings);
	}
}
