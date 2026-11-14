// The spearfishing controller (game/Spearfishing.js) end to end in plain node: a diver 6 m down
// with a jack swimming across in front. Load, aim, shoot, haul, grab; a miss and the haul back;
// a protected fish; a blackout. The world is stubbed: flat sand at -12 m, a still sea, and a fish
// school object with the arrays and calls world/Fish.js gives the game.
import * as E from '../src/engine/index.js';
import { Spearfishing } from '../src/game/Spearfishing.js';
import { GameState } from '../src/game/GameState.js';
import { Practice } from '../src/game/Practice.js';
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
		groups: list.map( ( f, i ) => ( { sp: { name: f.name }, count: 1, center: { x: f.p[ 0 ], y: f.p[ 1 ], z: f.p[ 2 ] }, offset: i } ) ),
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

function makeWorld( fishList, { depth = 6, whale = null, reefAt = null } = {} ) {

	const scene = new E.Scene();
	const camera = new E.PerspectiveCamera( 60, 1.7, 0.05, 1000 );
	const keys = new Set();
	const input = { enabled: true, mouseDown: false, rightDown: false, lookScale: 1, _hit: new Set(), down: ( k ) => keys.has( k ), hit( k ) { return this._hit.delete( k ); } };
	const player = { mode: 'swim', position: new E.Vector3( 0, - depth, 0 ), velocity: new E.Vector3(), waterH: 0, tug: new E.Vector3(), floating: false, frozen: false, swimMul: 1, surface: 'water' };
	const fish = makeFish( fishList );
	const app = {
		scene, camera, input, player, freeCam: false, audio: null,
		terrainData: { heightAt: () => - 12 },
		reef: { fish, floorHeightAt: reefAt || ( () => whale ? - 40 : - 12 ) },
		whale,
	};
	if ( whale ) app.terrainData = { heightAt: () => - 40 };
	const toasts = [];
	const game = { app, state: new GameState( null ), hud: null, hour: 12, toast: ( t ) => toasts.push( t ) };
	const sp = game.spear = new Spearfishing( game );
	sp.applyGear( game.state.stats );
	// gear bought later applies at once, as Game.applyGear does
	game.state.onChange( () => sp.applyGear( game.state.stats ) );
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

// ---- ?hunt: practice mode puts you by the fish with the gun loaded, calm fish, endless air
{

	const W = makeWorld( [ { name: 'jack', model: 'jack', L: 0.5, p: [ 30, - 7, 40 ], h: [ 1, 0, 0 ] }, { name: 'grunt', model: 'grunt', L: 0.2, p: [ - 20, - 4, 10 ], h: [ 1, 0, 0 ] } ], { depth: - 1 } );
	const { sp, game, app, player } = W;
	player.mode = 'walk';
	Object.assign( player, { yaw: 0, pitch: 0 } );
	app.qs = new URLSearchParams( '?hunt&gear' );
	game.state.money = 0;
	const pr = new Practice( game );
	pr.update();
	const d = Math.hypot( player.position.x - 30, player.position.z - 40 );
	ok( player.mode === 'swim' && Math.abs( d - 3 ) < 0.01 && Math.abs( player.position.y + 7 ) < 0.01, `?hunt: swimming 3 m from the jacks at their depth (${ d.toFixed( 2 ) } m, y ${ player.position.y.toFixed( 1 ) })` );
	const fx = - Math.sin( player.yaw ), fz = - Math.cos( player.yaw );
	ok( ( fx * ( 30 - player.position.x ) + fz * ( 40 - player.position.z ) ) / d > 0.99, 'facing them' );
	ok( sp.equipped && sp.gun.bandsLoaded === sp.stats.bands && sp.stats.bands === 2, 'gun out, both bands loaded' );
	ok( game.state.upgrades.gun === 2 && game.state.upgrades.reel === 1 && game.state.upgrades.fins === 2, '&gear: the best gun, a reel, carbon fins' );
	ok( game.state.money === 0, `&gear costs nothing and leaves no cash (purse $${ game.state.money })` );
	new Practice( game );
	ok( game.state.money === 0, 'a second &gear (a reload) adds nothing' );
	W.run( 90 );
	ok( ! sp.apnea.blackout && sp.phase !== 'blackout' && W.fish.wary === 0.25, `endless breath after 90 s, calm fish (wary ${ W.fish.wary })` );
	ok( pr.goTo( 'grunt', 2 ).includes( 'grunt' ) && Math.hypot( player.position.x + 20, player.position.z - 10 ) < 2.01, '__hunt( grunt, 2 ) moves you to the grunts' );
	ok( /No tuna/.test( pr.goTo( 'tuna' ) ), 'an unknown kind says so' );
	ok( pr.goTo( 'list' ) === 'jack, grunt', 'list names the kinds' );
	const W2 = makeWorld( [] );
	W2.app.qs = new URLSearchParams( '' );
	const p2 = new Practice( W2.game );
	ok( ! p2.on && ! W2.sp.practice, 'without ?hunt nothing changes' );

}

// ---- after the shot: what a speared fish does (small ones barely fight, big ones run, some hole up)

// shoot fish 0 of a world from where the diver is, aimed at its middle (a body shot), the gun loaded
function shootAt( W, { upgrades = {} } = {} ) {

	const { sp, input, fish, game } = W;
	Object.assign( game.state.upgrades, upgrades );
	sp.applyGear( game.state.stats );
	input._hit.add( 'KeyG' );
	W.frame();
	sp.gun.bandsLoaded = sp.stats.bands;
	input._hit.add( 'KeyQ' );
	W.frame();
	W.run( 0.6 );
	const g = sp.gun, at = g.muzzle.clone().addScaledVector( g.forward, 1.8 );
	fish.pos.set( [ at.x, at.y - 0.012, at.z ], 0 );
	// no hand wobble or random spread on the shot: these tests are about what comes after
	const rnd = Math.random;
	Math.random = () => 0.5;
	W.frame( 1 / 60, { lmb: true } );
	W.run( 0.3 );
	Math.random = rnd;
	return sp.phase;

}

// a small grunt: a short haul and a grab, no fight
{

	const W = makeWorld( [ { name: 'grunt', model: 'grunt', L: 0.28, p: [ 0, - 6, - 2 ], h: [ 1, 0, 0 ] } ] );
	const { sp, input, game } = W;
	ok( shootAt( W ) === 'fight' && sp.fight.quick && ! sp.fight.big, `a ${ sp.fight && sp.fight.kg.toFixed( 2 ) } kg grunt: a quick one, no run` );
	let t = 0, maxPull = 0;
	for ( ; t < 6 && sp.fishDistance() > 1.15; t += 1 / 60 ) {

		W.frame( 1 / 60, { lmb: true } );
		maxPull = Math.max( maxPull, sp.fight.tension );

	}

	ok( t < 2.5 && maxPull < sp.fight.holdN * 0.3, `hauled to hand in ${ t.toFixed( 1 ) } s, never near tearing (${ maxPull.toFixed( 0 ) } of ${ sp.fight.holdN.toFixed( 0 ) } N)` );
	ok( sp.cue() && sp.cue().text === 'In reach', `the cue: "${ sp.cue() && sp.cue().text }"` );
	input._hit.add( 'KeyE' );
	W.frame();
	ok( sp.phase === 'home' && game.state.inventory.length === 1, 'E takes it at the first try' );

}

// a big jack, no float line: holding on tows you toward it; let go and it takes the gun
{

	const W = makeWorld( [ { name: 'jack', model: 'jack', L: 0.75, p: [ 0, - 6, - 2 ], h: [ 1, 0, 0 ] } ] );
	const { sp, input, player } = W;
	shootAt( W );
	ok( sp.phase === 'fight' && sp.fight.big && sp.fight.kg > 4, `a ${ sp.fight.kg.toFixed( 1 ) } kg jack is a big one (${ sp.target.zone })` );
	let towed = 0, toward = 0;
	for ( let t = 0; t < 1.5 && sp.phase === 'fight'; t += 1 / 60 ) {

		W.frame( 1 / 60 );
		const F = sp.fight, d = new E.Vector3( F.p.x, F.p.y, F.p.z ).sub( player.position );
		if ( player.tug.length() > towed ) {

			towed = player.tug.length();
			toward = player.tug.clone().normalize().dot( d.normalize() );

		}

	}

	ok( towed > 0.1 && toward > 0.8, `holding on, it tows you toward it (${ towed.toFixed( 2 ) } m/s, ${ toward.toFixed( 2 ) })` );
	ok( sp.cue() && /Pulling hard|running|tearing/.test( sp.cue().text ), `the cue: "${ sp.cue() && sp.cue().text }"` );
	input._hit.add( 'KeyG' );
	W.frame();
	ok( sp.phase === 'loose' && sp.loose && ! sp.loose.float && sp.gun.loose, 'G lets go of the gun' );
	const g0 = sp.loose.gun.p.clone();
	W.run( 4 );
	ok( sp.loose.gun.p.distanceTo( g0 ) > 1.5, `the jack tows the gun away (${ sp.loose.gun.p.distanceTo( g0 ).toFixed( 1 ) } m)` );
	ok( player.tug.length() === 0, 'and no longer you' );
	ok( /Your gun/.test( sp.cue().text ), `the cue says where it is: "${ sp.cue().text }"` );
	W.run( 20 );
	player.position.copy( sp.loose.gun.p ).add( new E.Vector3( 0.4, 0, 0 ) );
	input._hit.add( 'KeyE' );
	W.frame();
	ok( sp.phase === 'fight' && ! sp.loose && sp.fight, 'swim to the gun, E: back in hand, the fish still on' );

}

// a big jack on a float line: let go, the float tires it, pull it in from the surface, breathing
{

	const W = makeWorld( [ { name: 'jack', model: 'jack', L: 0.75, p: [ 0, - 6, - 2 ], h: [ 1, 0, 0 ] } ] );
	const { sp, input, player, game } = W;
	shootAt( W, { upgrades: { float: 1 } } );
	input._hit.add( 'KeyG' );
	W.frame();
	ok( sp.phase === 'loose' && sp.loose.float && Math.abs( sp.loose.float.p.y ) < 1e-6, 'G lets go: the float is at the surface above you' );
	W.run( 20 );
	const F = sp.fight;
	ok( F && F.result !== 'free' && F.stamina < 0.2, `towing the gun and the float tires it (stamina ${ F && F.stamina.toFixed( 2 ) }) without tearing the shaft (tear ${ F && F.tear.toFixed( 2 ) })` );
	// up for air, to the float
	sp.apnea.o2 = 0.1;
	player.position.set( sp.loose.float.p.x + 0.5, 0, sp.loose.float.p.z );
	input._hit.add( 'KeyE' );
	W.frame();
	ok( sp.loose && sp.loose.float.held, 'at the float, E takes the float line' );
	let t = 0;
	for ( ; t < 60 && sp.phase === 'loose'; t += 1 / 60 ) W.frame( 1 / 60, { lmb: true } );
	ok( sp.phase === 'fight', `pulled the line in from the top: the gun is back in hand after ${ t.toFixed( 0 ) } s` );
	ok( sp.apnea.o2 > 0.2, `breathing all the while (O2 ${ sp.apnea.o2.toFixed( 3 ) })` );
	for ( t = 0; t < 20 && sp.phase === 'fight' && sp.fishDistance() > 1.15; t += 1 / 60 ) W.frame( 1 / 60, { lmb: sp.fight.tension < sp.fight.holdN * 0.5 } );
	for ( let k = 0; k < 8 && sp.phase === 'fight'; k ++ ) {

		input._hit.add( 'KeyE' );
		W.frame();

	}

	ok( game.state.inventory.length === 1 && game.state.inventory[ 0 ].species === 'jack', `landed: ${ game.state.inventory.map( ( f ) => `${ f.species } ${ f.kg } kg` ) }` );

}

// a snapper over the reef bolts into a coral head and wedges itself in
{

	// a coral head 1.4 m high, 1.5 m across, beside the fish
	const head = { x: 0.8, z: - 2.2 };
	const reefAt = ( x, z ) => Math.hypot( x - head.x, z - head.z ) < 0.75 ? - 8.6 : - 10;
	const mk = () => {

		const W = makeWorld( [ { name: 'yellowtail', model: 'yellowtail', L: 0.36, p: [ 0, - 8, - 2 ], h: [ 1, 0, 0 ] } ], { depth: 8, reefAt } );
		W.app.terrainData = { heightAt: () => - 10 };
		W.sp.rng = () => 0.01; // it always holes when it can
		return W;

	};

	let W = mk();
	shootAt( W );
	ok( W.sp.fight && W.sp.fight.holeState === 'going', `speared, it bolts for the reef (${ W.sp.fight && W.sp.fight.holeState })` );
	W.run( 3 );
	ok( W.sp.fight.wedged, 'and wedges itself in' );
	let t = 0;
	for ( ; t < 10 && W.sp.phase === 'fight'; t += 1 / 60 ) W.frame( 1 / 60, { lmb: true } );
	ok( W.sp.phase === 'out' && ! W.sp.fight, `hauling on it tears the shaft out (${ t.toFixed( 1 ) } s)` );

	W = mk();
	shootAt( W );
	W.run( 3 );
	const F = W.sp.fight;
	const fishAt = () => new E.Vector3( F.p.x, F.p.y, F.p.z );
	// the diver's hand ahead of the eye (the camera looks along -z)
	const beside = () => W.player.position.copy( fishAt() ).add( new E.Vector3( 0, 0.2, 0.45 ) );
	beside();
	W.frame();
	W.input._hit.add( 'KeyE' );
	W.frame();
	ok( W.sp.phase === 'fight' && W.toasts.at( - 1 ).includes( 'wedged tight' ), `reaching in at once: it is wedged tight ("${ W.toasts.at( - 1 ) }")` );
	W.run( 25 );
	ok( F.wedge < 0.45 && W.sp.phase === 'fight', `left alone 25 s it calms down (wedge ${ F.wedge.toFixed( 2 ) })` );
	W.input._hit.add( 'KeyE' );
	W.frame();
	ok( W.sp.phase === 'home' && W.game.state.inventory.length === 1, `then reaching in works it out: ${ W.game.state.inventory.map( ( f ) => f.species ) }` );

}

// a stoned fish, a blackout with a big fish on
{

	const W = makeWorld( [ { name: 'jack', model: 'jack', L: 0.75, p: [ 0, - 6, - 2 ], h: [ 1, 0, 0 ] } ] );
	const { sp } = W;
	shootAt( W, { upgrades: { float: 1 } } );
	sp.apnea.o2 = 0.02;
	W.run( 0.2 );
	ok( sp.phase === 'blackout' && sp.loose && sp.loose.float, 'blacking out with a fish on: the gun drops, out on the float line' );
	W.run( 6 );
	ok( sp.phase === 'loose' && sp.fight, `you come round with the rig still out (${ sp.phase })` );

}

// ---- the left button alone (a trackpad, no right button, no Q): hold to aim, let go to shoot
{

	const W = makeWorld( [ { name: 'jack', model: 'jack', L: 0.55, p: [ 0, - 6.05, - 6 ], h: [ 1, 0, 0 ], speed: 0 } ] );
	const { sp, input } = W;
	input._hit.add( 'KeyG' );
	W.frame();
	sp.gun.bandsLoaded = sp.stats.bands;
	W.frame( 1 / 60, { lmb: true } );
	ok( sp.phase === 'home' && sp.aiming, 'a left press with the gun down raises it, and doesn\'t shoot yet' );
	W.run( 1, { lmb: true } );
	ok( sp.phase === 'home' && sp.aiming && sp.gun.state === 'aim', 'held: the gun stays up at the eye' );
	W.frame( 1 / 60, { lmb: false } );
	ok( sp.phase === 'flying', `let go: it shoots (${ sp.phase })` );

	// a quick click: the gun comes up, then shoots
	const W2 = makeWorld( [] );
	W2.input._hit.add( 'KeyG' );
	W2.frame();
	W2.sp.gun.bandsLoaded = W2.sp.stats.bands;
	W2.frame( 1 / 60, { lmb: true } );
	W2.frame( 1 / 60, { lmb: false } );
	ok( W2.sp.phase === 'home' && W2.sp.aiming, 'a quick click: the gun comes up first' );
	W2.run( 0.3 );
	ok( W2.sp.phase === 'flying', `then shoots, aimed (${ W2.sp.phase })` );

	// not loaded: the press says so at once, nothing waits
	const W3 = makeWorld( [] );
	W3.input._hit.add( 'KeyG' );
	W3.frame();
	W3.frame( 1 / 60, { lmb: true } );
	ok( ! W3.sp._press && W3.toasts.some( ( t ) => /Not loaded/.test( t ) ), 'unloaded: "Not loaded" at once' );

}

// ---- Easy: no blackout (the buddy takes you up, the fish stays on), no fine
{

	// the same dive that blacks out on Standard: out of breath at 6 m
	const W = makeWorld( [] );
	const { sp, player } = W;
	sp.easy = true;
	sp.apnea.o2 = 0.03; // 0.048 atm at 6 m: past blackout
	W.run( 3 );
	ok( sp.phase !== 'blackout' && ! sp.apnea.blackout, `easy: out of breath at 6 m, no blackout (${ sp.phase })` );
	ok( W.toasts.some( ( t ) => /buddy is taking you up/.test( t ) ), 'easy: told the buddy is taking you up' );
	ok( player.position.y > - 6 + 2, `easy: drawn up towards the surface (now ${ player.position.y.toFixed( 1 ) } m)` );
	const W0 = makeWorld( [] );
	W0.sp.apnea.o2 = 0.03;
	W0.run( 0.5 );
	ok( W0.sp.phase === 'blackout', `standard: the same dive blacks out (${ W0.sp.phase })` );

	// a fish on the line stays on while the buddy takes you up
	const W2 = makeWorld( [ { name: 'jack', model: 'jack', L: 0.75, p: [ 0, - 6, - 2 ], h: [ 1, 0, 0 ] } ] );
	W2.sp.easy = true;
	shootAt( W2 );
	const before = W2.sp.phase;
	W2.sp.apnea.o2 = 0.07;
	W2.run( 1 );
	ok( before === 'fight' && [ 'fight', 'out', 'home' ].includes( W2.sp.phase ) && W2.sp.phase !== 'blackout', `easy: the fish stays on (${ before } -> ${ W2.sp.phase })` );

	// a protected grouper: a warning, no fine
	const W3 = makeWorld( [ { name: 'grouper', model: 'grouper', L: 0.6, p: [ 0, - 6, - 2 ], h: [ 1, 0, 0 ] } ] );
	W3.sp.easy = true;
	W3.game.state.money = 100;
	shootAt( W3 );
	for ( let i = 0; i < 600 && W3.sp.phase !== 'home'; i ++ ) {

		W3.frame( 1 / 60, { lmb: true } );
		W3.input._hit.add( 'KeyE' );

	}

	ok( W3.game.state.money === 100 && W3.toasts.some( ( t ) => /fine on Standard/.test( t ) ), `easy: a protected fish costs nothing, with a warning (money ${ W3.game.state.money })` );

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
