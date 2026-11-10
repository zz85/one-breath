// The spearfishing controller (game/Spearfishing.js) end to end in plain node: a diver 6 m down
// with a jack swimming across in front. Load, aim, shoot, haul, grab; a miss and the haul back;
// a protected fish; a blackout. The world is stubbed: flat sand at -12 m, a still sea, and a fish
// school object with the arrays and calls world/Fish.js gives the game.
import * as E from '../src/engine/index.js';
import { Spearfishing } from '../src/game/Spearfishing.js';
import { GameState } from '../src/game/GameState.js';
import { Whale } from '../src/world/marine/Whale.js';
import { readFileSync } from 'node:fs';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};

function makeFish( list ) {

	const n = list.length;
	const F = {
		pos: new Float32Array( n * 3 ), vel: new Float32Array( n * 3 ), head: new Float32Array( n * 3 ), size: new Float32Array( n ),
		panic: new Float32Array( n ), ampMul: new Float32Array( n ).fill( 1 ), pinned: new Uint8Array( n ), gone: new Uint8Array( n ),
		sp: list.map( ( f ) => ( { name: f.name, model: f.model } ) ), wary: 1, onStep: null, scared: 0,
		speciesOf( i ) { return this.sp[ i ]; },
		forEachNear( p, r, fn ) {

			for ( let i = 0; i < n; i ++ ) {

				if ( this.gone[ i ] ) continue;
				const d = Math.hypot( this.pos[ i * 3 ] - p.x, this.pos[ i * 3 + 1 ] - p.y, this.pos[ i * 3 + 2 ] - p.z );
				if ( d <= r ) fn( i, this.sp[ i ], d );

			}

		},
		scare() { this.scared ++; },
		pin( i, on = true ) { this.pinned[ i ] = on ? 1 : 0; },
		remove( i ) { this.gone[ i ] = 1; this.pinned[ i ] = 0; },
		restore( i ) { this.gone[ i ] = 0; },
		// a free fish swims along its heading
		step( dt ) {

			for ( let i = 0; i < n; i ++ ) {

				if ( this.pinned[ i ] || this.gone[ i ] ) continue;
				for ( let k = 0; k < 3; k ++ ) this.pos[ i * 3 + k ] += this.vel[ i * 3 + k ] * dt;

			}

			if ( this.onStep ) this.onStep( dt );

		},
	};
	list.forEach( ( f, i ) => {

		F.pos.set( f.p, i * 3 );
		F.head.set( f.h, i * 3 );
		F.vel.set( f.h.map( ( x ) => x * ( f.speed || 0 ) ), i * 3 );
		F.size[ i ] = f.L;

	} );
	return F;

}

// the humpback with its rig and hull from the baked model, without the GPU material: the brain
// and the pose run on the CPU as in the game
function makeWhale() {

	const dir = new URL( '../public/models/whale/', import.meta.url ).pathname;
	const m = JSON.parse( readFileSync( dir + 'humpback.json' ) ), b = readFileSync( dir + 'humpback.bin' );
	const w = new Whale( { scene: new E.Scene(), terrain: { heightAt: () => - 40 } } );
	w.manifest = m;
	w._setupRig( m );
	w._setupHull( m, b.buffer.slice( b.byteOffset, b.byteOffset + b.byteLength ) );
	w.ready = true;
	w._pose();
	w.step = ( dt ) => { w.brain.update( dt ); w._pose(); };
	return w;

}

