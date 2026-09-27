import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for the pure frontend helpers. Deliberately NOT wired through the
// SvelteKit Vite plugin: the tests only cover framework-free modules (`utils/`,
// `stores/notifications`), so a plain Node environment is enough and the
// suite stays fast. `$lib` is resolved by hand for the same reason.
export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
	},
});
