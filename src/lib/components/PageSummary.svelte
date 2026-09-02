<script lang="ts">
import { getContext, onMount } from 'svelte';
import { assembleUniversalKey, type MealRecord } from '../../lib/types.ts';
import { R } from "../../lib"
import type { DesktopDB } from '@libdb.ts';

const ddb = getContext("ddb") as DesktopDB;
let meals: Array<MealRecord> = (
	getContext("meals") as Array<MealRecord>
).filter(
	meal => meal.tags.find(val => val.key == "shared") === undefined
);
let context: Record<string, MealRecord> = $state({})
let evaledMeals: Array<[MealRecord, R.Result<number>]> = $state([])

onMount(async () => {
	context = R.UnwrapDefault(await ddb.getDependentMeals(
		meals
			.flatMap(meal => meal.getDependents())
			.map(ref => assembleUniversalKey(ref.mealName, ref.document, ref.offset || 0))
	), {})

	evaledMeals = meals.map(meal => [meal, meal.evaluate(context)] as [MealRecord, R.Result<number>])
})
</script>

{#if meals.length > 0}
	<table>
		<tbody>
			{#each evaledMeals as meal}
				{#if R.isOk(meal[1])}
				<tr>
					<td>{meal[0].name}</td>
					<td>{Math.round(meal[1].value)} kcal</td>
				</tr>
				{:else}
				<tr>
					<td style="color: red">{meal[1].error}</td>
				</tr>
				{/if}
			{/each}
			<tr>
				<td><b>Total</b></td>
				<td>
					<b>
						{Math.round(
							evaledMeals
								.map((m) => R.UnwrapDefault(m[1], 0))
								.reduce((p, c) => p + c, 0),
						)} kcal
					</b>
				</td>
			</tr>
		</tbody>
	</table>
{/if}

<style>
	table {
		width: 100%;
		border-collapse: collapse;
	}

	tr {
		border-top: 1px solid white;
	}

	tr:first-child {
		border: none;
	}

	td:nth-child(2) {
		text-align: right;
	}
</style>
