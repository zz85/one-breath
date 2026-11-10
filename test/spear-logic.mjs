// Plain-node tests of the spearfishing rules and physics (game/Spear.js): no GPU.
import { hitTest, zoneOf, penetration, stepShaft, speedAfter, SpearFight, Apnea, judge, weightKg, swimmerInfo, maxRadius, SHAFT_DRAG } from '../src/game/Spear.js';
import { UPGRADES, gearStats, defaultUpgrades } from '../src/game/Gear.js';

let fails = 0;
const ok = ( c, msg ) => {

	if ( ! c ) { fails ++; console.log( 'FAIL', msg ); } else console.log( 'ok  ', msg );

};
let seed = 777;
const rng = () => ( ( seed = ( seed * 1664525 + 1013904223 ) >>> 0 ) / 4294967296 );
const V = ( x, y, z ) => ( { x, y, z } );

// ---- the shaft
{

	const p = V( 0, - 5, 0 ), v = V( 0, 0, 18 );
	let t = 0, at4 = null;
	while ( p.z < 8 && t < 5 ) {

		stepShaft( p, v, 1 / 240 );
		t += 1 / 240;
		if ( ! at4 && p.z >= 4 ) at4 = { v: Math.hypot( v.x, v.y, v.z ), y: p.y, t };

	}

	console.log( `     shaft at 4 m: ${ at4.v.toFixed( 1 ) } m/s after ${ ( at4.t * 1000 ).toFixed( 0 ) } ms, dropped ${ ( ( - 5 - at4.y ) * 100 ).toFixed( 1 ) } cm` );
	ok( Math.abs( at4.v - speedAfter( 18, 4 ) ) < 0.6, 'drag: speed after 4 m matches v0 exp(-k s)' );
	ok( at4.v > 8 && at4.v < 12, 'a 18 m/s shaft still has 8-12 m/s at 4 m' );
	ok( - 5 - at4.y < 0.1, 'a fast shaft drops under 10 cm over 4 m' );
	ok( SHAFT_DRAG > 0.1 && SHAFT_DRAG < 0.25, 'drag constant in range' );

}

// ---- hit test against a fish's body: a 50 cm jack broadside 3 m ahead, heading +x
{

	const L = 0.5, p = V( 0, - 5, 3 ), h = V( 1, 0, 0 );
	const shoot = ( x, y ) => hitTest( V( x, y, 0 ), V( x, y, 6 ), p, h, L, 'jack' );
	const mid = shoot( 0, - 5 );
	ok( !! mid, 'a shot at the middle of the flank hits' );
	ok( mid && Math.abs( mid.t * 6 - ( 3 - 0.048 * L ) ) < 0.03, `it enters at the near flank (${ mid && ( mid.t * 6 ).toFixed( 3 ) } m)` );
	ok( mid && zoneOf( 'jack', mid ) === 'spine' || zoneOf( 'jack', mid ) === 'back', `the middle of the flank: ${ mid && zoneOf( 'jack', mid ) }` );
	ok( ! shoot( 0, - 5 + 0.14 * L ), 'a shot just over its back misses' );
	ok( ! shoot( - 0.42 * L, - 5 ), 'a shot through the tail fin misses (no flesh there)' );
	const head = shoot( 0.5 * L - 0.17 * L, - 5 + 0.03 * L );
	ok( head && zoneOf( 'jack', head ) === 'brain', `behind the eye: ${ head && zoneOf( 'jack', head ) }` );
	const belly = shoot( 0.05 * L, - 5 - 0.075 * L );
	ok( belly && zoneOf( 'jack', belly ) === 'belly', `low on the flank: ${ belly && zoneOf( 'jack', belly ) }` );
	ok( ! hitTest( V( 0.2, - 5, 0 ), V( 0.2, - 5, 2 ), p, h, L, 'jack' ), 'a shaft that stops short misses' );
	// head-on, along its length: it is thin from the front (half width 0.048 L)
	const hp = hitTest( V( 3, - 5 + 0.01, 3.02 ), V( - 1, - 5 + 0.01, 3.02 ), p, h, L, 'jack' );
	ok( hp && hp.inside > 0.25, `head-on shot runs inside a long way of its length (${ hp && hp.inside.toFixed( 2 ) } L)` );
	ok( maxRadius( 'angel' ) > maxRadius( 'barracuda' ) * 2, 'an angelfish is deeper bodied than a barracuda' );

}

// ---- penetration
{

	const L = 0.5, hit = { inside: 0.1, u: 0.4 };
	const close = penetration( speedAfter( 18, 2 ), 0.3, L, hit, 'jack' );
	const far = penetration( speedAfter( 10, 6 ), 0.3, L, hit, 'jack' );
	console.log( `     2 m: ${ close.E.toFixed( 1 ) } J vs ${ close.need.toFixed( 1 ) } J (${ close.result }); 6 m weak gun: ${ far.E.toFixed( 1 ) } J (${ far.result })` );
	ok( close.result === 'through', 'a 90 cm gun at 2 m shoots through a 50 cm jack' );
	ok( far.result !== 'through', 'a weak gun at 6 m does not' );
	const big = penetration( speedAfter( 14, 4 ), 0.22, 1.3, { inside: 0.1 }, 'barracuda' );
	ok( big.result !== 'through', `a small gun lodges or bounces in a 1.3 m barracuda at 4 m (${ big.result })` );

}