function makeWorld( fishList, { depth = 6, whale = null } = {} ) {

	const scene = new E.Scene();
	const camera = new E.PerspectiveCamera( 60, 1.7, 0.05, 1000 );
	const keys = new Set();
	const input = { enabled: true, mouseDown: false, rightDown: false, lookScale: 1, _hit: new Set(), down: ( k ) => keys.has( k ), hit( k ) { return this._hit.delete( k ); } };
	const player = { mode: 'swim', position: new E.Vector3( 0, - depth, 0 ), velocity: new E.Vector3(), waterH: 0, tug: new E.Vector3(), floating: false, frozen: false, swimMul: 1, surface: 'water' };
	const fish = makeFish( fishList );
	const app = {
		scene, camera, input, player, freeCam: false, audio: null,
		terrainData: { heightAt: () => - 12 },
		reef: { fish, floorHeightAt: () => whale ? - 40 : - 12 },
		whale,
	};
	if ( whale ) app.terrainData = { heightAt: () => - 40 };
	const toasts = [];
	const game = { app, state: new GameState( null ), hud: null, hour: 12, toast: ( t ) => toasts.push( t ) };
	const sp = new Spearfishing( game );
	sp.applyGear( game.state.stats );
	const W = {
		sp, game, app, fish, keys, input, player, toasts, look: new E.Vector3( 0, 0, - 1 ),
		// one frame: the player (stubbed: follows its tug), the camera at the eye, the game, the fish
		frame( dt = 1 / 60, { lmb = false, rmb = false, r = false } = {} ) {

			if ( r ) keys.add( 'KeyR' ); else keys.delete( 'KeyR' );
			input.rightDown = rmb;
			const lDown = lmb && ! W._lmb;
			W._lmb = lmb;
			player.position.addScaledVector( player.tug, dt );
			camera.position.copy( player.position );
			camera.lookAt( player.position.x + W.look.x, player.position.y + W.look.y, player.position.z + W.look.z );
			camera.updateMatrixWorld();
			sp.update( dt, { can: true, lDown, lHeld: lmb, rHeld: r, panelOpen: false } );
			fish.step( dt );
			if ( whale ) whale.step( dt );

		},
		run( s, opts ) {

			for ( let t = 0; t < s; t += 1 / 60 ) W.frame( 1 / 60, opts );

		},
	};
	return W;

}

// ---- a jack crossing 2.5 m ahead: load both bands, aim, shoot, fight, haul, grab
{

	const W = makeWorld( [ { name: 'jack', model: 'jack', L: 0.55, p: [ 0, - 6.05, - 2.6 ], h: [ 1, 0, 0 ], speed: 0 } ] );
	const { sp, input, fish, game } = W;
	game.state.upgrades.gun = 1; // the 90 cm two-band teak gun
	sp.applyGear( game.state.stats );
	input._hit.add( 'KeyG' );
	W.frame();
	ok( sp.equipped, 'G takes the gun out' );
	W.run( 1.6, { r: true } );
	ok( sp.gun.bandsLoaded === 1, 'holding R loads one band' );
	W.run( 1.6, { r: true } );
	ok( sp.gun.bandsLoaded === 2, 'and the second' );
	// Q raises the gun and keeps it up (a trackpad has no held right button); Q again lowers it
	input._hit.add( 'KeyQ' );
	W.frame();
	W.run( 0.3 );
	ok( sp.aiming && input.lookScale < 1, `Q raises the gun to aim (look ${ input.lookScale })` );
	input._hit.add( 'KeyQ' );
	W.frame();
	ok( ! sp.aiming && input.lookScale === 1, 'Q again lowers it' );
	W.run( 0.6, { rmb: true } );
	// line the fish's middle up on the shaft's path: move it to where the shaft points at 2.6 m
	const g = sp.gun;
	const at = g.muzzle.clone().addScaledVector( g.forward, 2.0 );
	fish.pos.set( [ at.x, at.y - 0.015, at.z ], 0 ); // on the shaft's line, less its small drop over 2 m
	W.frame( 1 / 60, { rmb: true, lmb: true } );
	ok( sp.phase === 'flying' || sp.phase === 'fight', `LMB shoots (${ sp.phase })` );
	W.run( 0.3, { rmb: true } );
	ok( sp.phase === 'fight' && fish.pinned[ 0 ] === 1, `the shaft hits the jack (${ sp.phase }, zone ${ sp.target && sp.target.zone })` );
	ok( sp.target && sp.target.through, 'from 2 m with two bands it goes through' );
	ok( W.toasts.some( ( t ) => /Crevalle jack/.test( t ) ), `the hit is called: "${ W.toasts.at( - 1 ) }"` );
	// the shaft is drawn through the fish
	const tip = g.tip( new E.Vector3() );
	const fp = new E.Vector3( fish.pos[ 0 ], fish.pos[ 1 ], fish.pos[ 2 ] );
	ok( tip.distanceTo( fp ) < 0.6, `the shaft's tip is at the fish (${ tip.distanceTo( fp ).toFixed( 2 ) } m)` );
	// tire it out with the line held, then haul
	let maxTug = 0;
	for ( let t = 0; t < 8 && sp.phase === 'fight'; t += 1 / 60 ) {

		W.frame( 1 / 60 );
		maxTug = Math.max( maxTug, W.player.tug.length() );

	}

	ok( sp.phase === 'fight' || sp.target === null, 'it fights on the line' );
	if ( sp.target && sp.target.zone !== 'brain' && sp.target.zone !== 'spine' ) ok( maxTug > 0.05, `a running jack tows the diver (${ maxTug.toFixed( 2 ) } m/s)` );
	for ( let t = 0; t < 20 && sp.phase === 'fight' && sp.fight.lineOut > 1.05; t += 1 / 60 ) {

		const F = sp.fight;
		W.frame( 1 / 60, { lmb: F.tension < F.holdN * 0.6 } );

	}

	ok( sp.phase === 'fight' && sp.fight.lineOut <= 1.05, `hauled in to arm's length (${ sp.fight && sp.fight.lineOut.toFixed( 2 ) } m)` );
	for ( let k = 0; k < 12 && sp.phase === 'fight'; k ++ ) {

		input._hit.add( 'KeyE' );
		W.frame();
		W.run( 0.5 );

	}

	ok( sp.phase === 'home' && fish.gone[ 0 ] === 1, 'E grabs and dispatches it' );
	ok( game.state.inventory.length === 1 && game.state.inventory[ 0 ].species === 'jack', `on the stringer: ${ game.state.inventory.map( ( f ) => `${ f.species } ${ f.kg } kg $${ f.value }` ).join( ', ' ) }` );
	ok( sp.gun.shaftHome && sp.gun.bandsLoaded === 0, 'the shaft is back in the gun, unloaded' );

}

