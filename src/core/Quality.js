// Quality presets. `high` is the game as it was made; `phone` is for phones and tablets: a lower
// internal resolution (the temporal upscaler brings it back to the screen's), cheaper ambient
// occlusion, no volumetric sun shafts or screen-space water reflections, and, set once at startup,
// a smaller sun shadow map and a coarser ocean mesh.
//
// The preset is chosen once, before the world is built: ?quality=phone or ?quality=high, else
// `phone` on a device whose only pointer is a touch screen. The runtime parts (applyQuality) can
// be switched in the Performance tab; the startup parts need a reload with ?quality=.
export const QUALITY = {
	high: {
		label: 'High',
		// startup
		shadowMap: 2048, oceanGrid: 32, aoSamples: 12,
		// runtime
		renderScale: 1, shafts: true, godRays: true, ssr: true, flare: true,
	},
	phone: {
		label: 'Phone',
		shadowMap: 1024, oceanGrid: 24, aoSamples: 6,
		renderScale: 0.6, shafts: false, godRays: false, ssr: false, flare: false,
	},
};

// a touch screen and no mouse or trackpad
export function touchOnly() {

	return typeof matchMedia !== 'undefined' && matchMedia( '(pointer: coarse)' ).matches && ! matchMedia( '(any-pointer: fine)' ).matches;

}

export function pickQuality( qs ) {

	const q = qs && qs.get( 'quality' );
	if ( q && QUALITY[ q ] ) return q;
	return touchOnly() ? 'phone' : 'high';

}

// the runtime parts of a preset, on a built app (every part optional: ?noHaze etc. leave holes)
export function applyQuality( app, name ) {

	const Q = QUALITY[ name ] || QUALITY.high;
	app.qualityName = name;
	if ( app.setRenderScale ) app.setRenderScale( app.qs && app.qs.has( 'scale' ) ? Number( app.qs.get( 'scale' ) ) || Q.renderScale : Q.renderScale );
	const post = app.post;
	if ( post ) {

		if ( post.aoPass && post.aoPass.samples ) post.aoPass.samples.value = Q.aoSamples;
		if ( post.flare && post.flare.strength ) {

			if ( post._flareFull === undefined ) post._flareFull = post.flare.strength.value;
			post.flare.strength.value = Q.flare ? post._flareFull : 0;

		}

	}

	const haze = app.haze;
	if ( haze ) {

		if ( haze._shaftsFull === undefined ) haze._shaftsFull = haze.shafts.value || 1;
		haze.shafts.value = Q.shafts ? haze._shaftsFull : 0;
		haze.godRays = Q.godRays;

	}

	if ( app.waterMaterial && app.waterMaterial.params && app.waterMaterial.params.ssr ) app.waterMaterial.params.ssr.value = Q.ssr ? 1 : 0;
	return Q;

}
