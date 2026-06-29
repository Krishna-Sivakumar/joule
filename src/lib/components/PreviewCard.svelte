<script lang="ts">
	import { getContext } from 'svelte';
	import {
		type MealRecord,
		evaluateMealRecord,
		evaluateMealItem,
		formulaString,
	} from '../../parser.ts';
	let tooltipState = $state({ visibility: 'hidden', item: -1, content: '' });

	const meal: MealRecord = getContext('meal');

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
</script>

<div class="tooltip" role="tooltip" style:visibility={tooltipState.visibility}>
	{tooltipState.content}
</div>

<div class="joule-card">
	<div class="joule-card-heading">
		<span>{meal.name}</span>
		<span>{evaluateMealRecord(meal)} kcal</span>
	</div>

	{#each meal.items as item, idx}
		<div class="joule-card-item">
			<span>{item.name}</span>
			<span>{item.quantity} {item.unit ? item.unit : 'cnt.'}</span>
			<span>{evaluateMealItem(item)} kcal</span>
			<span
				class={tooltipState.item == idx ? 'tooltip-anchor' : ''}
				onmouseenter={currentHoveredTooltip(
					idx,
					formulaString(item.formula, item.quantity),
				)}
				onmouseleave={cancelHoveredTooltip()}
				role="note">?</span
			>
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
