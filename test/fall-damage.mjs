// Tests for FallDamage (game/FallDamage.js):
//   – fall tracking (beginFall / airborne / land)
//   – damage thresholds (safe, minor, serious, lethal)
//   – severity calculation
//   – the health bar: stacking falls, limp, walking regen, eating
//   – death → respawn cycle
//   – the 2:1 surface interval in the breath-hold model

import { FallDamage } from '../src/game/FallDamage.js';
import { Apnea, REST_RATIO, REST_MAX_PENALTY } from '../src/game/Spear.js';
import { eatHealth } from '../src/game/Game.js';

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

	ok( FallDamage.SAFE_HEIGHT === 3, 'SAFE_HEIGHT is 3' );
	ok( FallDamage.LETHAL_HEIGHT === 13, `a 13 m drop kills from full health (got ${ FallDamage.LETHAL_HEIGHT })` );
	ok( FallDamage.MAX_HEALTH === 100, 'health starts at 100' );

}

// ---- safe fall: under SAFE_HEIGHT does nothing
{

	const fd = new FallDamage(), p = makePlayer(), a = makeAudio();
	fd.beginFall( 12 );
	fd.land( 10, p, a );
	ok( fd.health === 100, '2 m fall: no damage' );
	ok( ! a.called, '2 m fall: no sound' );

}

// ---- falls take health, scaled by height
{

	const fd = new FallDamage(), p = makePlayer(), a = makeAudio();
	fd.beginFall( 20 );
	fd.land( 15, p, a ); // 5 m
	ok( Math.abs( fd.health - 80 ) < 1e-6, `5 m fall: 100 -> 80 (got ${ fd.health })` );
	ok( a.called && fd.shakeT > 0 && fd.goreAlpha > 0, '5 m fall: sound, shake and gore' );
	ok( ! fd.dead, '5 m fall: alive' );

}

{

	const fd = new FallDamage(), p = makePlayer(), a = makeAudio();
	fd.beginFall( 20 );
	fd.land( 10, p, a ); // 10 m, the old instant death
	ok( Math.abs( fd.health - 30 ) < 1e-6 && ! fd.dead, `10 m fall: survive on 30 (got ${ fd.health })` );
	ok( p.velocity.x < 1, '10 m fall: slowed on impact' );
	ok( fd.severity === 1, '10 m fall: full gore' );

}

// ---- falls stack until death
{

	const fd = new FallDamage(), p = makePlayer(), a = makeAudio();
	fd.beginFall( 20 ); fd.land( 12, p, a ); // 8 m: -50
	ok( fd.health === 50 && ! fd.dead, 'first 8 m fall: 50 left' );
	fd.beginFall( 20 ); fd.land( 12, p, a ); // another 8 m
	ok( fd.health === 0 && fd.dead && p.frozen, 'second 8 m fall: dead' );

}

// ---- one big fall kills from full health
{

	const fd = new FallDamage(), p = makePlayer();
	fd.beginFall( 50 ); fd.land( 10, p, makeAudio() );
	ok( fd.dead && fd.health === 0, '40 m fall: dead' );

}

// ---- a jump from level ground doesn't count as a fall
{

	const fd = new FallDamage(), p = makePlayer(), a = makeAudio();
	fd.beginFall( 10 ); fd.airborne( 12 ); fd.airborne( 11 ); fd.land( 10, p, a );
	ok( fd.health === 100, 'jump and land at the same height: no damage' );

}

// ---- limp below 30 health
{

	const fd = new FallDamage();
	ok( fd.limp === 1, 'healthy: full speed' );
	fd.health = 15;
	ok( fd.limp < 1 && fd.limp > 0.55, `15 health: limping (${ fd.limp.toFixed( 2 ) })` );

}

