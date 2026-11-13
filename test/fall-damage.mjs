// Tests for FallDamage (game/FallDamage.js):
//   – fall tracking (beginFall / airborne / land)
//   – damage thresholds (safe, minor, serious, lethal)
//   – severity calculation
//   – death → respawn cycle

import { FallDamage } from '../src/game/FallDamage.js';

let fails = 0;
const ok = ( c, msg ) => {

	console.log( ( c ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! c ) fails ++;

};

// stub player with the minimum fields FallDamage needs
const makePlayer = () => ( {

	position: { x: 0, y: 10, z: 0, copy( p ) { this.x = p.x; this.y = p.y; this.z = p.z; } },
	velocity: { x: 1, y: - 5, z: 1, set( x, y, z ) { this.x = x; this.y = y; this.z = z; } },
	grounded: true,
	frozen: false,
	mode: 'walk',
	_camY: 11.62,
	terrain: { heightAt() { return 0; } },
	groundAt() { return 0; },

} );

const makeAudio = () => {

	let called = false;
	let lastSev = - 1;
	return {
		fallImpact( sev ) { called = true; lastSev = sev; },
		get called() { return called; },
		get lastSev() { return lastSev; },
		reset() { called = false; lastSev = - 1; },
	};

};

// ---- thresholds
{

	ok( FallDamage.SAFE_HEIGHT === 3, `SAFE_HEIGHT is 3 (got ${ FallDamage.SAFE_HEIGHT })` );
	ok( FallDamage.LETHAL_HEIGHT === 10, `LETHAL_HEIGHT is 10 (got ${ FallDamage.LETHAL_HEIGHT })` );

}

// ---- safe fall: under SAFE_HEIGHT does nothing
{

	const fd = new FallDamage();
	const p = makePlayer();
	const a = makeAudio();
	p.position.y = 12;
	fd.beginFall( 12 );
	fd.airborne( 12 );
	fd.land( 10, p, a ); // 2 m drop < 3 m threshold
	ok( fd.severity === 0, 'severity stays 0 for 2 m fall' );
	ok( ! fd.dead, 'not dead from 2 m fall' );
	ok( ! a.called, 'no sound for safe fall' );

}

// ---- minor fall: just above SAFE_HEIGHT
{

	const fd = new FallDamage();
	const p = makePlayer();
	const a = makeAudio();
	fd.beginFall( 20 );
	fd.airborne( 20 );
	fd.land( 16, p, a ); // 4 m drop
	const expected = ( 4 - 3 ) / 7; // ~0.143
	ok( Math.abs( fd.severity - expected ) < 0.01, `severity ~${ expected.toFixed( 3 ) } for 4 m fall (got ${ fd.severity.toFixed( 3 ) })` );
	ok( ! fd.dead, 'not dead from 4 m fall' );
	ok( a.called, 'sound played for minor fall' );
	ok( fd.shakeT > 0, 'camera shake started' );
	ok( fd.goreAlpha > 0, 'gore overlay visible' );

}

// ---- serious fall: halfway between safe and lethal
{

	const fd = new FallDamage();
	const p = makePlayer();
	const a = makeAudio();
	fd.beginFall( 20 );
	fd.airborne( 20 );
	fd.land( 13, p, a ); // 7 m drop
	const expected = ( 7 - 3 ) / 7; // ~0.571
	ok( Math.abs( fd.severity - expected ) < 0.01, `severity ~${ expected.toFixed( 3 ) } for 7 m (got ${ fd.severity.toFixed( 3 ) })` );
	ok( ! fd.dead, 'not dead from 7 m' );
	ok( a.called, 'sound for serious fall' );
	ok( p.velocity.x < 1, 'velocity reduced (limping)' );

}

// ---- lethal fall: exactly at LETHAL_HEIGHT
{

	const fd = new FallDamage();
	const p = makePlayer();
	const a = makeAudio();
	fd.beginFall( 20 );
	fd.airborne( 20 );
	fd.land( 10, p, a ); // 10 m drop = exactly lethal
	ok( fd.severity === 1, `severity 1 for 10 m fall (got ${ fd.severity })` );
	ok( fd.dead, 'dead from 10 m fall' );
	ok( p.frozen, 'player frozen on death' );
	ok( a.called, 'sound for lethal fall' );

}

// ---- extreme fall: well above lethal
{

	const fd = new FallDamage();
	const p = makePlayer();
	const a = makeAudio();
	fd.beginFall( 50 );
	fd.airborne( 50 );
	fd.land( 10, p, a ); // 40 m drop
	ok( fd.severity === 1, 'severity capped at 1 for extreme fall' );
	ok( fd.dead, 'dead from extreme fall' );

}

// ---- jump doesn't amplify: highestY tracks the peak
{

	const fd = new FallDamage();
	const p = makePlayer();
	const a = makeAudio();
	fd.beginFall( 10 );
	fd.airborne( 12 ); // jumped up 2m first
	fd.airborne( 11 );
	fd.land( 10, p, a ); // back to starting height — only 2m true drop from peak
	ok( fd.severity === 0, 'no damage when returning to takeoff height via jump' );

}

// ---- tracking state: beginFall / land resets
{

	const fd = new FallDamage();
	fd.beginFall( 20 );
	ok( fd.tracking, 'tracking after beginFall' );
	fd.land( 18, makePlayer(), makeAudio() );
	ok( ! fd.tracking, 'not tracking after land' );

}

// ---- death sequence: update cycles through phases and eventually respawns
{

	const fd = new FallDamage();
	const p = makePlayer();
	const a = makeAudio();
	fd.beginFall( 30 );
	fd.land( 10, p, a ); // 20m, well over lethal
	ok( fd.dead, 'dead after lethal fall' );
	ok( p.frozen, 'frozen during death' );

	// run 6 seconds of updates (death tumble 1.5 + fade 1.0 + hold 1.5 + respawn 0.8 = 4.8s)
	for ( let t = 0; t < 300; t ++ ) fd.update( 0.02, p, a );

	ok( ! fd.dead, 'alive after respawn' );
	ok( ! p.frozen, 'unfrozen after respawn' );
	ok( fd.severity === 0, 'severity reset after respawn' );
	ok( p.mode === 'walk', 'back to walk mode' );

}

// ---- no double-trigger: landing while dead does nothing
{

	const fd = new FallDamage();
	const p = makePlayer();
	fd.beginFall( 30 );
	fd.land( 10, p, makeAudio() );
	ok( fd.dead, 'dead' );
	const a = makeAudio();
	fd.beginFall( 30 ); // should be ignored
	fd.land( 5, p, a );
	ok( ! a.called, 'no sound when already dead' );

}

// ---- results
console.log( `\n${ fails ? `${ fails } FAILED` : 'All passed' }` );
process.exit( fails ? 1 : 0 );
