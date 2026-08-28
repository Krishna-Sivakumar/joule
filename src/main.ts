// ---

import { Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	type JouleSettings,
	JouleSettingsTab,
} from "./settings.ts";
import { JouleSuggest, PageSummaryStateField, PreviewJouleBlock } from "./preview.ts";
import { parseJoule } from "./lib/parser.ts"
import { DesktopDB } from "@libdb.ts";
import { O } from "./lib";
import { PGlite } from "@electric-sql/pglite";
import { diffRecords } from "@libtypes.ts";

type MealItem = {
	quantity: number;
	name: string;
	formula: string;
};

type MealRecord = {
	name: string;
	items: MealItem[];
};

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
			const ddb = new DesktopDB();

			this.registerEvent(this.app.vault.on("create", (file) => {
			}, this));
			this.registerEvent(this.app.vault.on("modify", async (file) => {
				const concreteFile = this.app.vault.getFileByPath(file.path);
				if (concreteFile) {

					const old = await ddb.searchMealRecords({ kind: "document", arg: file.path })

					const blocks = parseJoule(
						await this.app.vault.cachedRead(concreteFile),
						this.settings.units,
					);

					O.FlatMap(old, old => {
						O.FlatMap(blocks, async change => {
							const [deleted, created, updated] = diffRecords(old, change);
							console.log("deleted", deleted)
							console.log("created", created)
							console.log("updated", updated)
							for (const tuple of deleted) {
								await ddb.deleteMealRecord(tuple[1], file.path, tuple[2])
							}

							// both of the following do the same thing
							for (const tuple of created) {
								await ddb.storeMealRecord(change[tuple[2]]!, file.path, tuple[2])
							}
							for (const tuple of updated) {
								await ddb.storeMealRecord(change[tuple[2]]!, file.path, tuple[2])
							}
						})
					})
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