// ---- a miss: the shaft flies to the end of its line and is hauled back
{

	const W = makeWorld( [ { name: 'jack', model: 'jack', L: 0.5, p: [ 20, - 6, - 20 ], h: [ 1, 0, 0 ] } ] );
	const { sp, input } = W;
	input._hit.add( 'KeyG' );
	W.frame();
	W.run( 3.2, { r: true } );
	W.frame( 1 / 60, { lmb: true } );
	W.run( 1.5 );
	ok( sp.phase === 'out', `a miss leaves the shaft out (${ sp.phase })` );
	const reach = sp.gun.shaftPos.distanceTo( sp.gun.lineClip );
	ok( reach <= sp.lineMax + 0.01 && reach > sp.lineMax * 0.7, `the line stopped it at ${ reach.toFixed( 2 ) } m (line ${ sp.lineMax.toFixed( 2 ) } m)` );
	W.run( 6, { lmb: true } );
	ok( sp.phase === 'home' && sp.gun.shaftHome, 'hauling the line brings the shaft home' );

}

// ---- shooting at the surface, out of the water: refused
{

	const W = makeWorld( [], { depth: - 0.5 } );
	const { sp, input } = W;
	W.player.mode = 'walk';
	input._hit.add( 'KeyG' );
	W.frame();
	W.run( 1.6, { r: true } );
	W.frame( 1 / 60, { lmb: true } );
	ok( sp.phase === 'home' && sp.gun.bandsLoaded === 1, 'no shot with the muzzle out of the water' );

}

// ---- a protected species: a fine and no fish
{

	const W = makeWorld( [ { name: 'grouper', model: 'grouper', L: 0.75, p: [ 0, - 6.05, - 2 ], h: [ 1, 0, 0 ] } ] );
	const { sp, input, fish, game } = W;
	game.state.money = 1000;
	input._hit.add( 'KeyG' );
	W.frame();
	W.run( 1.6, { r: true } );
	W.run( 0.6, { rmb: true } );
	const g = sp.gun, at = g.muzzle.clone().addScaledVector( g.forward, 1.4 );
	fish.pos.set( [ at.x - 0.02 * 0.75, at.y + 0.01, at.z ], 0 );
	W.frame( 1 / 60, { rmb: true, lmb: true } );
	W.run( 0.3 );
	ok( sp.phase === 'fight', `hit the grouper (${ sp.phase })` );
	for ( let t = 0; t < 40 && sp.phase === 'fight'; t += 1 / 60 ) {

		const F = sp.fight;
		if ( F.lineOut <= 1.05 && ( F.stamina < 0.3 || F.stoned ) ) input._hit.add( 'KeyE' );
		W.frame( 1 / 60, { lmb: F.tension < F.holdN * 0.5 } );

	}

	ok( game.state.inventory.length === 0 && game.state.money === 500, `no grouper on the stringer, fined $500 (purse $${ game.state.money })` );

}

