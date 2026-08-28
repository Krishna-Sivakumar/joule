/*
	NOTE TO SELF
	The routines in this file will execute queries with SQL.
	SQLite databases cannot be persisted on disk on Obsidian Mobile, so the fallback should be implemented with wa-sqlite.
	This means that there's a reindexing issue, as IndexedDB could be wiped anytime.

	The solution could be to mandate a #joule tag in user-related files,
	or just asking users to be ok with files being re-indexed in the background.

	Use the Platform API to turn the browser-only feature flag on / off.
*/

import { formulaToString, getDependentsFromFormula, type MealItem, type MealRecord, type ReferenceField, type Node, assembleUniversalKey } from "./types";
import { O } from "./";
import assert from "assert";
import { parseFormulaString } from "@libparser";

import type { TFile } from "obsidian";
import Dexie, { type EntityTable } from "dexie";

function notEmpty<TValue>(value: TValue | null | undefined): value is TValue {
	return value !== null && value !== undefined;
}

interface DBMeal {
	document: string
	mealName: string
	offset: number
	metadata: Record<string, string>
	universal_key: string
}

interface DBItem {
	name: string
	unit: string
	quantity: number
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
	}

	constructor() {
		this.db = new Dexie("joule") as typeof this.db;
		this.db.version(2).stores({
			meal: "&universal_key,document",
			item: "[universal_key+name],[name+universal_key+formula+unit+quantity]",
			dependence: "[dependant_uk+dependee_uk]",
		})
		this.db.open()
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
				metadata: {}
			})

			if (await t.meal.get(universal_key)) {
				for (const item of meal.items) {
					t.item.put({
						name: item.name,
						unit: item.unit || "",
						quantity: item.quantity,
						formula: formulaToString(item.formula),
						universal_key
					})
				}
			} else {
				t.abort()
			}

			if (meal.depends_on) {
				for (const dependee of meal.depends_on) {
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
			}
		})
	}

	async getMealRecordById(universal_key: string): Promise<O.Result<MealRecord>> {
		let meal: DBMeal | undefined;
		if ((meal = await this.db.meal.get(universal_key))) {

			let items = await this.db.item.where({ universal_key }).toArray()

			return O.ok({
				name: meal.mealName,
				items: items.map(item => ({
					quantity: item.quantity,
					unit: item.unit,
					name: item.name,
					formula: O.Unwrap(parseFormulaString(item.formula))
				}))
			})
		} else {
			return O.err(new Error("meal not found."))
		}
	}

	async searchMealRecords(args: { arg: string, kind: "name" } | { arg: string, kind: "document" }): Promise<O.Result<MealRecord[]>> {
		switch (args.kind) {
			case "document":
				return O.ok((await Promise.all(
					(await this.db.meal.where({ document: args.arg }).toArray())
						.map(dbmeal => dbmeal.universal_key)
						.map(k => this.getMealRecordById(k))
				)).reduce((array, current) => {
					if (O.isOk(current)) {
						array.push(current.value)
					}
					return array
				}, [] as MealRecord[]))
			case "name":
				return O.ok((await Promise.all(
					(await this.db.meal.where({ name: args.arg }).toArray())
						.map(dbmeal => dbmeal.universal_key)
						.map(k => this.getMealRecordById(k))
				)).reduce((array, current) => {
					if (O.isOk(current)) {
						array.push(current.value)
					}
					return array
				}, [] as MealRecord[]))
			default:
				return O.err(new Error("unimplemented"))
		}
	}

	async getAllDependentFormulae(universal_key: string): Promise<O.Result<RecursiveFormulae>> {
		// collect meals and related formulae into a table
		// before building out the recursive structure

		let table: Map<string, Node[]> = new Map();

		const hashReferenceField = (r: ReferenceField) => `${r.document}-${r.mealName}-${r.offset}`

		let queue: string[] = [universal_key]
		let visited: Set<string> = new Set()
		do {
			// fetch the current key
			const head = queue[0]!;
			queue = queue.slice(1);
			if (visited.has(head)) {
				continue
			}
			visited.add(head)

			let meal = await this.db.meal.get(universal_key)
			if (!meal) {
				return O.err(new Error(`Meal not found: ${universal_key}`))
			}
			let reference: ReferenceField = { document: meal.document, offset: meal.offset, mealName: meal.mealName, kind: "reference" }

			// fetch items related to the meal
			for (const item of await this.db.item.where({ universal_key: head }).toArray()) {
				// parse the formula of each item
				const nodeResult = parseFormulaString(item.formula)
				if (O.isOk(nodeResult)) {
					// if valid, add it to the meal's parsed formulae
					const node = nodeResult.value
					if (table.has(hashReferenceField(reference))) {
						table.get(hashReferenceField(reference))!.push(node)
					} else {
						table.set(hashReferenceField(reference), [node])
					}
				} else {
					return O.err(new Error(`Malformed formula: ${item.formula} of meal ${reference}`))
				}
			}

			for (const node of table.get(head) || []) {
				let refs = getDependentsFromFormula(node)
				for (const ref of refs) {
					const potentialMeal = await this.db.meal.where({ filepath: ref.document, name: ref.mealName, offset: ref.offset }).first();
					if (!potentialMeal) {
						return O.err(new Error(`Could not find meal ${ref}`))
					}
					if (visited.has(potentialMeal.universal_key)) {
						continue
					} else {
						queue.push(potentialMeal.universal_key)
					}
				}
			}
		} while (queue.length > 0)

		function assembleRecursive(table: Map<string, Node[]>, current: string): RecursiveFormulae {
			const rf: RecursiveFormulae = {
				formulae: table.get(current)!,
				dependent_formulae: new Map()
			};

			rf.dependent_formulae = (table.get(current) || []).flatMap(node => getDependentsFromFormula(node).map(dependeeReference => {
				const referenceHash = hashReferenceField(dependeeReference)
				return [referenceHash, assembleRecursive(table, referenceHash)] as [string, RecursiveFormulae]
			})).reduce((map, current) => {
				map.set(current[0], current[1])
				return map
			}, new Map() as Map<string, RecursiveFormulae>)

			return rf
		}

		return O.ok(assembleRecursive(table, universal_key))
	}
}


