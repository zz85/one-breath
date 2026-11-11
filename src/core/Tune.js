import { QUALITY, applyQuality } from './Quality.js';

// Frame-time statistics for tuning the quality presets (core/Quality.js).
//
//   FrameStats   the last few seconds of frame times: fps, median, the 95th percentile (the hitches
//                an average hides) and the worst frame. The HUD's frame-rate panel shows them with
//                the preset, the render scale and the internal render size.
//   Tune         a sweep: each step applies a preset at a render scale, lets it settle, measures it,
//                and the results come up in a table with the setting it recommends (the sharpest
//                that holds 30 fps with its 95th percentile under 50 ms). The sweep switches the
//                runtime parts only; the shadow map and the ocean mesh stay as loaded, so run it once
//                with ?quality=phone and once with ?quality=high to compare those too.
// Start it with ?tune in the URL (it waits for the world to settle), a long press on the frame-rate
// panel on a touch screen, or __tune() in the console.
const TARGET_FPS = 30;
const TARGET_P95 = 50; // ms

export class FrameStats {

	constructor( seconds = 5, max = 1200 ) {

		this.seconds = seconds;
		this.buf = new Float32Array( max );
		this.n = 0;
		this.i = 0;
		this.sum = 0;

	}

	push( ms ) {

		if ( ! ( ms > 0 ) || ms > 1000 ) return; // a tab in the background, a debugger stop
		const B = this.buf;
		if ( this.n === B.length ) this.sum -= B[ this.i ];
		else this.n ++;
		B[ this.i ] = ms;
		this.sum += ms;
		this.i = ( this.i + 1 ) % B.length;
		// keep only the last `seconds`
		while ( this.n > 1 && this.sum - B[ ( this.i - this.n + B.length ) % B.length ] > this.seconds * 1000 ) {

			this.sum -= B[ ( this.i - this.n + B.length ) % B.length ];
			this.n --;

		}

	}

	reset() {

		this.n = 0;
		this.sum = 0;

	}

	summary() {

		const n = this.n;
		if ( ! n ) return null;
		const a = new Float32Array( n );
		const B = this.buf;
		for ( let k = 0; k < n; k ++ ) a[ k ] = B[ ( this.i - n + k + B.length ) % B.length ];
		a.sort();
		const q = ( p ) => a[ Math.min( n - 1, Math.floor( p * n ) ) ];
		return { frames: n, fps: n * 1000 / this.sum, median: q( 0.5 ), p95: q( 0.95 ), worst: a[ n - 1 ] };

	}

}

// the steps of a sweep: from the cheapest to the sharpest
export function tuneSteps() {

	return [
		{ preset: 'phone', scale: 0.5 }, { preset: 'phone', scale: 0.6 }, { preset: 'phone', scale: 0.75 },
		{ preset: 'phone', scale: 1 }, { preset: 'high', scale: 0.75 }, { preset: 'high', scale: 1 },
	];

}

// the sharpest step that is smooth enough; the cheapest one when none is
export function recommend( results ) {

	const good = results.filter( ( r ) => r.fps >= TARGET_FPS && r.p95 <= TARGET_P95 );
	const score = ( r ) => ( r.preset === 'high' ? 1 : 0 ) + r.scale;
	if ( good.length ) return good.reduce( ( a, b ) => ( score( b ) > score( a ) ? b : a ) );
	return results.reduce( ( a, b ) => ( b.fps > a.fps ? b : a ), results[ 0 ] );

}

export class Tune {

	constructor( app, { settle = 2.5, measure = 6, steps = tuneSteps() } = {} ) {

		this.app = app;
		this.settle = settle;
		this.measure = measure;
		this.steps = steps;
		this.stats = new FrameStats( measure + 1 );
		this.running = false;
		this.results = [];
		this.onDone = null;
		this.onStep = null;

	}

	start() {

		if ( this.running ) return;
		this.running = true;
		this.results = [];
		this.k = 0;
		this.t = 0;
		this._before = { preset: this.app.qualityName, scale: this.app.settings.renderScale };
		this._begin();

	}

