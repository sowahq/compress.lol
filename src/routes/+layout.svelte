<script lang="ts">
	import '../app.css';
	import { dev } from '$app/environment';
	import { UMAMI_HOST_URL, UMAMI_SCRIPT_URL, UMAMI_WEBSITE_ID } from '$lib/analytics';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.ico" sizes="32x32" />
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	{#if !dev}
		<script
			defer
			src={UMAMI_SCRIPT_URL}
			data-website-id={UMAMI_WEBSITE_ID}
			data-host-url={UMAMI_HOST_URL}
		></script>
	{/if}
</svelte:head>

{@render children?.()}
