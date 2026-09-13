// ---

import { App, Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	type JouleSettings,
	JouleSettingsTab,
} from "./settings.ts";
import { JouleBlockSuggest, MealFetchModal, PageSummaryStateField, PreviewJouleBlock } from "./preview.ts";
import { DesktopDB } from "@libdb.ts";
import { type JouleTree } from "./lib/bindings/JouleTree.ts";
import { aggregatedOffsets, diffRecords, MealRecord, type Node } from "@libtypes.ts";
import { O, R } from "./lib";
import { ResolveFormulaP, ResolveMealP } from "@libresolver.ts";
import { parseJoule } from "@libparser.ts";

export default class Joule extends Plugin {
	settings!: JouleSettings;
	meal_parser!: (input: string) => R.Result<MealRecord>
	formula_parser!: (input: string) => R.Result<Node>
	ddb!: DesktopDB
	async onload() {
		await this.loadSettings();

		// BLOCK wasm parser initialization
		const pluginPath = this.app.vault.configDir + "/plugins/joule/"
		const wasmPath = pluginPath + "/pkg/parser_bg.wasm"
		const binary = await this.app.vault.adapter.readBinary(wasmPath)
		let jouleLang = await import("../pkg");
		jouleLang.initSync(binary)

		this.meal_parser = (input: string): R.Result<MealRecord> => {
			return R.Bind(R.FlatMap(
				R.WrapFault(jouleLang.parse_meal, input, this.settings.units),
				text => JSON.parse(text) as JouleTree
			), tree => ResolveMealP(tree))
		}
		this.formula_parser = (input: string): R.Result<Node> => {
			return R.Bind(R.FlatMap(
				R.WrapFault(jouleLang.parse_formula, input, this.settings.units),
				text => JSON.parse(text) as JouleTree
			), tree => ResolveFormulaP(tree))
		}
		// END BLOCK

		this.ddb = new DesktopDB(this.meal_parser, this.formula_parser);

		this.addSettingTab(new JouleSettingsTab(this.app, this));

		this.addCommand({
			id: "insert-joule-block",
			name: "Insert Block",
			editorCallback(editor, _ctx) {
				editor.transaction({
					changes: [{
						text: "```joule\n\n```",
						from: editor.getCursor()
					}]
				})
			},
		})

		const plugin = this;

		this.addCommand({
			id: "joule-reindex",
			name: "Reindex Joule",
			async callback() {
				const start = performance.now()
				await Promise.all(plugin.app.vault.getMarkdownFiles().map(async file => {
					const doc = await plugin.app.vault.cachedRead(file)
					const metadata = plugin.app.metadataCache.getFileCache(file)
					const date = R.Optionalize(R.WrapFault(() => new Date(metadata!.frontmatter!["date"]).toDateString()))

					const res = R.FlatMap(parseJoule(doc, plugin.settings.units, plugin.meal_parser), async blocks => {
						const offsets = aggregatedOffsets(blocks)
						await Promise.all(Object.values(offsets).map(async meals => {
							await Promise.all(meals.map(async (meal, offset) => {
								if (O.isSome(date)) {
									meal.tags.push({ key: "date", value: date });
								}
								await plugin.ddb.storeMealRecord(meal, file.path, offset)
							}))
						}))
					});

					if (R.isOk(res)) {
						await res.value;
						console.log(`done indexing ${file.path}`)
					} else {
						console.log(`${file.path}: reindex error:`, res.error)
					}

				}))

				const time_taken = performance.now() - start;

				new Notice(`Joule: Done Reindexing. Took ${time_taken}ms`)
			},
		})

		this.addCommand({
			id: "fetch-past-meal",
			name: "Fetch Past Meal",
			callback: () => {
				new MealFetchModal(this.app, this.ddb).open()
			}
		})

		this.registerEditorSuggest(new JouleBlockSuggest(this.app, this.meal_parser));

		this.registerMarkdownCodeBlockProcessor(
			"joule",
			PreviewJouleBlock(this.settings.units, this.meal_parser, this.ddb),
		);

		this.registerEditorExtension([
			PageSummaryStateField(this.settings.units, this.meal_parser, this.ddb),
		]);

		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on("create", (_file) => {
			}, this));

			this.registerEvent(this.app.vault.on("modify", async (file) => {
				const concreteFile = this.app.vault.getFileByPath(file.path);
				if (concreteFile) {
					const metadata = this.app.metadataCache.getFileCache(concreteFile)
					const old = this.ddb.searchMealRecords({ kind: "document", arg: file.path })

					const blocks = parseJoule(
						await this.app.vault.cachedRead(concreteFile),
						this.settings.units,
						this.meal_parser
					);

					const date = R.WrapFault(() => new Date(metadata!.frontmatter!["date"]))

					R.FlatMap(date, date => R.FlatMap(blocks, async (changes) => {
						changes = changes.map(change => {
							change.tags.push({ key: "date", value: O.some(date.toString()) })
							return change
						})

						const [deleted, created, updated] = diffRecords(old, changes, file.path);
						// console.log("deleted", deleted)
						// console.log("created", created)
						// console.log("updated", updated)

						for (const tuple of deleted) {
							await this.ddb.deleteMealRecord(tuple.meal.name, file.path, tuple.offset)
						}

						// both of the following do the same thing
						for (const tuple of created) {
							await this.ddb.storeMealRecord(tuple.meal, file.path, tuple.offset);
						}
						for (const tuple of updated) {
							await this.ddb.storeMealRecord(tuple.meal, file.path, tuple.offset);
						}

						return R.ok({})
					}))

					R.FlatMap(blocks, async (changes) => {
						const [deleted, created, updated] = diffRecords(old, changes, file.path);
						// console.log("deleted", deleted)
						// console.log("created", created)
						// console.log("updated", updated)

						for (const tuple of deleted) {
							await this.ddb.deleteMealRecord(tuple.meal.name, file.path, tuple.offset)
						}

						// both of the following do the same thing
						for (const tuple of created) {
							await this.ddb.storeMealRecord(tuple.meal, file.path, tuple.offset);
						}
						for (const tuple of updated) {
							await this.ddb.storeMealRecord(tuple.meal, file.path, tuple.offset);
						}
					})

				}
			}, this));
			this.registerEvent(this.app.vault.on("delete", (_file) => {
			}, this));
			this.registerEvent(this.app.vault.on("rename", (_file, _oldPath) => {
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
