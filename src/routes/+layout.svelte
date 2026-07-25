<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header>
	<div class="inner">
		<a class="brand" href="/">Fleabook</a>
		<nav>
			<a class="link" href="/dashboard">Dashboard</a>
			<a class="link" href="/settings">Settings</a>
			<a class="new" href="/new">New listing</a>
		</nav>
	</div>
</header>

<main class="page">
	{@render children()}
</main>

<style>
	header {
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		margin-bottom: 1.75rem;
	}

	.inner {
		max-width: 1180px;
		margin: 0 auto;
		padding: 0.85rem 1.25rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.brand {
		font-weight: 650;
		text-decoration: none;
		color: var(--text);
	}

	nav {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.link {
		text-decoration: none;
		color: var(--muted);
	}

	.link:hover {
		color: var(--text);
	}

	.new {
		text-decoration: none;
		background: var(--accent);
		color: var(--accent-text);
		font-weight: 600;
		padding: 0.4rem 0.85rem;
		border-radius: var(--radius);
	}
</style>
