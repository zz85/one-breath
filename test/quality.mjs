// Quality presets (core/Quality.js): picking one, and its runtime parts on a stubbed app.
import { QUALITY, pickQuality, applyQuality } from '../src/core/Quality.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
const media = ( coarse, fine ) => {

	globalThis.matchMedia = ( q ) => ( { matches: q === '(pointer: coarse)' ? coarse : q === '(any-pointer: fine)' ? fine : false } );

};

media( false, true );
ok( pickQuality( new URLSearchParams( '' ) ) === 'high', 'a desktop picks high' );
media( true, false );
ok( pickQuality( new URLSearchParams( '' ) ) === 'phone', 'a touch-only device picks phone' );
media( true, true );
ok( pickQuality( new URLSearchParams( '' ) ) === 'high', 'a touch laptop with a trackpad picks high' );
ok( pickQuality( new URLSearchParams( '?quality=phone' ) ) === 'phone' && pickQuality( new URLSearchParams( '?quality=nope' ) ) === 'high', '?quality= wins, an unknown one is ignored' );
ok( QUALITY.phone.shadowMap < QUALITY.high.shadowMap && QUALITY.phone.oceanGrid < QUALITY.high.oceanGrid && QUALITY.phone.aoSamples < QUALITY.high.aoSamples, 'phone is cheaper at startup' );

const v = ( x ) => ( { value: x } );
const mk = ( qs = '' ) => {

	const app = {
		qs: new URLSearchParams( qs ), scale: 1,
		setRenderScale( s ) { this.scale = s; },
		post: { aoPass: { samples: v( 12 ) }, flare: { strength: v( 0.8 ) } },
		haze: { shafts: v( 1 ), godRays: true },
		waterMaterial: { params: { ssr: v( 1 ) } },
	};
	return app;

};

const a = mk();
applyQuality( a, 'phone' );
ok( a.scale === 0.6 && a.post.aoPass.samples.value === 6 && a.haze.shafts.value === 0 && ! a.haze.godRays && a.waterMaterial.params.ssr.value === 0 && a.post.flare.strength.value === 0, 'phone: 60% scale, 6 AO samples, no shafts, god rays, reflections or flare' );
applyQuality( a, 'high' );
ok( a.scale === 1 && a.post.aoPass.samples.value === 12 && a.haze.shafts.value === 1 && a.haze.godRays && a.waterMaterial.params.ssr.value === 1 && a.post.flare.strength.value === 0.8, 'back to high restores each of them' );
const b = mk( '?scale=0.8' );
applyQuality( b, 'phone' );
ok( b.scale === 0.8, '?scale= wins over the preset\'s render scale' );
const c = { qs: new URLSearchParams( '' ), setRenderScale() {} };
applyQuality( c, 'phone' );
ok( c.qualityName === 'phone', 'an app without haze / post (?noHaze) is fine' );

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
