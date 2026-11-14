// The game modes (game/Mode.js): which one the URL or the save picks, and leisure's no-gun rule.
import * as E from '../src/engine/index.js';
import { MODES, DIFFICULTY, pickMode, saveMode } from '../src/game/Mode.js';
import { Spearfishing } from '../src/game/Spearfishing.js';
import { GameState } from '../src/game/GameState.js';

let fails = 0;
const ok = ( c, msg ) => {

	console.log( ( c ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! c ) fails ++;

};
const store = () => {

	const m = new Map();
	return { getItem: ( k ) => m.has( k ) ? m.get( k ) : null, setItem: ( k, v ) => m.set( k, String( v ) ), m };

};
const qs = ( s ) => new URLSearchParams( s );

// ---- picking
{

	const st = store();
	let c = pickMode( qs( '' ), st );
	ok( c.mode === 'leisure' && c.difficulty === 'standard' && ! c.fromURL, 'nothing saved: leisure, standard, and the menu shows' );
	c = pickMode( qs( '?mode=spear&difficulty=realistic' ), st );
	ok( c.mode === 'spear' && c.difficulty === 'realistic' && c.fromURL, '?mode=spear&difficulty=realistic' );
	c = pickMode( qs( '?mode=depth' ), st );
	ok( c.mode === 'leisure' && ! c.fromURL, '?mode=depth is locked: leisure, and the menu shows' );
	c = pickMode( qs( '?hunt=barracuda' ), st );
	ok( c.mode === 'spear' && c.fromURL, '?hunt is spearfishing' );
	saveMode( { mode: 'spear', difficulty: 'easy' }, st );
	c = pickMode( qs( '' ), st );
	ok( c.mode === 'spear' && c.difficulty === 'easy' && ! c.fromURL, 'the saved choice is preselected' );
	saveMode( { mode: 'spear', difficulty: 'relaxed' }, st );
	ok( pickMode( qs( '' ), st ).difficulty === 'easy', 'a save from when Easy was Relaxed reads as Easy' );
	ok( pickMode( qs( '?difficulty=relaxed' ), st ).difficulty === 'easy', '?difficulty=relaxed still works' );
	st.setItem( 'onebreath.mode', '{bad' );
	ok( pickMode( qs( '' ), st ).mode === 'leisure', 'a broken save: the defaults' );
	ok( pickMode( qs( '' ), null ).mode === 'leisure', 'no storage: the defaults' );
	ok( MODES.depth.locked && ! MODES.leisure.gun && MODES.spear.gun, 'depth locked, leisure without the gun' );
	ok( DIFFICULTY.easy.holdMul > DIFFICULTY.standard.holdMul && DIFFICULTY.easy.easy && DIFFICULTY.standard.holdMul > DIFFICULTY.realistic.holdMul, 'easy holds longest' );

}

// ---- leisure: G does nothing, no gun prompt
{

	const input = { enabled: true, mouseDown: false, rightDown: false, lookScale: 1, _hit: new Set(), down: () => false, hit( k ) { return this._hit.delete( k ); } };
	const player = { mode: 'swim', position: new E.Vector3( 0, - 5, 0 ), velocity: new E.Vector3(), waterH: 0, tug: new E.Vector3(), floating: false, frozen: false, swimMul: 1, surface: 'water' };
	const camera = new E.PerspectiveCamera( 60, 1.7, 0.05, 1000 );
	camera.position.copy( player.position );
	camera.updateMatrixWorld();
	const app = { scene: new E.Scene(), camera, input, player, freeCam: false, audio: null, terrainData: { heightAt: () => - 12 }, reef: null };
	const game = { app, state: new GameState( null ), hud: null, hour: 12, toast: () => {} };
	const sp = game.spear = new Spearfishing( game );
	sp.applyGear( game.state.stats );
	sp.allowGun = false;
	input._hit.add( 'KeyG' );
	sp.update( 1 / 60, { can: true, lDown: false, lHeld: false, rHeld: false, panelOpen: false } );
	ok( ! sp.equipped, 'leisure: G leaves the gun away' );
	const pr = sp.prompt();
	ok( ! pr || ! /speargun/i.test( pr.text ), 'leisure: no "Take out the speargun" prompt' );
	sp.allowGun = true;
	input._hit.add( 'KeyG' );
	sp.update( 1 / 60, { can: true, lDown: false, lHeld: false, rHeld: false, panelOpen: false } );
	ok( sp.equipped, 'spearfishing: G takes it out' );

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
