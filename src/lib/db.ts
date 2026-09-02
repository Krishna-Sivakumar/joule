/*
	NOTE TO SELF
	The routines in this file will execute queries with SQL.
	SQLite databases cannot be persisted on disk on Obsidian Mobile, so the fallback should be implemented with wa-sqlite.
	This means that there's a reindexing issue, as IndexedDB could be wiped anytime.

	The solution could be to mandate a #joule tag in user-related files,
	or just asking users to be ok with files being re-indexed in the background.

	Use the Platform API to turn the browser-only feature flag on / off.
*/

import { formulaToString, type MealRecord, type ReferenceField, type Node, assembleUniversalKey } from "./types";
import { R, O } from "./";

import Dexie, { type EntityTable } from "dexie";
import type { JouleTree } from "@libbindings/JouleTree";
import { ResolveMealP } from "@libresolver";

interface DBMeal {
	document: string
	mealName: string
	offset: number
	metadata: {
		parseTree: JouleTree
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

type RecursiveFormulae = {
	formulae: Node[],
	dependent_formulae: Map<
		string,              // hash of the form document-mealName-offset
		RecursiveFormulae
	>
};

export class DesktopDB {
	db: Dexie & {
		meal: EntityTable<DBMeal, "universal_key">,
		item: EntityTable<DBItem, "universal_key">,
		dependence: EntityTable<DBDependence, "dependant_uk">
	};
	meal_parser: (input: string) => R.Result<MealRecord>;
	formula_parser: (input: string) => R.Result<Node>;

	constructor(
		meal_parser: (input: string) => R.Result<MealRecord>,
		formula_parser: (input: string) => R.Result<Node>
	) {
		this.db = new Dexie("joule") as typeof this.db;
		this.db.version(2).stores({
			meal: "&universal_key,document",
			item: "[universal_key+name],[name+universal_key+formula+unit+quantity]",
			dependence: "[dependant_uk+dependee_uk]",
		})
		this.db.open()
		this.meal_parser = meal_parser;
		this.formula_parser = formula_parser;
	}

	async deleteMealRecord(mealName: string, document: string, offset: number) {
		await this.db.meal.delete(assembleUniversalKey(mealName, document, offset))
	}

	async storeMealRecord(meal: MealRecord, document: string, offset: number) {
		const universal_key = `${document.split(".")[0]}-${meal.name}-${offset}`

		await this.db.transaction("rw", this.db.meal, this.db.item, this.db.dependence, async (t) => {
			await t.meal.put({
				mealName: meal.name,
				document,
				offset,
				universal_key,
				metadata: {
					parseTree: meal.parseTree
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

	async searchMealRecords(args: { arg: string, kind: "name" } | { arg: string, kind: "document" }): Promise<R.Result<MealRecord[]>> {
		switch (args.kind) {
			case "document":
				return R.ok((await Promise.all(
					(await this.db.meal.where({ document: args.arg }).toArray())
						.map(dbmeal => dbmeal.universal_key)
						.map(k => this.getMealRecordById(k))
				)).reduce((array, current) => {
					if (R.isOk(current)) {
						array.push(current.value)
					}
					return array
				}, [] as MealRecord[]))
			case "name":
				return R.ok((await Promise.all(
					(await this.db.meal.where({ name: args.arg }).toArray())
						.map(dbmeal => dbmeal.universal_key)
						.map(k => this.getMealRecordById(k))
				)).reduce((array, current) => {
					if (R.isOk(current)) {
						array.push(current.value)
					}
					return array
				}, [] as MealRecord[]))
			default:
				return R.err(new Error("unimplemented"))
		}
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

	// async getAllDependentFormulae(universal_key: string): Promise<R.Result<RecursiveFormulae>> {
	// 	/**
	// 	* collect meals and related formulae into a table
	// 	* before building out the recursive structure
	// 	*/

	// 	let table: Map<string, Node[]> = new Map();

	// 	const hashReferenceField = (r: ReferenceField) => `${r.document}-${r.mealName}-${r.offset}`

	// 	let queue: string[] = [universal_key]
	// 	let visited: Set<string> = new Set()
	// 	do {
	// 		// fetch the current key
	// 		const head = queue[0]!;
	// 		queue = queue.slice(1);
	// 		if (visited.has(head)) {
	// 			continue
	// 		}
	// 		visited.add(head)

	// 		let meal = await this.db.meal.get(universal_key)
	// 		if (!meal) {
	// 			return R.err(new Error(`Meal not found: ${universal_key}`))
	// 		}
	// 		let reference: ReferenceField = { document: meal.document, offset: meal.offset, mealName: meal.mealName, kind: "reference" }

	// 		// fetch items related to the meal
	// 		for (const item of await this.db.item.where({ universal_key: head }).toArray()) {
	// 			// parse the formula of each item
	// 			const nodeResult = parseFormulaString(item.formula)
	// 			if (R.isOk(nodeResult)) {
	// 				// if valid, add it to the meal's parsed formulae
	// 				const node = nodeResult.value
	// 				if (table.has(hashReferenceField(reference))) {
	// 					table.get(hashReferenceField(reference))!.push(node)
	// 				} else {
	// 					table.set(hashReferenceField(reference), [node])
	// 				}
	// 			} else {
	// 				return R.err(new Error(`Malformed formula: ${item.formula} of meal ${reference}`))
	// 			}
	// 		}

	// 		for (const node of table.get(head) || []) {
	// 			let refs = getDependentsFromFormula(node)
	// 			for (const ref of refs) {
	// 				const potentialMeal = await this.db.meal.where({ filepath: ref.document, name: ref.mealName, offset: ref.offset }).first();
	// 				if (!potentialMeal) {
	// 					return R.err(new Error(`Could not find meal ${ref}`))
	// 				}
	// 				if (visited.has(potentialMeal.universal_key)) {
	// 					continue
	// 				} else {
	// 					queue.push(potentialMeal.universal_key)
	// 				}
	// 			}
	// 		}
	// 	} while (queue.length > 0)

	// 	function assembleRecursive(table: Map<string, Node[]>, current: string): RecursiveFormulae {
	// 		const rf: RecursiveFormulae = {
	// 			formulae: table.get(current)!,
	// 			dependent_formulae: new Map()
	// 		};

	// 		rf.dependent_formulae = (table.get(current) || []).flatMap(node => getDependentsFromFormula(node).map(dependeeReference => {
	// 			const referenceHash = hashReferenceField(dependeeReference)
	// 			return [referenceHash, assembleRecursive(table, referenceHash)] as [string, RecursiveFormulae]
	// 		})).reduce((map, current) => {
	// 			map.set(current[0], current[1])
	// 			return map
	// 		}, new Map() as Map<string, RecursiveFormulae>)

	// 		return rf
	// 	}

	// 	return R.ok(assembleRecursive(table, universal_key))
	// }
}


