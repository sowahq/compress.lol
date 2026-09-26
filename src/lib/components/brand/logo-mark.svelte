<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';

	let { class: className, ...rest }: SVGAttributes<SVGSVGElement> = $props();
</script>

<svg viewBox="8.5 4.4 56 56" class={className} aria-hidden="true" {...rest}>
	<path
		d="M42 20.5 A15 15 0 1 0 42 43.5"
		fill="none"
		stroke="currentColor"
		stroke-width="10"
		stroke-linecap="round"
	/>
	<circle cx="53" cy="45" r="6.5" class="fill-brand" stroke="currentColor" stroke-width="2.5" />
</svg>
