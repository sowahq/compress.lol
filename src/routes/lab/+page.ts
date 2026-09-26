import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = () => {
	if (!dev) {
		error(404, 'Not found');
	}
};
