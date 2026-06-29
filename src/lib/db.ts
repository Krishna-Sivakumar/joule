/*
	NOTE TO SELF
	The routines in this file will execute queries with SQL.
	SQLite databases cannot be persisted on disk on Obsidian Mobile, so the fallback should be implemented with wa-sqlite.
	This means that there's a reindexing issue, as IndexedDB could be wiped anytime.

	The solution could be to mandate a #joule tag in user-related files,
	or just asking users to be ok with files being re-indexed in the background.

	Use the Platform API to turn the browser-only feature flag on / off.
*/

import { type MealRecord, type ReferenceField } from "./types";
import { Platform } from "obsidian"
import { O } from "./";

const TABLES = [`
	CREATE TABLE meal (
		filepath TEXT,
		name TEXT,
		offset INTEGER,
		universal_key INTEGER PRIMARY KEY,
		UNIQUE(filepath, name, offset)
	) STRICT;
	`, `
	CREATE TABLE item (
		name TEXT,
		unit TEXT,
		quantity FLOAT,
		formula TEXT,
		meal_universal_key INTEGER,
		FOREIGN KEY meal_universal_key REFERENCES meal(universal_key) ON DELETE CASCADE
	) STRICT;
	`, `
	CREATE TABLE metadata (
		meal_universal_key INTEGER,
		key TEXT,
		value TEXT,
		FOREIGN KEY meal_universal_key REFERENCES meal(universal_key) ON DELETE CASCADE
	) STRICT;
	`, `
	-- 'candidate' depends on 'depends_on' here.
	CREATE TABLE depends_on (
		dependant_universal_key INTEGER,
		depends_on_universal_key INTEGER,
		FOREIGN KEY dependant_universal_key REFERENCES meal(universal_key) ON DELETE CASCADE,
		FOREIGN KEY depends_on_universal_key REFERENCES meal(universal_key) ON DELETE CASCADE,
		UNIQUE(dependant_universal_key, depends_on_universal_key) ON CONFLICT REPLACE
	) STRICT;
	`,
].map(t => t.trim())

export function initTables(): O.Result<{}> {
	TABLES.forEach(tableStatement => {
		// TODO implement this
	})
	return O.err(new Error("unreachable"))
}

export function storeMealRecord(meal: MealRecord, filepath: string, offset: number, replace?: boolean | undefined): O.Result<{}> {
	if (Platform.isDesktopApp) {
		// TODO first start a transaction
		// TODO generate UUID values here

		const uuid = (new Crypto()).randomUUID();

		return O.ok({});
	} else {
		// TODO implement this with wa-sqlite as a fallback
		return O.err(new Error("unreachable"));
	}
}

export function getMealRecordById(universal_key: string): O.Result<MealRecord> {
	return O.err(new Error("unreachable"))
}

export function searchMealRecords(args: { name: string, kind: "name" }) {
	return O.err(new Error("unreachable"));
}

export type RecursiveFormulae = {
	formula: string,
	dependent_formulae: Map<
		ReferenceField,
		RecursiveFormulae
	>
};

export function getAllDependentFormulae(universal_key: string): O.Result<RecursiveFormulae> {
	return O.err(new Error("unreachable"))
}
