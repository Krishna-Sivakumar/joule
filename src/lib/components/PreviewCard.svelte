<script lang="ts">
import { getContext, onMount } from 'svelte';
import {
assembleUniversalKey,
	MealItem,
	MealRecord,
} from '../../lib/types.ts';
import { R, O } from "../../lib"
import type { DesktopDB } from '@libdb.ts';
let tooltipState = $state({ visibility: 'hidden', item: -1, content: '' });

/**
* NOTE to self
* PLEASE PLEASE PLEEEEEEEEEEEEeASE CLEAN THIS UP T_T
* this looks like horrible garbage
*
* all this bullshit because of no top level awaits...
*/

const meal: MealRecord = getContext('meal');
const ddb = getContext("ddb") as DesktopDB;
let context: Record<string, MealRecord> = $state({})

let total: O.Option<number> = $state(O.none());
let evaledItems: Array<R.Result<{quantity: number, itemTotal: number, item: MealItem, formulaString: string}>> = $state([])

onMount(async () => {
	context = R.UnwrapDefault(await ddb.getDependentMeals(
		meal
			.getDependents()
			.flatMap(
				ref =>
				assembleUniversalKey(ref.mealName, ref.document, ref.offset || 0)
			)
	), {})

	evaledItems = meal
		.items
		.map(item => {
			return R.MapError(R.Bind(
				item.evaluate(context),
				itemTotal => R.Bind(
					item.evaluateQuantity(),
					quantity => R.Bind(
						item.evaluatedFormulaString(context),
						formulaString => R.ok({
							quantity,
							itemTotal,
							item,
							formulaString
						})
					)
				)
			), err => new Error(`Could not calculate ${item.name.data!}: ${err}`))
		})

	total = O.some(evaledItems.map(item => R.UnwrapDefault(R.FlatMap(item, item => item.itemTotal), 0)).reduce((p, c) => p + c))
})

function currentHoveredTooltip(item: number, content: string) {
	return function () {
		tooltipState.item = item;
		tooltipState.visibility = 'visible';
		tooltipState.content = content;
	};
}

function cancelHoveredTooltip() {
	return function () {
		tooltipState.item = -1;
		tooltipState.visibility = 'hidden';
		tooltipState.content = '';
	};
}

/**
* Displays a number with either 1.xx precision, or as a plain integer without a decimal part if the mantissa is 0.
*/
function ToFixedOrSnip(n: number): string {
	let display = n.toFixed(2)
	if (display.slice( display.length - 3, display.length ) == ".00") {
		return display.slice(0, display.length - 3)
	} else {
		return display;
	}
}
</script>

<div class="tooltip" role="tooltip" style:visibility={tooltipState.visibility}>
	{tooltipState.content}
</div>

<div class="joule-card">
	<div class="joule-card-heading">
		<span>{meal.name}</span>
		<span>{O.UnwrapDefault(O.FlatMap(total, total => `${Math.round(total)} kcal`), "")}</span>
	</div>

	{#each evaledItems as item, idx}
		<div class="joule-card-item">
			{#if R.isOk(item)}
			<span>{item.value.item.name.data!}</span>
			<span>{ToFixedOrSnip(item.value.quantity)} {item.value.item.unit ? item.value.item.unit : 'cnt.'}</span>
			<span>{Math.round(item.value.itemTotal)} kcal</span>
			<span
				class={tooltipState.item == idx ? 'tooltip-anchor' : ''}
				onmouseenter={currentHoveredTooltip(
					idx,
					item.value.formulaString
				)}
				onmouseleave={cancelHoveredTooltip()}
				role="note">?</span
			>
			{:else}
			<span>{item.error}</span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.tooltip-anchor {
		anchor-name: --tooltip-anchor;
	}

	.tooltip {
		position: fixed;
		position-anchor: --tooltip-anchor;
		position-area: bottom;
		background: rgba(0, 0, 0, 0.9);
		padding: 0.25rem;
		border-radius: 0.5rem;
	}

	.joule-card {
		border: 1px solid white;
		margin: 0.5rem 0 0.5rem 0;
		border-radius: 0.25rem;
		padding: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.joule-card-heading {
		font-size: 1.25rem;
		font-weight: bold;
		display: flex;
		border-bottom: 3px solid white;
	}

	.joule-card-heading span:last-child {
		margin-left: auto;
	}

	.joule-card-item {
		display: flex;
		gap: 0.25rem;
		align-items: baseline;
	}

	.joule-card-item:nth-child(n) {
		border-bottom: 1px solid white;
		padding-bottom: 0.25rem;
	}

	.joule-card-item:last-child {
		border-bottom: none;
	}

	.joule-card-item span:nth-child(1) {
		font-weight: bold;
	}

	.joule-card-item span:nth-child(2) {
		/* unit field */
		font-size: 0.75rem;
		color: gray;
	}

	.joule-card-item span:nth-child(3) {
		margin-left: auto;
		font-weight: bold;
	}

	.joule-card-item span:nth-child(4) {
		height: 100%;
		border: 1px dashed rgba(255, 255, 255, 0.25);
		padding: 0 0.25rem 0 0.25rem;
		user-select: none;
		margin: 0 0.25rem 0 0.25rem;
	}
</style>