	_begin() {

		const s = this.steps[ this.k ];
		const app = this.app;
		applyQuality( app, s.preset );
		if ( app.setRenderScale ) app.setRenderScale( s.scale );
		this.t = 0;
		this.stats.reset();
		if ( this.onStep ) this.onStep( this.k, this.steps.length, s );

	}

	// per frame, with the frame's time (s)
	update( dt ) {

		if ( ! this.running ) return;
		this.t += dt;
		if ( this.t > this.settle ) this.stats.push( dt * 1000 );
		if ( this.t < this.settle + this.measure ) return;
		const s = this.steps[ this.k ], m = this.stats.summary() || { fps: 0, median: 0, p95: 0, worst: 0, frames: 0 };
		const app = this.app;
		this.results.push( { ...s, ...m, size: app.sceneRenderer ? `${ app.sceneRenderer.width }x${ app.sceneRenderer.height }` : '' } );
		this.k ++;
		if ( this.k < this.steps.length ) {

			this._begin();
			return;

		}

		this.running = false;
		const best = recommend( this.results );
		// leave it on the recommendation
		applyQuality( app, best.preset );
		if ( app.setRenderScale ) app.setRenderScale( best.scale );
		this.best = best;
		if ( this.onDone ) this.onDone( this.results, best );

	}

	cancel() {

		if ( ! this.running ) return;
		this.running = false;
		applyQuality( this.app, this._before.preset );
		if ( this.app.setRenderScale ) this.app.setRenderScale( this._before.scale );

	}

}

// the results as a small panel (tap or click to close)
export function showResults( root, results, best, loaded ) {

	const el = document.createElement( 'div' );
	el.className = 'tw-tune tw-glass tw-interactive';
	const row = ( r ) => `<tr class="${ r === best ? 'is-best' : '' }"><td>${ QUALITY[ r.preset ].label }</td><td>${ Math.round( r.scale * 100 ) }%</td><td>${ r.size }</td><td>${ r.fps.toFixed( 0 ) }</td><td>${ r.median.toFixed( 1 ) }</td><td>${ r.p95.toFixed( 1 ) }</td><td>${ r.worst.toFixed( 0 ) }</td></tr>`;
	el.innerHTML = `
		<style>
		.tw-tune { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: var(--tw-4) var(--tw-5); border-radius: 14px;
			font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); max-width: 94vw; }
		.tw-tune h3 { margin: 0 0 var(--tw-2); font-size: calc(16 * var(--tw-u)); }
		.tw-tune p { margin: var(--tw-2) 0 0; color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
		.tw-tune table { border-collapse: collapse; font-family: var(--tw-mono); font-size: var(--tw-fs-sm); }
		.tw-tune td, .tw-tune th { padding: 3px 10px 3px 0; text-align: right; }
		.tw-tune th { color: var(--tw-ink-3); font-weight: 500; }
		.tw-tune td:first-child, .tw-tune th:first-child { text-align: left; }
		.tw-tune tr.is-best td { color: var(--tw-aqua); }
		</style>
		<h3>Frame rate by setting</h3>
		<table><tr><th>Preset</th><th>Scale</th><th>Render</th><th>fps</th><th>median</th><th>p95 ms</th><th>worst</th></tr>${ results.map( row ).join( '' ) }</table>
		<p>Now on <b>${ QUALITY[ best.preset ].label } at ${ Math.round( best.scale * 100 ) }%</b>: the sharpest that holds ${ TARGET_FPS } fps with 95% of frames under ${ TARGET_P95 } ms.
		Shadow map and ocean mesh as loaded (${ QUALITY[ loaded ].label }): compare with <code>?quality=${ loaded === 'phone' ? 'high' : 'phone' }&tune</code>. Tap to close.</p>`;
	el.addEventListener( 'pointerdown', ( e ) => {

		e.stopPropagation();
		el.remove();

	} );
	root.append( el );
	return el;

}
