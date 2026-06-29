import { defineConfig } from 'vitest/config'
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
	test: {
		include: ["src/test/*.test.ts"],
	},
	plugins: [svelte()],
})
