<script lang="ts">
	import '../app.css';
	import { dev } from '$app/environment';
	import { env } from '$env/dynamic/public';
	import { UMAMI_HOST_URL, UMAMI_SCRIPT_URL } from '$lib/analytics';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/favicon.ico" sizes="32x32" />
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	{#if !dev && env.PUBLIC_UMAMI_WEBSITE_ID}
		<script
			defer
			src={UMAMI_SCRIPT_URL}
			data-website-id={env.PUBLIC_UMAMI_WEBSITE_ID}
			data-host-url={UMAMI_HOST_URL}
		></script>
	{/if}
</svelte:head>

{@render children?.()}
