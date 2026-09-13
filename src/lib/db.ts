/*
	NOTE TO SELF
	The routines in this file will execute queries with SQL.
	SQLite databases cannot be persisted on disk on Obsidian Mobile, so the fallback should be implemented with wa-sqlite.
	This means that there's a reindexing issue, as IndexedDB could be wiped anytime.

	The solution could be to mandate a #joule tag in user-related files,
	or just asking users to be ok with files being re-indexed in the background.

	Use the Platform API to turn the browser-only feature flag on / off.
*/

import { formulaToString, type MealRecord, type Node, assembleUniversalKey, type Tag } from "./types";
import { R, O } from "./";

import Dexie, { type EntityTable } from "dexie";
import type { JouleTree } from "@libbindings/JouleTree";
import { ResolveMealP } from "@libresolver";
import Fuse from "fuse.js";

interface DBMeal {
	document: string
	mealName: string
	offset: number
	metadata: {
		parseTree: JouleTree,
		tags: Tag[]
	}
	universal_key: string
}

interface DBItem {
	name: string
	unit: string
	quantity: string
	formula: string
	universal_key: string
}

interface DBDependence {
	dependant_uk: string
	dependee_uk: string
}

export class DesktopDB {
	db: Dexie & {
		meal: EntityTable<DBMeal, "universal_key">,
		item: EntityTable<DBItem, "universal_key">,
		dependence: EntityTable<DBDependence, "dependant_uk">
	};
	meal_parser: (input: string) => R.Result<MealRecord>;
	formula_parser: (input: string) => R.Result<Node>;
	fuzzy_search_instance!: Fuse<DBMeal>

	constructor(
		meal_parser: (input: string) => R.Result<MealRecord>,
		formula_parser: (input: string) => R.Result<Node>
	) {
		this.db = new Dexie("joule") as typeof this.db;
		this.db.version(2).stores({
			meal: "&universal_key,document,mealName",
			item: "[universal_key+name],[name+universal_key+formula+unit+quantity],name",
			dependence: "[dependant_uk+dependee_uk]",
		})
		this.db.open()
		this.meal_parser = meal_parser;
		this.formula_parser = formula_parser;

		this.db.meal.toArray().then(dbMeals => {
			this.fuzzy_search_instance = new Fuse(dbMeals, { keys: ["document", "mealName"] })
		})
	}

	async deleteMealRecord(mealName: string, document: string, offset: number) {
		await this.db.meal.delete(assembleUniversalKey(mealName, document, offset))
	}

	async storeMealRecord(meal: MealRecord, document: string, offset: number) {
		const universal_key = assembleUniversalKey(meal.name, document, offset);

		await this.db.transaction("rw", this.db.meal, this.db.item, this.db.dependence, async (t) => {
			await t.meal.put({
				mealName: meal.name,
				document,
				offset,
				universal_key,
				metadata: {
					parseTree: meal.parseTree,
					tags: meal.tags
				}
			})

			if (await t.meal.get(universal_key)) {
				for (const item of meal.items) {
					t.item.put({
						name: item.name.data!,
						unit: item.unit || "",
						quantity: formulaToString(item.quantity),
						formula: formulaToString(item.formula),
						universal_key
					})
				}
			} else {
				t.abort()
			}

			if (meal.dependsOn) {
				O.Match(meal.dependsOn, {
					async onSome(dependsOn) {
						for (const dependee of dependsOn) {
							const depe = await t.meal.get({
								...dependee
							})
							if (depe) {
								t.dependence.put({
									dependant_uk: universal_key,
									dependee_uk: depe.universal_key
								})
							} else {
								t.abort()
							}
						}
					},
					onNone() { }
				})

			}
		})
	}

	async getMealRecordById(universal_key: string): Promise<R.Result<MealRecord>> {
		return R.Bind(
			O.Resultize(
				O.Optionalize(await this.db.meal.get(universal_key))
			),
			meal => ResolveMealP(meal.metadata.parseTree)
		)
	}

	searchMealRecords(...args: Array<{ arg: string, kind: "mealName" | "document", exact?: boolean }>): MealRecord[] {
		const clauses: Array<Fuse.Expression> = args.map(argument => {
			if (argument.exact && argument.exact) {
				return { [argument.kind]: { $eq: argument.arg } }
			} else {
				return { [argument.kind]: argument.arg }
			}
		})

		return this
			.fuzzy_search_instance
			.search({ $and: clauses })
			.map(dbmeal => ResolveMealP(dbmeal.item.metadata.parseTree))
			.reduce((array, current) => {
				if (R.isOk(current)) {
					array.push(current.value)
				}
				return array
			}, [] as MealRecord[])
	}

	async getDependentMeals(keys: string[]): Promise<R.Result<Record<string, MealRecord>>> {
		let table: R.Result<Record<string, MealRecord>> = R.ok({});
		if (keys.length == 0) {
			return table
		}

		let queue: string[] = [...keys]
		let visited: Set<string> = new Set()
		do {
			const head = queue[0]!;
			queue = queue.slice(1);
			if (visited.has(head)) {
				continue;
			}
			visited.add(head);

			if (R.UnwrapDefault(
				R.FlatMap(table, table => Object.keys(table).indexOf(head) > -1), false
			)) {
				continue
			}

			let meal = await this.getMealRecordById(head);
			R.Bind(table, table => R.FlatMap(
				meal,
				meal => {
					const deps = meal.getDependents();
					table[head] = meal;
					for (const dep of deps) {
						queue.push(assembleUniversalKey(dep.mealName, dep.document, dep.offset || 0))
					}
					return table
				}
			))
		} while (queue.length > 0 && R.isOk(table))

		return table
	}
}


