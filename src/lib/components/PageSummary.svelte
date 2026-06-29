<script lang="ts">
	import { getContext } from 'svelte';
	import { type MealRecord, evaluateMealRecord } from '../../parser.ts';

	const meals: MealRecord[] = getContext('meals');
</script>

<table>
	<tbody>
		{#each meals as meal}
			<tr>
				<td>{meal.name}</td>
				<td>{evaluateMealRecord(meal)} kcal</td>
			</tr>
		{/each}
		<tr>
			<td><b>Total</b></td>
			<td>
				<b>
					{meals
						.map((m) => evaluateMealRecord(m))
						.reduce((p, c) => p + c, 0)} kcal
				</b>
			</td>
		</tr>
	</tbody>
</table>

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
