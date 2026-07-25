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
		<a class="brand" href="/">
			<img class="mark" src={favicon} alt="" width="30" height="30" />
			<span class="wordmark">fleabook</span>
		</a>
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
		display: flex;
		align-items: center;
		gap: 0.5rem;
		text-decoration: none;
	}

	.mark {
		display: block;
		flex: none;
	}

	/* Lowercase blue wordmark, tuned to evoke the Facebook logotype — a rounded
	   geometric stack where available, tight tracking. */
	.wordmark {
		font-family: 'Segoe UI', 'Helvetica Neue', 'Arial Rounded MT Bold', system-ui, sans-serif;
		font-weight: 700;
		font-size: 1.4rem;
		letter-spacing: -0.03em;
		line-height: 1;
		text-transform: lowercase;
		color: var(--accent);
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
