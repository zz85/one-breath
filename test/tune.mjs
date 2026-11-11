// Frame statistics and the quality sweep (core/Tune.js) with a stubbed app and made-up frame times.
import { FrameStats, Tune, recommend, tuneSteps } from '../src/core/Tune.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const fs = new FrameStats( 5 );
for ( let k = 0; k < 600; k ++ ) fs.push( k % 10 === 0 ? 50 : 16 ); // 60 fps with a hitch every 10 frames
let s = fs.summary();
ok( s.median === 16 && s.p95 === 50 && s.worst === 50, `median ${ s.median }, p95 ${ s.p95 }: the hitches show in the 95th percentile` );
ok( fs.sum <= 5000 + 50 && s.frames < 600, `only the last 5 s are kept (${ s.frames } frames)` );
fs.push( 5000 );
ok( fs.summary().worst === 50, 'a frame over a second (a background tab) is ignored' );

// the sweep: a stubbed app whose frame time grows with the pixels drawn
const app = { qs: new URLSearchParams( '' ), qualityName: 'phone', settings: { renderScale: 0.6 }, sceneRenderer: { width: 0, height: 0 },
	setRenderScale( v ) { this.settings.renderScale = v; this.sceneRenderer.width = Math.round( 1600 * v ); this.sceneRenderer.height = Math.round( 740 * v ); } };
const frameMs = () => 8 + 30 * app.settings.renderScale ** 2 + ( app.qualityName === 'high' ? 10 : 0 ); // phone 0.6: 18.8 ms
const t = new Tune( app, { settle: 0.5, measure: 2 } );
let done = null;
t.onDone = ( r, b ) => { done = { r, b }; };
t.start();
for ( let k = 0; k < 20000 && t.running; k ++ ) t.update( frameMs() / 1000 );
ok( done && done.r.length === tuneSteps().length, `every step measured (${ done && done.r.length })` );
const r60 = done.r.find( ( r ) => r.preset === 'phone' && r.scale === 0.6 );
ok( Math.abs( r60.fps - 1000 / 18.8 ) < 1, `phone at 60%: ${ r60.fps.toFixed( 1 ) } fps, ${ r60.size }` );
ok( done.b.preset === 'phone' && done.b.scale === 0.75, `recommends the sharpest that holds 30 fps: ${ done.b.preset } ${ done.b.scale }` );
ok( app.qualityName === 'phone' && app.settings.renderScale === 0.75, 'and leaves it on that' );
ok( recommend( [ { preset: 'phone', scale: 0.5, fps: 12, p95: 120 }, { preset: 'phone', scale: 0.6, fps: 10, p95: 140 } ] ).scale === 0.5, 'when nothing is smooth: the fastest' );
const t2 = new Tune( app );
t2.start();
t2.update( 0.016 );
t2.cancel();
ok( app.settings.renderScale === 0.75 && ! t2.running, 'cancel puts it back' );

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