// ---- a shot at the humpback: the fine, the flinch and the dive; a strong gun's shaft lodges in
// the blubber and rips out when the line comes tight, a weak one skips off the skin
for ( const gunLevel of [ 2, 0 ] ) {

	const whale = makeWhale();
	const W = makeWorld( [ { name: 'grunt', model: 'grunt', L: 0.25, p: [ 500, - 6, 500 ], h: [ 1, 0, 0 ] } ], { whale } );
	const { sp, input, game } = W;
	game.state.money = 8000;
	game.state.upgrades.gun = gunLevel;
	game.state.upgrades.shaft = gunLevel ? 2 : 0;
	sp.applyGear( game.state.stats );
	input._hit.add( 'KeyG' );
	W.frame();
	W.run( 3.4, { r: true } );
	const B = whale.brain;
	// 2 m off its left flank, level with the middle of the body, square on
	const place = () => {

		const k = whale.rootIndex - 2;
		const fwd = new E.Vector3( 0, 0, 1 ).applyQuaternion( whale.rot[ k ] );
		const left = new E.Vector3( 1, 0, 0 ).applyQuaternion( whale.rot[ k ] );
		W.player.position.copy( whale.pos[ k ] ).addScaledVector( left, 3.2 ).addScaledVector( fwd, 0.5 );
		W.look.copy( left ).negate();

	};

	place();
	W.run( 0.6, { rmb: true } );
	place();
	const before = { money: game.state.money, fines: game.state.fines || 0, depth: B.water - B.y };
	W.frame( 1 / 60, { rmb: true, lmb: true } );
	for ( let t = 0; t < 0.4 && sp.phase === 'flying'; t += 1 / 60 ) W.frame();
	const label = gunLevel ? 'carbon gun' : 'wooden gun';
	ok( ( game.state.fines || 0 ) - before.fines === 5000, `${ label }: a shot at the whale is fined $5,000 (${ ( game.state.fines || 0 ) - before.fines })` );
	ok( W.toasts.some( ( t ) => /Humpback whales are protected/.test( t ) ), `${ label }: the fine is called: "${ W.toasts.at( - 1 ) }"` );
	ok( B.state === 'startled' && B.flinch > 0.5, `${ label }: the whale flinches and breaks off (${ B.state }, flinch ${ B.flinch.toFixed( 2 ) })` );
	if ( gunLevel ) {

		ok( sp.phase === 'whale', `the carbon gun's shaft lodges in the blubber (${ sp.phase })` );
		let maxTug = 0;
		for ( let t = 0; t < 6 && sp.phase === 'whale'; t += 1 / 60 ) {

			W.frame();
			maxTug = Math.max( maxTug, W.player.tug.length() );

		}

		ok( sp.phase === 'out' && ! sp.whaleHit, `the whale tows the line tight and the shaft rips out (${ sp.phase })` );
		ok( maxTug > 1.5, `the diver is yanked toward the whale first (${ maxTug.toFixed( 1 ) } m/s)` );

	} else ok( sp.phase === 'out', `the wooden gun's shaft skips off the skin (${ sp.phase })` );
	let vMax = 0;
	for ( let t = 0; t < 12; t += 1 / 60 ) {

		W.frame();
		vMax = Math.max( vMax, B.speed );

	}

	ok( B.water - B.y > before.depth + 4, `it sounds: ${ before.depth.toFixed( 1 ) } m -> ${ ( B.water - B.y ).toFixed( 1 ) } m deep` );
	ok( vMax > 4, `and swims off fast (${ vMax.toFixed( 1 ) } m/s at most, cruising ${ 2.6 })` );
	// it comes back to its route's cruise in time
	W.run( 75 );
	ok( B.state === 'cruise', `after a while it settles back to cruising (${ B.state })` );

}

// ---- pushing a dive too long: blackout, the buddy brings you up
{

	const W = makeWorld( [], { depth: 8 } );
	const { sp, player } = W;
	let t = 0;
	while ( sp.phase !== 'blackout' && t < 200 ) {

		W.frame( 0.05 );
		t += 0.05;

	}

	ok( sp.phase === 'blackout' && t > 50, `a still diver at 8 m blacks out after ${ t.toFixed( 0 ) } s` );
	W.run( 6 );
	ok( sp.phase === 'home' && Math.abs( player.position.y ) < 0.1 && ! player.frozen, 'and wakes at the surface' );

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
