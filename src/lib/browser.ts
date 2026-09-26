export const isChromiumBrowser = (): boolean => {
	try {
		return 'userAgentData' in globalThis.navigator;
	} catch {
		return false;
	}
};
