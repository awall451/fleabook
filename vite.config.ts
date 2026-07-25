import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// adapter-node: the Agent SDK spawns a subprocess, so this has to run on
			// the Node runtime rather than an edge runtime.
			adapter: adapter(),

			csrf: {
				// The app may be reached two ways: through a reverse proxy on a
				// hostname, and directly on the published port. adapter-node derives
				// the origin from headers (HOST_HEADER / PROTOCOL_HEADER), which covers
				// the proxied path — but on the direct path there is no
				// x-forwarded-proto header, and it falls back to assuming `https`
				// (adapter-node handler.js: `... || 'https'`). That makes the derived
				// origin https://127.0.0.1:5180 and every upload 403s.
				//
				// Listing the direct origins explicitly fixes that without weakening
				// the check: a genuine cross-site POST still carries a third-party
				// Origin and is still rejected. Add your own hostname's origin here if
				// you serve this behind a proxy.
				trustedOrigins: [
					'http://localhost:5180',
					'http://127.0.0.1:5180',
					'http://localhost:5173',
					'http://localhost:5174'
				]
			}
		})
	]
});
