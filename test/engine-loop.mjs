// The frame loop keeps running when a frame throws: the error is logged once, counted, and the
// next frame still comes (a throw used to leave the loop without asking for one: the game froze)
import { Engine } from '../src/engine/Engine.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

const queue = [];
globalThis.requestAnimationFrame = ( fn ) => { queue.push( fn ); return queue.length; };
globalThis.cancelAnimationFrame = () => {};
const logged = [];
const realError = console.error, realWarn = console.warn;
console.error = ( ...a ) => logged.push( a );
console.warn = () => {};

const eng = Object.create( Engine.prototype );
eng.frame = 0;
eng.clock = { update() {}, getDelta: () => 1 / 60, getElapsed: () => 0 };
let calls = 0;
eng.start( () => {

	calls ++;
	if ( calls >= 3 && calls <= 6 ) throw new Error( 'boom' );

} );
for ( let i = 0; i < 10 && queue.length; i ++ ) queue.shift()( i * 16 );
console.error = realError;
console.warn = realWarn;

ok( calls === 10, `10 frames ran though 4 threw (${ calls })` );
ok( queue.length === 1, 'the next frame is still asked for' );
ok( logged.length === 1, `the error is logged once, not every frame (${ logged.length })` );
const counts = [ ...eng.frameErrors.values() ];
ok( counts.length === 1 && counts[ 0 ] === 4, `it is counted every time (${ counts })` );

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
