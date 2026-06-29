<script lang="ts">
	import { getContext } from 'svelte';

	let units: string[] = $state(getContext('units'));
	const updateFunc: (units: string[]) => Promise<void> =
		getContext('updateFunc');

	$effect(() => {
		updateFunc(units);
	});

	function addUnit() {
		units.push('');
	}

	function removeUnit(target_idx: number) {
		return () => {
			units = units.filter((_, idx) => idx != target_idx);
		};
	}
</script>

<div class="joule-unit-settings-container">
	<div class="setting-item-info mb-auto">
		<div class="setting-item-name">Units</div>
		<div class="setting-item-description">
			Manage the quantity units that Joule can use.
		</div>
	</div>
	<div class="joule-unit-settings-vertical">
		<button onclick={addUnit}>Add Unit</button>
		{#each units as unit, idx}
			<div>
				<input type="text" bind:value={units[idx]} />
				<button onclick={removeUnit(idx)}>Remove</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.mb-auto {
		margin-bottom: auto;
	}
</style>
