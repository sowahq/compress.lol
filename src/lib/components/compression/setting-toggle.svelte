<script lang="ts">
	interface Props {
		id: string;
		label: string;
		description: string;
		checked: boolean;
	}

	let { id, label, description, checked = $bindable() }: Props = $props();
</script>

<div class="flex items-start space-x-3">
	<input
		type="checkbox"
		{id}
		bind:checked
		class="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
	/>
	<div class="grid gap-1">
		<label for={id} class="cursor-pointer text-sm leading-none font-medium">{label}</label>
		<p class="text-xs text-muted-foreground">{description}</p>
	</div>
</div>
