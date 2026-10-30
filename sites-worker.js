// Minimal static worker: API routes (none yet) then the built SPA assets.
export default {
	fetch(request, env) {
		return env.ASSETS.fetch(request);
	},
};