// ---- rules
{

	ok( ! judge( 'turtle', 1 ).ok && judge( 'turtle', 1 ).fine > 0, 'turtles are protected' );
	ok( ! judge( 'grouper', 0.7 ).ok, 'Nassau grouper are protected' );
	ok( ! judge( 'yellowtail', 0.26 ).ok && judge( 'yellowtail', 0.26 ).fine > 0, 'undersized yellowtail is a fine' );
	ok( judge( 'yellowtail', 0.34 ).ok, 'a 34 cm yellowtail is legal' );
	ok( judge( 'jack', 0.5 ).ok, 'jacks are fair game' );
	ok( ! judge( 'chromis', 0.1 ).ok && judge( 'chromis', 0.1 ).fine === 0, 'a chromis is too small to be worth it (no fine)' );
	const kg = weightKg( 'jack', 0.55 );
	ok( kg > 1.2 && kg < 3, `a 55 cm jack weighs ${ kg.toFixed( 2 ) } kg` );
	ok( swimmerInfo( 'pierSnapper' ).id === 'yellowtail', 'pier snappers sell as yellowtail' );

}

// ---- the fight
{

	const anchor = V( 0, - 5, 0 );
	const run = ( zone, through, haul, opts = {} ) => {

		seed = 99;
		const f = new SpearFight( { kg: 3, id: 'jack', zone, through, lineMax: 4, rng, ...opts } );
		f.start( V( 0, - 5, 3 ), anchor );
		let t = 0, maxT = 0;
		while ( t < 60 && ! f.result ) {

			f.update( 1 / 60, anchor, haul( t ), - 12, 0 );
			maxT = Math.max( maxT, f.tension );
			t += 1 / 60;
			if ( f.lineOut <= 0.9 ) {

				f.result = 'secured';
				break;

			}

		}

		return { f, t, maxT };

	};

	const stone = run( 'brain', true, () => true );
	ok( stone.f.result === 'secured' && stone.t < 6, `a stoned fish hauls straight in (${ stone.t.toFixed( 1 ) } s)` );
	const steady = run( 'back', true, ( t ) => t > 6 );
	ok( steady.f.result === 'secured', `a well-held jack, tired out then hauled, is landed (${ steady.t.toFixed( 1 ) } s, max ${ steady.maxT.toFixed( 0 ) } N)` );
	const belly = run( 'belly', false, () => true );
	ok( belly.f.result === 'free', `hauling hard on a lodged belly shot tears it out (${ belly.t.toFixed( 1 ) } s)` );
	const reel = run( 'belly', false, ( t ) => t > 8, { reel: { drag: 60, lineM: 30 } } );
	ok( reel.f.lineOut > 4 || reel.f.result === 'secured', `with a reel the fish takes line instead of holding hard (line ${ reel.f.lineOut.toFixed( 1 ) } m)` );
	ok( reel.maxT < belly.maxT, `the reel's drag keeps the tension lower (${ reel.maxT.toFixed( 0 ) } N vs ${ belly.maxT.toFixed( 0 ) } N)` );

}

// ---- breath-hold
{

	const calm = new Apnea( { holdS: 70 } );
	let t = 0;
	while ( ! calm.blackout && t < 200 ) {

		calm.update( 0.1, { under: true, depth: 0.5, effort: 1 } );
		t += 0.1;

	}

	ok( t > 60 && t < 75, `a calm static hold blacks out after ${ t.toFixed( 0 ) } s` );
	ok( calm.contractions > 3, `contractions come first (${ calm.contractions })` );

	// a dive to 15 m: fine at the bottom, blacks out on the way up (shallow-water blackout)
	const dive = new Apnea( { holdS: 70 } );
	let depth = 0, blackAt = null;
	for ( t = 0; t < 120 && ! dive.blackout; t += 0.1 ) {

		depth = t < 15 ? t : t < 40 ? 15 : Math.max( 0, 15 - ( t - 40 ) * 1.0 );
		dive.update( 0.1, { under: depth > 0.3, depth, effort: 1.4 } );
		if ( dive.blackout ) blackAt = depth;

	}

	ok( blackAt !== null && blackAt < 6 && blackAt > 0.3, `a long dive to 15 m blacks out near the surface on the ascent (${ blackAt === null ? 'none' : blackAt.toFixed( 1 ) + ' m' })` );
	const short = new Apnea( { holdS: 70 } );
	for ( t = 0; t < 40; t += 0.1 ) short.update( 0.1, { under: true, depth: t < 10 ? t : t < 25 ? 10 : 10 - ( t - 25 ) * 0.7, effort: 1.4 } );
	ok( ! short.blackout && short.hypoxia < 0.5, 'a 40 s dive to 10 m is safe' );
	for ( t = 0; t < 30; t += 0.1 ) short.update( 0.1, { under: false, depth: 0 } );
	ok( short.o2 > 0.2 && short.urge < 0.3, 'half a minute breathing at the surface recovers' );

}

// ---- gear
{

	const s = gearStats( defaultUpgrades() );
	ok( s.gunM > 0 && s.v0 > 10 && s.bands >= 1 && s.holdS > 0 && s.lineWraps > 0, 'starting gear has a gun, bands, a breath-hold' );
	ok( ! s.reelM, 'no reel to start with' );
	ok( UPGRADES.gun.levels.every( ( l, i, a ) => i === 0 || l.v0 > a[ i - 1 ].v0 ), 'each gun shoots harder than the one before' );

}

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