// ---- walking regen: very slow
{

	const fd = new FallDamage(), p = makePlayer();
	fd.health = 50;
	p.position.y = 0;
	// walk 100 m in 0.5 m steps
	for ( let i = 0; i <= 200; i ++ ) {

		p.position.x = i * 0.5;
		fd.update( 1 / 60, p, makeAudio() );

	}

	ok( Math.abs( fd.health - 55 ) < 0.01, `walking 100 m: +5 health (got ${ fd.health.toFixed( 2 ) })` );
	// standing still heals nothing
	const h = fd.health;
	for ( let i = 0; i < 600; i ++ ) fd.update( 1 / 60, p, makeAudio() );
	ok( fd.health === h, 'standing still: no regen' );
	// a teleport (respawn) isn't walking
	p.position.x += 500;
	fd.update( 1 / 60, p, makeAudio() );
	ok( fd.health === h, 'a 500 m jump in one frame: no regen' );
	// swimming doesn't heal
	p.mode = 'swim';
	p.position.x += 1;
	fd.update( 1 / 60, p, makeAudio() );
	p.position.x += 1;
	fd.update( 1 / 60, p, makeAudio() );
	ok( fd.health === h, 'swimming: no regen' );

}

// ---- heal (eating) is capped at full
{

	const fd = new FallDamage();
	fd.health = 70;
	ok( fd.heal( 20 ) === 20 && fd.health === 90, 'heal 20 from 70' );
	ok( fd.heal( 40 ) === 10 && fd.full, 'heal caps at 100' );

}

{

	ok( eatHealth( 0.5 ) === 14, 'a 0.5 kg fish gives 14' );
	ok( eatHealth( 10 ) === 40, 'a big fish gives at most 40' );

}

// ---- death -> respawn with half health
{

	const fd = new FallDamage(), p = makePlayer();
	p.position.x = 300;
	fd.beginFall( 30 ); fd.land( 10, p, makeAudio() );
	for ( let t = 0; t < 300; t ++ ) fd.update( 0.02, p, makeAudio() );
	ok( ! fd.dead && ! p.frozen && p.mode === 'walk', 'alive and walking after respawn' );
	ok( fd.health === FallDamage.RESPAWN_HEALTH, `respawn on ${ FallDamage.RESPAWN_HEALTH } health (got ${ fd.health })` );
	ok( fd.heal( 0 ) === 0 && fd.dead === false, 'can heal after respawn' );

}

// ---- landing while dead does nothing
{

	const fd = new FallDamage(), p = makePlayer();
	fd.beginFall( 30 ); fd.land( 10, p, makeAudio() );
	const a = makeAudio();
	fd.beginFall( 30 ); fd.land( 5, p, a );
	ok( ! a.called, 'no second hit while dead' );
	ok( fd.heal( 50 ) === 0, 'no healing while dead' );

}

// ---- 2:1 surface interval (Apnea)
{

	const dive = ( ap, s ) => { for ( let t = 0; t < s; t += 0.1 ) ap.update( 0.1, { under: true, depth: 5 } ); };
	const rest = ( ap, s ) => { for ( let t = 0; t < s; t += 0.1 ) ap.update( 0.1, { under: false, depth: 0 } ); };

	const ap = new Apnea( { holdS: 70 } );
	dive( ap, 30 );
	ok( Math.abs( ap.restDebt - 60 ) < 0.5, `30 s dive: 60 s of rest owed (got ${ ap.restDebt.toFixed( 1 ) })` );
	rest( ap, 20 );
	ok( Math.abs( ap.restDebt - 40 ) < 0.5, '20 s at the top: 40 s still owed' );
	rest( ap, 40 );
	ok( ap.restDebt === 0, '60 s at the top: rested' );

	// rested: a fresh dive uses O2 at the normal rate
	const fresh = new Apnea( { holdS: 70 } );
	dive( fresh, 20 );
	const o2Fresh = fresh.o2;

	// tired: dive 40 s, rest only 20 s, dive 20 s again
	const tired = new Apnea( { holdS: 70 } );
	dive( tired, 40 );
	rest( tired, 25 ); // enough for the O2 to come back, not the 80 s rest owed
	ok( tired.o2 > 0.205, 'short rest: O2 itself back' );
	dive( tired, 20 );
	ok( tired.o2 < o2Fresh - 0.005, `diving before resting 2:1 burns O2 faster (${ tired.o2.toFixed( 3 ) } vs ${ o2Fresh.toFixed( 3 ) })` );
	ok( tired._penalty > 0 && tired._penalty <= REST_MAX_PENALTY, `penalty within bounds (${ tired._penalty.toFixed( 2 ) })` );
	ok( REST_RATIO === 2, 'the ratio is 2:1' );

}

// ---- results
console.log( `\n${ fails ? `${ fails } FAILED` : 'All passed' }` );
process.exit( fails ? 1 : 0 );
