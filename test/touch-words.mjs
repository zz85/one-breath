// The touch controls' wording of the prompts and tips (ui/TouchControls.js, game/Guide.js): plain node.
globalThis.document = undefined;
const { touchWords } = await import( '../src/ui/TouchControls.js' );
const { touchTip } = await import( '../src/game/Guide.js' );
let fails = 0;
const eq = ( a, b, msg ) => {

	if ( a !== b ) { fails ++; console.log( 'FAIL', msg, JSON.stringify( a ), '!==', JSON.stringify( b ) ); } else console.log( 'ok  ', msg );

};
eq( touchWords( 'Hold LMB' ), 'Hold Fire', 'Hold LMB' );
eq( touchWords( 'Hold R' ), 'Hold Load', 'Hold R' );
eq( touchWords( 'Hold to aim (or Q)   ·   LMB  shoot   ·   G  put the gun away' ), 'Tap to aim   ·   Fire  shoot   ·   Gun  put the gun away', 'aim prompt' );
eq( touchWords( 'Shoot   ·   Q  lower the gun' ), 'Shoot   ·   Aim  lower the gun', 'aimed prompt' );
eq( touchWords( 'Leave helm   ·   V  camera' ), 'Leave helm   ·   Cam  camera', 'helm prompt' );
eq( touchWords( 'Take out the speargun' ), 'Take out the speargun', 'words left alone' );
eq( touchTip( 'Hold <kbd>R</kbd> to pull a band back. Then dive (<kbd>C</kbd>), glide in slowly and hold the <b>right mouse button</b> to aim (on a trackpad, <kbd>Q</kbd>).' ),
	'Hold <kbd>Load</kbd> to pull a band back. Then dive (<kbd>Dive</kbd>), glide in slowly and tap <b>Aim</b>.', 'gun tip' );
eq( touchTip( '<b>Hold the left mouse button</b> to haul it in.' ), '<b>Hold Fire</b> to haul it in.', 'haul tip' );
console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
