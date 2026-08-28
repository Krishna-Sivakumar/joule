<script lang="ts">
	import { getContext } from 'svelte';
	import { type MealRecord, evaluateMealRecord } from '../../lib/types.ts';

	const meals: MealRecord[] = getContext('meals');
</script>

{#if meals.length > 0}
	<table>
		<tbody>
			{#each meals as meal}
				<tr>
					<td>{meal.name}</td>
					<td>{Math.round(evaluateMealRecord(meal))} kcal</td>
				</tr>
			{/each}
			<tr>
				<td><b>Total</b></td>
				<td>
					<b>
						{Math.round(
							meals
								.map((m) => evaluateMealRecord(m))
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
