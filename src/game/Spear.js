import { SPECIES } from '../world/fish/FishSpecies.js';
import { FISH } from './FishTable.js';

// Spearfishing rules and physics, without the engine (plain-node testable, test/spear-logic.mjs).
//
//   shaft       a band-powered speargun's shaft under water: quadratic drag (it loses half its
//               speed every ~4.5 m), the small sink of a steel rod, stopped by the shooting line
//   hitTest     the shaft's path against a fish's real body: the cross-sections of its anatomy
//               (world/fish/FishSpecies.js: dorsal height, ventral depth, half width along the
//               body), so a shot through the tail fin or past the belly misses
//   classify    where it hit (brain, spine, head, back, belly, tail) and whether the shaft went
//               through (flopper open: a good hold) or only lodged, from its energy at impact
//   SpearFight  the fish on the line: it swims against the line, the line length you haul in,
//               the tension, the hold of the shaft in its flesh (it tears out), a reel's drag
//   Apnea       the breath-hold: oxygen partial pressure (higher at depth: the danger is the
//               ascent), CO2 urge and contractions, tunnel vision, blackout; breathe-up at the top
//   RULES       which fish of the reef you may take (protected species, minimum sizes)

export const G = 9.81;
const STEEL = 7.85; // shaft density relative to sea water (~1.025)
export const SINK = G * ( 1 - 1.025 / STEEL ); // m/s^2 of a free steel shaft in water
export const SHAFT_DRAG = 0.155; // 1/m: v(s) = v0 * exp( -k s )

// ---- species: the world's swimmers (world/Fish.js BEHAVIOUR names) and the rules for them
// id: the market fish (FishTable.js) it sells as; protect: no take (fine $); minCm: legal size
const SWIMMERS = {
	bait: { id: 'silverside' }, silverside: { id: 'silverside' }, fry: { id: 'silverside' },
	chromis: { id: 'chromis' }, grunt: { id: 'grunt' }, pierGrunt: { id: 'grunt' },
	yellowtail: { id: 'yellowtail', minCm: 30 }, pierSnapper: { id: 'yellowtail', minCm: 30 },
	tang: { id: 'tang' }, sergeant: { id: 'sergeant' }, pierSergeant: { id: 'sergeant' },
	wrasse: { id: 'wrasse', minCm: 30 }, angel: { id: 'angel' },
	jack: { id: 'jack' }, pilot: { id: 'jack' }, juvenile: { id: 'jack' },
	barracuda: { id: 'barracuda' }, needlefish: { id: 'needlefish' }, mullet: { id: 'mullet' },
	// protected: parrotfish graze the algae off the coral; Nassau grouper are critically endangered
	// (no take all year); tarpon are catch-and-release only; turtles and rays are fully protected
	parrot: { id: 'parrot', protect: 250, why: 'Parrotfish are protected here: they keep the coral clean' },
	grouper: { id: 'grouper', protect: 500, why: 'Nassau grouper are protected all year' },
	tarpon: { id: 'tarpon', protect: 400, why: 'Tarpon are catch-and-release only, no spearing' },
	turtle: { name: 'Green turtle', protect: 1500, why: 'Sea turtles are protected' },
	stingray: { name: 'Southern stingray', protect: 300, why: 'Rays are protected in the marine park' },
	eagleRay: { name: 'Spotted eagle ray', protect: 400, why: 'Rays are protected in the marine park' },
	remora: { name: 'Remora', worthless: true },
	// marine mammals: shooting at one at all is harassment, whether the shaft goes in or not
	humpback: { name: 'Humpback whale', protect: 5000, why: 'Humpback whales are protected: shooting at one is a serious offence' },
};

// What a speargun does to a whale: a humpback's skin and the blubber under it (10-15 cm) take a
// shaft only when it comes in fast and square; it can't reach anything that matters under it.
// E: the shaft's kinetic energy (J), cos: the cosine of its angle to the skin's normal.
export const WHALE_LODGE_J = 30;
export function whaleShaft( E, cos ) {

	if ( cos < 0.45 || E * cos * cos < WHALE_LODGE_J ) return 'bounce';
	return 'lodge';

}

// below this many grams a shaft leaves nothing to sell (tiny reef fish, silversides)
export const TOO_SMALL_KG = 0.12;

export function swimmerInfo( behaviour ) {

	const s = SWIMMERS[ behaviour ] || { name: behaviour, worthless: true };
	const f = s.id ? FISH[ s.id ] : null;
	return { ...s, name: s.name || ( f ? f.name : behaviour ) };

}

// weight of a fish of total length L (m) from its species' length-weight relation
export function weightKg( id, L ) {

	const [ a, b ] = FISH[ id ].lw;
	return a * Math.pow( L * 100, b ) / 1000;

}

// What happens to a speared fish under the rules: { ok, fine, why }
export function judge( behaviour, L ) {

	const s = swimmerInfo( behaviour );
	if ( s.protect ) return { ok: false, fine: s.protect, why: s.why };
	if ( s.worthless || ! s.id ) return { ok: false, fine: 0, why: `${ s.name }: nobody buys those` };
	const cm = L * 100;
	if ( s.minCm && cm < s.minCm ) return { ok: false, fine: 75, why: `Undersized: ${ s.name } must be ${ s.minCm } cm, this one is ${ cm.toFixed( 0 ) } cm` };
	if ( weightKg( s.id, L ) < TOO_SMALL_KG ) return { ok: false, fine: 0, why: `Too small to be worth a shaft` };
	return { ok: true, fine: 0, why: '' };

}

// ---- anatomy: cross-section of a fish at body fraction u (0 snout .. 1 base of the tail fin), in
// units of its total length: centre height yc, half height ry, half width rx
const prof = ( pts, u ) => {

	if ( u <= pts[ 0 ][ 0 ] ) return pts[ 0 ][ 1 ];
	for ( let i = 1; i < pts.length; i ++ ) {

		if ( u <= pts[ i ][ 0 ] ) {

			const a = pts[ i - 1 ], b = pts[ i ];
			const t = ( u - a[ 0 ] ) / ( b[ 0 ] - a[ 0 ] );
			const s = t * t * ( 3 - 2 * t );
			return a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * ( 0.5 * t + 0.5 * s );

		}

	}

	return pts[ pts.length - 1 ][ 1 ];

};

// rays and the turtle aren't in SPECIES: flat discs
const FLAT = {
	stingray: { body: 0.55, top: [ [ 0, 0.01 ], [ 0.3, 0.05 ], [ 0.7, 0.04 ], [ 1, 0.01 ] ], bot: [ [ 0, 0.005 ], [ 0.5, 0.02 ], [ 1, 0.005 ] ], wid: [ [ 0, 0.1 ], [ 0.4, 0.42 ], [ 1, 0.1 ] ], eye: { u: 0.2, r: 0.04 }, opercle: 0.35 },
	eagleRay: { body: 0.4, top: [ [ 0, 0.02 ], [ 0.3, 0.06 ], [ 1, 0.02 ] ], bot: [ [ 0, 0.01 ], [ 0.5, 0.03 ], [ 1, 0.01 ] ], wid: [ [ 0, 0.1 ], [ 0.35, 0.6 ], [ 1, 0.1 ] ], eye: { u: 0.15, r: 0.04 }, opercle: 0.3 },
	turtle: { body: 0.85, top: [ [ 0, 0.05 ], [ 0.4, 0.17 ], [ 1, 0.05 ] ], bot: [ [ 0, 0.03 ], [ 0.4, 0.07 ], [ 1, 0.03 ] ], wid: [ [ 0, 0.07 ], [ 0.4, 0.33 ], [ 1, 0.1 ] ], eye: { u: 0.08, r: 0.03 }, opercle: 0.18 },
};
export function anatomy( model ) {

	return SPECIES[ model ] || FLAT[ model ] || SPECIES.grunt;

}

export function section( model, u, out = {} ) {

	const S = anatomy( model );
	const top = prof( S.top, u ), bot = prof( S.bot, u );
	out.yc = ( top - bot ) * 0.5;
	out.ry = ( top + bot ) * 0.5;
	out.rx = prof( S.wid, u );
	return out;

}

// largest half height / width over the body (broad phase), cached per model
const _maxR = {};
export function maxRadius( model ) {

	if ( _maxR[ model ] ) return _maxR[ model ];
	let r = 0;
	const s = {};
	for ( let k = 0; k <= 40; k ++ ) {

		section( model, k / 40, s );
		r = Math.max( r, Math.abs( s.yc ) + s.ry, s.rx );

	}

	return ( _maxR[ model ] = r );

}

// The shaft's path a -> b (world points, arrays or {x,y,z}) against a fish at p, heading h (unit),
// total length L. Returns null, or { t: 0..1 along a -> b, u (body fraction), y, x (in units of
// L, relative to the axis) of the middle of its run inside the body, that section's yc, ry, rx,
// inside: the run's length (units of L) }
const _s = {};
export function hitTest( a, b, p, h, L, model ) {

	const S = anatomy( model );
	// fish frame: f forward (to the snout), r right, up: world up made square to f
	const fx = h.x, fy = h.y, fz = h.z;
	let ux = - fy * fx, uy = 1 - fy * fy, uz = - fy * fz;
	const ul = Math.hypot( ux, uy, uz ) || 1;
	ux /= ul; uy /= ul; uz /= ul;
	const rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux;
	const toLocal = ( q ) => {

		const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z;
		return [ ( dx * rx + dy * ry + dz * rz ) / L, ( dx * ux + dy * uy + dz * uz ) / L, ( dx * fx + dy * fy + dz * fz ) / L ];

	};

	const A = toLocal( a ), B = toLocal( b );
	// broad phase: the segment's closest approach to the fish's axis box
	const R = maxRadius( model ) + 0.02;
	const segLen = Math.hypot( B[ 0 ] - A[ 0 ], B[ 1 ] - A[ 1 ], B[ 2 ] - A[ 2 ] );
	const minX = Math.min( A[ 0 ], B[ 0 ] ), maxX = Math.max( A[ 0 ], B[ 0 ] );
	const minY = Math.min( A[ 1 ], B[ 1 ] ), maxY = Math.max( A[ 1 ], B[ 1 ] );
	const minZ = Math.min( A[ 2 ], B[ 2 ] ), maxZ = Math.max( A[ 2 ], B[ 2 ] );
	if ( minX > R || maxX < - R || minY > R || maxY < - R || minZ > 0.5 || maxZ < 0.5 - S.body ) return null;
	// march along the segment in steps of 1 % of the fish's length
	const n = Math.min( 400, Math.max( 2, Math.ceil( segLen / 0.01 ) ) );
	let first = - 1, inside = 0, hit = null, mu = 0, my = 0, mx = 0;
	for ( let k = 0; k <= n; k ++ ) {

		const t = k / n;
		const x = A[ 0 ] + ( B[ 0 ] - A[ 0 ] ) * t, y = A[ 1 ] + ( B[ 1 ] - A[ 1 ] ) * t, z = A[ 2 ] + ( B[ 2 ] - A[ 2 ] ) * t;
		const u = ( 0.5 - z ) / S.body;
		if ( u < 0 || u > 1 ) continue;
		section( model, u, _s );
		const e = ( ( y - _s.yc ) / _s.ry ) ** 2 + ( x / _s.rx ) ** 2;
		if ( e <= 1 ) {

			inside ++;
			mu += u; my += y; mx += x;
			if ( first < 0 ) {

				first = k;
				hit = { t, u, x, y, yc: _s.yc, ry: _s.ry, rx: _s.rx };

			}

		}

	}

	if ( ! hit ) return null;
	// how far the path runs inside the body (units of L), and the middle of that run: the zone it
	// went through (the entry on a flank says little about the height inside a deep body)
	hit.inside = inside * segLen / n;
	hit.u = mu / inside;
	section( model, hit.u, _s );
	hit.y = my / inside;
	hit.x = mx / inside;
	hit.yc = _s.yc; hit.ry = _s.ry; hit.rx = _s.rx;
	return hit;

}

// The zone the shaft entered: kill shots behind the eye or along the spine, a solid hold through
// the head or the shoulders, a weak one through the belly or the thin tail.
export function zoneOf( model, hit ) {

	const S = anatomy( model );
	const u = hit.u, yn = ( hit.y - hit.yc ) / hit.ry; // -1 belly .. 1 back
	const eu = S.eye ? S.eye.u : 0.12, er = S.eye ? S.eye.r : 0.03, op = S.opercle || 0.25;
	if ( u >= eu - er && u <= op + 0.03 && yn > - 0.25 && yn < 0.85 ) return 'brain';
	if ( u > op + 0.03 && u < 0.8 && yn > - 0.05 && yn < 0.45 && Math.abs( hit.x / hit.rx ) < 0.45 ) return 'spine';
	if ( u < op + 0.03 ) return 'head';
	if ( u > 0.72 ) return 'tail';
	if ( yn < - 0.3 ) return 'belly';
	return 'back';

}

// zone: [ thrust left in the fish, hold of the shaft in the flesh, kills at once ]
export const ZONES = {
	brain: { thrust: 0, hold: 1.2, stoned: true, label: 'Stone shot! Through the brain' },
	spine: { thrust: 0.12, hold: 1.2, stoned: true, label: 'Spine shot: it\'s paralysed' },
	head: { thrust: 0.6, hold: 1.3, label: 'Head shot: a solid hold' },
	back: { thrust: 1, hold: 1, label: 'Body shot, through the flank' },
	belly: { thrust: 1, hold: 0.45, label: 'Belly shot: soft flesh, the shaft may tear out' },
	tail: { thrust: 1.15, hold: 0.55, label: 'Tail shot: it\'s going to pull hard' },
};

// Energy at impact against what it takes to pass through: 'bounce' (glances off the scales),
// 'lodged' (stuck in it, the flopper can't open), 'through' (out the far side, flopper open).
//   v: shaft speed at impact (m/s); mass: shaft (kg); L: fish total length (m); hit: hitTest
export function penetration( v, mass, L, hit, model ) {

	const S = anatomy( model );
	const E = 0.5 * mass * v * v;
	// tissue: ~45 J per metre of body crossed, plus breaking through the scales on both sides
	const thick = Math.max( 0.02, hit.inside ) * L;
	const scales = 0.25 + 1.8 * ( S.scales || 0.006 ) * 100 * L;
	const need = 45 * thick + scales;
	if ( E < need * 0.45 ) return { result: 'bounce', E, need };
	if ( E < need ) return { result: 'lodged', E, need };
	return { result: 'through', E, need };

}

// speed of a shaft that left at v0 after s metres (drag only; gravity is small at these speeds)
export const speedAfter = ( v0, s ) => v0 * Math.exp( - SHAFT_DRAG * s );

// One step of a free shaft: position p, velocity v (both {x,y,z}), in place
export function stepShaft( p, v, dt ) {

	const s = Math.hypot( v.x, v.y, v.z );
	const k = Math.exp( - SHAFT_DRAG * s * dt ); // dv/dt = -k |v| v, exact for the speed over dt
	v.x *= k; v.y *= k; v.z *= k;
	v.y -= SINK * dt * Math.min( 1, 3 / Math.max( s, 0.5 ) ); // a fast shaft barely drops
	p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
	return p;

}

// ---- the fish on the line
// What a speared fish does depends on how it was hit and how big it is:
//   stoned   a brain or spine shot: it hangs limp; haul it in and grab it
//   quick    under BIG_KG: a few seconds of thrashing on the shaft, a short haul and a grab
//   big      it runs. Hold on (it tows you, costs breath, and the shaft can tear out), let a reel
//            pay out line, or let go of the gun (tow): on a float line the float tires it at the
//            surface and you pull it in from the top, where you can breathe
// A grouper or a snapper may bolt into a hole in the reef instead (goHole) and wedge itself in:
// pulling then only tears the shaft out; left alone it calms down, and a diver who reaches in
// can work it out by hand.
//   kg, id (FishTable), zone, through (the flopper opened), lineMax (m before the line stops it),
//   reel: { drag N, lineM } or null, shaftHold: multiplier of the shaft's flopper / barbs
export const BIG_KG = 2;
export const GUN_BODY = { mass: 2.5, drag: 6, sink: 0.8 }; // a gun dragged through the water (kg, N per m/s, m/s^2)
export const FLOAT_BODY = { mass: 4, drag: 45 }; // a torpedo float dragged at the surface
const HAND_PULL = 260; // N: the most a diver hauls with
const DRAG_PAYOUT = 70; // N: a float line in hand slips through the fingers above this

export class SpearFight {

	constructor( { kg, id, zone, through = true, lineMax = 4, reel = null, shaftHold = 1, rng = Math.random } ) {

		const f = FISH[ id ] || { fight: 0.4, stamina: 6 };
		const Z = ZONES[ zone ] || ZONES.back;
		this.kg = kg;
		this.zone = zone;
		this.through = through;
		this.rng = rng;
		this.mass = kg * 1.6; // with the water it drags along
		this.drag = 3.5 * Math.pow( kg, 0.67 ); // N per m/s
		this.stoned = !! Z.stoned;
		this.big = ! this.stoned && kg >= BIG_KG;
		this.quick = ! this.stoned && ! this.big;
		// a fish pulls with a few times its weight in bursts; reef fish less than jacks. A small one on
		// the shaft only thrashes, briefly
		this.strength = ( 6 + 30 * f.fight ) * Math.pow( kg, 0.75 ) * Z.thrust * ( this.quick ? 0.2 : 1 );
		this.staminaS = f.stamina * ( zone === 'head' ? 0.6 : 1 );
		if ( this.quick ) this.staminaS = Math.min( this.staminaS, 1.5 );
		this.stamina = 1;
		// the shaft's hold in the flesh (N) before it starts to tear out
		this.holdN = ( 40 + 260 * Math.min( 1, Math.pow( kg / 4, 0.5 ) ) ) * Z.hold * ( through ? 1 : 0.55 ) * shaftHold;
		this.lineMax = lineMax;
		this.reel = reel;
		this.lineOut = 0; // set by start()
		this.tension = 0; // N, at the shaft
		this.tear = 0; // 0..1: torn out at 1
		this.surge = 0;
		this._surgeT = 0.3 + rng() * 0.8; // the first run comes at once
		this._wander = rng() * 6.28;
		this.result = null; // 'free' (torn out)
		this.p = { x: 0, y: 0, z: 0 };
		this.v = { x: 0, y: 0, z: 0 };
		this.thrust = { x: 0, y: 0, z: 0 };
		// holing up: null, 'going' (swimming for the hole) or 'wedged'; wedge 1 tight .. 0 calmed down
		this.hole = null;
		this.holeState = null;
		this.wedge = 0;

	}

	start( fishPos, anchor, vel = null ) {

		Object.assign( this.p, fishPos );
		if ( vel ) Object.assign( this.v, vel );
		this.lineOut = Math.max( 0.8, Math.hypot( fishPos.x - anchor.x, fishPos.y - anchor.y, fishPos.z - anchor.z ) );
		this.lineOut = Math.min( this.lineOut, this.lineMax );

	}

	get distance() {

		return this.lineOut;

	}

	// it bolts for a hole in the reef at pt ({x,y,z}) and wedges itself in
	goHole( pt ) {

		this.hole = { x: pt.x, y: pt.y, z: pt.z };
		this.holeState = 'going';
		this.wedge = 1;
		this._goingT = 0;

	}

	get wedged() {

		return this.holeState === 'wedged';

	}

	// its own swimming for one step: away from `from` in surges (or for its hole), tiring
	_swim( dt, from, floorY, ceilY ) {

		const p = this.p, v = this.v, f = this.thrust;
		if ( this.wedged ) {

			v.x = v.y = v.z = 0;
			f.x = f.y = f.z = 0;
			return f;

		}

		let dx = p.x - from.x, dy = p.y - from.y, dz = p.z - from.z;
		const d = Math.hypot( dx, dy, dz ) || 1e-4;
		let nx = dx / d, ny = dy / d, nz = dz / d;
		f.x = f.y = f.z = 0;
		if ( ! this.stoned && this.stamina > 0 ) {

			this._surgeT -= dt;
			if ( this._surgeT <= 0 ) {

				this.surge = 0.6 + 0.4 * this.rng();
				this._surgeT = 1.2 + this.rng() * 2.5;

			}

			this.surge = Math.max( 0, this.surge - dt * 0.7 );
			this._wander += dt * ( 1.5 + this.surge * 3 );
			let w = Math.sin( this._wander ) * 0.8, down = 0.15, k = 1;
			if ( this.holeState === 'going' ) {

				// straight for the hole, hard
				const h = this.hole;
				const hx = h.x - p.x, hy = h.y - p.y, hz = h.z - p.z, hl = Math.hypot( hx, hy, hz ) || 1e-4;
				nx = hx / hl; ny = hy / hl; nz = hz / hl;
				w = 0; down = 0; k = 1.4;
				this.surge = Math.max( this.surge, 0.7 );

			}

			const sx = - nz, sz = nx; // sideways
			const T = k * this.strength * ( 0.25 + 0.75 * this.stamina ) * ( 0.45 + 0.9 * this.surge );
			f.x = ( nx + sx * w ) * T;
			f.y = ( ( this.holeState === 'going' ? ny : ny * 0.5 ) - down ) * T; // fish sound downward, toward cover
			f.z = ( nz + sz * w ) * T;
			this.stamina = Math.max( 0, this.stamina - dt * ( 0.4 + this.surge ) / this.staminaS );

		} else f.y = - this.kg * 0.4; // a dead fish sinks slowly

		const ax = f.x - v.x * this.drag, ay = f.y - v.y * this.drag, az = f.z - v.z * this.drag;
		v.x += ax / this.mass * dt; v.y += ay / this.mass * dt; v.z += az / this.mass * dt;
		p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
		if ( p.y < floorY + 0.15 ) { p.y = floorY + 0.15; v.y = Math.max( 0, v.y ); }
		if ( p.y > ceilY - 0.1 ) { p.y = ceilY - 0.1; v.y = Math.min( 0, v.y ); }
		// into its hole: there, or wherever the line or its strength stopped it (a crack nearer by)
		if ( this.holeState === 'going' ) {

			const h = this.hole;
			this._goingT += dt;
			if ( Math.hypot( h.x - p.x, h.y - p.y, h.z - p.z ) < 0.3 || this.stamina <= 0 || this._goingT > 3 ) {

				this.holeState = 'wedged';
				h.x = p.x; h.y = p.y; h.z = p.z;
				v.x = v.y = v.z = 0;

			}

		}

		return f;

	}

	_tear( dt ) {

		if ( this.tension > this.holdN ) this.tear += dt * ( this.tension / this.holdN - 1 ) * 2.5;
		else this.tear = Math.max( 0, this.tear - dt * 0.05 );
		if ( this.tear >= 1 ) this.result = 'free';

	}

	// wedged in its hole: it doesn't move; a pull on the line only loads the shaft. Left alone, it
	// calms down; pulled, it braces again
	_wedgedLine( dt, T ) {

		this.tension += ( T - this.tension ) * ( 1 - Math.exp( - dt * 10 ) );
		if ( this.tension < 25 ) {

			this.wedge = Math.max( 0, this.wedge - dt / 18 );
			this.stamina = Math.max( 0, this.stamina - dt / 40 );

		} else if ( this.tension > 60 ) this.wedge = Math.min( 1, this.wedge + dt * 0.15 );
		this._tear( dt );

	}

	// The gun in the diver's hand. anchor: the muzzle; hauling: hand over hand on the line; floorY:
	// the bottom under the fish; ceilY: the surface. Returns the pull on the diver, toward the fish
	// ({x,y,z}, N).
	update( dt, anchor, hauling, floorY = - 1e9, ceilY = 0, out = { x: 0, y: 0, z: 0 } ) {

		const p = this.p, v = this.v;
		const f = this._swim( dt, anchor, floorY, ceilY );
		let dx = p.x - anchor.x, dy = p.y - anchor.y, dz = p.z - anchor.z;
		let d = Math.hypot( dx, dy, dz ) || 1e-4;
		// slack line is taken in as the diver closes the distance
		if ( d < this.lineOut ) this.lineOut = Math.max( d, this.lineOut - dt * 1.5 );
		if ( this.wedged ) {

			// it won't come: hauling only stretches the line against the reef
			if ( hauling ) this.lineOut = Math.max( d - 0.6, this.lineOut - 0.4 * dt );
			let T = 0;
			if ( d > this.lineOut ) {

				T = Math.min( HAND_PULL, ( d - this.lineOut ) * 400 );
				out.x = dx / d * T; out.y = dy / d * T; out.z = dz / d * T;

			} else { out.x = 0; out.y = 0; out.z = 0; }

			this._wedgedLine( dt, T );
			return out;

		}

		// hauling shortens the line: briskly for a small or limp fish, as fast as hands go while a
		// big one isn't pulling hard
		const haul = ! hauling ? 0 : this.big && this.stamina > 0 ? Math.max( 0, 0.85 - this.tension / 400 ) : 1.3;
		this.lineOut = Math.max( 0.5, this.lineOut - haul * dt );
		dx = p.x - anchor.x; dy = p.y - anchor.y; dz = p.z - anchor.z;
		d = Math.hypot( dx, dy, dz ) || 1e-4;
		let T = 0;
		if ( d > this.lineOut ) {

			// taut: the line holds the fish at its length; the tension is the force it takes
			const ex = dx / d, ey = dy / d, ez = dz / d;
			const vOut = v.x * ex + v.y * ey + v.z * ez;
			const pull = Math.max( 0, f.x * ex + f.y * ey + f.z * ez );
			T = pull + Math.max( 0, vOut ) * this.mass / Math.max( dt, 1e-3 ) * 0.5 + ( d - this.lineOut ) * 400;
			// a reel pays line out under its drag instead of holding hard
			if ( this.reel && T > this.reel.drag && this.lineOut < this.reel.lineM ) {

				this.lineOut = Math.min( this.reel.lineM, this.lineOut + ( T - this.reel.drag ) / ( this.mass * 8 + 20 ) * dt * 4 );
				T = this.reel.drag + ( T - this.reel.drag ) * 0.25;

			}

			const L = Math.min( d, this.lineOut );
			p.x = anchor.x + ex * L; p.y = anchor.y + ey * L; p.z = anchor.z + ez * L;
			if ( vOut > 0 ) { v.x -= ex * vOut; v.y -= ey * vOut; v.z -= ez * vOut; }
			out.x = ex * T; out.y = ey * T; out.z = ez * T;

		} else { out.x = 0; out.y = 0; out.z = 0; }

		this.tension += ( T - this.tension ) * ( 1 - Math.exp( - dt * 10 ) );
		this._tear( dt );
		return out;

	}

	// The diver let go of the gun: the fish tows it (and the float, on a float line) on its own.
	//   gun: { p, v } (its muzzle, where the shooting line is clipped)
	//   float: null, or { p, v, lineOut, lineM, held, hauling }: the float line from the gun's butt
	//     to the float; held: the diver has the line in hand at p (it doesn't move), and hauling
	//     pulls it in; it slips through the fingers when the fish pulls hard
	// Returns the pull at the diver's hand while held ({x,y,z} toward the gun, N), else zero.
	tow( dt, gun, float, floorY = - 1e9, ceilY = 0, waterY = 0, out = { x: 0, y: 0, z: 0 } ) {

		const p = this.p, v = this.v;
		this._swim( dt, gun.p, floorY, ceilY );
		// the gun: drag, a slow sink, the bottom
		const G = GUN_BODY;
		const kg = Math.exp( - G.drag / G.mass * dt );
		gun.v.x *= kg; gun.v.y = gun.v.y * kg - G.sink * dt; gun.v.z *= kg;
		gun.p.x += gun.v.x * dt; gun.p.y += gun.v.y * dt; gun.p.z += gun.v.z * dt;
		const gFloor = gun.floorY ?? floorY;
		if ( gun.p.y < gFloor + 0.1 ) { gun.p.y = gFloor + 0.1; gun.v.y = Math.max( 0, gun.v.y ); gun.v.x *= 0.9; gun.v.z *= 0.9; }
		if ( float ) {

			if ( float.held ) {

				float.v.x = float.v.y = float.v.z = 0;
				if ( float.hauling ) {

					// slack comes in as fast as hands go; a loaded line slowly
					const d = Math.hypot( gun.p.x - float.p.x, gun.p.y - float.p.y, gun.p.z - float.p.z );
					float.lineOut = float.lineOut > d + 0.1 ? Math.max( d, float.lineOut - 3 * dt ) : Math.max( 0, float.lineOut - 0.9 * dt );

				}

			} else {

				const kf = Math.exp( - FLOAT_BODY.drag / FLOAT_BODY.mass * dt );
				float.v.x *= kf; float.v.z *= kf; float.v.y = 0;
				float.p.x += float.v.x * dt; float.p.z += float.v.z * dt;
				float.p.y = waterY;

			}

		}

		// the lines: fish to gun (the shooting line), gun to float; inverse masses (a wedged fish and
		// a float in hand don't give)
		const fish = { p, v, inv: this.wedged ? 0 : 1 / this.mass };
		const gb = { p: gun.p, v: gun.v, inv: 1 / G.mass };
		const fb = float && { p: float.p, v: float.v, inv: float.held ? 0 : 1 / FLOAT_BODY.mass, keepY: ! float.held };
		let Tshaft = 0, Thand = 0;
		for ( let it = 0; it < 3; it ++ ) {

			Tshaft = Math.max( Tshaft, link( fish, gb, this.lineOut, dt ) );
			if ( fb ) Thand = Math.max( Thand, link( gb, fb, float.lineOut, dt ) );

		}

		if ( fb && float.held && Thand > DRAG_PAYOUT ) float.lineOut = Math.min( float.lineM, float.lineOut + ( Thand - DRAG_PAYOUT ) / 120 * dt );
		if ( fb && float.held ) {

			const dx = gun.p.x - float.p.x, dy = gun.p.y - float.p.y, dz = gun.p.z - float.p.z, d = Math.hypot( dx, dy, dz ) || 1e-4;
			const T = d >= float.lineOut - 0.02 ? Math.min( Thand, 400 ) : 0;
			out.x = dx / d * T; out.y = dy / d * T; out.z = dz / d * T;

		} else { out.x = 0; out.y = 0; out.z = 0; }

		if ( this.wedged ) this._wedgedLine( dt, Tshaft );
		else {

			this.tension += ( Tshaft - this.tension ) * ( 1 - Math.exp( - dt * 10 ) );
			this._tear( dt );

		}

		this.handTension = Thand;
		return out;

	}

}

// a line of length L between two bodies { p, v, inv (1 / mass), keepY }: if it is stretched, both
// move back along it in proportion to their inverse masses and lose the speed that parts them.
// Returns the tension it took (N).
function link( a, b, L, dt ) {

	const dx = a.p.x - b.p.x, dy = a.p.y - b.p.y, dz = a.p.z - b.p.z;
	const d = Math.hypot( dx, dy, dz );
	const w = a.inv + b.inv;
	if ( d <= L || d < 1e-6 || w <= 0 ) return 0;
	const nx = dx / d, ny = dy / d, nz = dz / d, e = d - L;
	const wa = a.inv / w, wb = b.inv / w;
	a.p.x -= nx * e * wa; a.p.y -= ny * e * wa; a.p.z -= nz * e * wa;
	b.p.x += nx * e * wb; b.p.z += nz * e * wb;
	if ( ! b.keepY ) b.p.y += ny * e * wb;
	const vrel = ( a.v.x - b.v.x ) * nx + ( a.v.y - b.v.y ) * ny + ( a.v.z - b.v.z ) * nz;
	let J = 0;
	if ( vrel > 0 ) {

		J = vrel / w; // the impulse that stops them parting (N s)
		a.v.x -= nx * J * a.inv; a.v.y -= ny * J * a.inv; a.v.z -= nz * J * a.inv;
		b.v.x += nx * J * b.inv; b.v.z += nz * J * b.inv;
		if ( ! b.keepY ) b.v.y += ny * J * b.inv;

	}

	return J / Math.max( dt, 1e-3 ) + e * 300;

}

// ---- breath-hold
// Oxygen as the fraction in the lungs (0.21 after a breathe-up); its partial pressure is that times
// the ambient pressure (1 + depth / 10 atm), so a diver at 15 m feels fine and blacks out on the
// way up. CO2 builds with time and effort and brings the urge to breathe, then contractions.
export const PPO2_BLACKOUT = 0.055; // atm (about 42 mmHg)
export const PPO2_HYPOXIC = 0.085; // tunnel vision below this
// Surface interval: freedivers rest at least twice as long as they were down (2:1). Each second
// under adds 2 s of rest owed; each second at the top pays one off. Diving again before it is paid
// burns oxygen faster on that dive, up to REST_MAX_PENALTY more when a whole breath-hold is owed.
export const REST_RATIO = 2;
export const REST_MAX_PENALTY = 0.6;

export class Apnea {

	constructor( { holdS = 70 } = {} ) {

		this.holdS = holdS; // calm breath-hold at the surface, in seconds, to blackout
		this.o2 = 0.21;
		this.co2 = 0; // 0 .. 1 (1: unbearable urge)
		this.under = false;
		this.diveTime = 0;
		this.maxDepth = 0;
		this.surfaceTime = 0;
		this.blackout = false;
		this.ppo2 = 0.21;
		this.lastDive = null; // { time, depth } of the dive before
		this._contraction = 0;
		this.contractions = 0;
		this.restDebt = 0; // seconds of surface rest still owed (2 per second under)
		this.rested = true; // the last surface interval met 2:1
		this._penalty = 0; // extra O2 use on this dive from the rest owed at its start

	}

	// how much faster O2 goes on a dive started with `debt` seconds of rest owed
	penaltyFor( debt ) {

		return Math.min( REST_MAX_PENALTY, REST_MAX_PENALTY * debt / ( this.holdS * REST_RATIO ) );

	}

	// the surface interval the last dive asks for, and how far into it you are (0..1)
	get restNeeded() {

		return this.lastDive ? this.lastDive.time * REST_RATIO : 0;

	}

	// effort: 1 gliding / still, ~1.4 finning, ~2.2 sprinting, more loading the gun or fighting a fish
	update( dt, { under, depth, effort = 1 } ) {

		const P = 1 + Math.max( 0, depth ) / 10;
		if ( under ) {

			if ( ! this.under ) {

				this.diveTime = 0;
				this.maxDepth = 0;
				this.contractions = 0;
				this.surfaceTimeBefore = this.surfaceTime;
				this._penalty = this.penaltyFor( this.restDebt );
				this.rested = this.restDebt <= 0;

			}

			this.diveTime += dt;
			this.maxDepth = Math.max( this.maxDepth, depth );
			// calm, still: 0.21 -> blackout in holdS seconds at the surface's pressure
			const rate = ( 0.21 - PPO2_BLACKOUT ) / this.holdS * effort * ( 1 + this._penalty );
			this.o2 = Math.max( 0, this.o2 - rate * dt );
			this.co2 = Math.min( 1.4, this.co2 + dt * effort * ( 1 + this._penalty ) / ( this.holdS * 0.9 ) );
			this.surfaceTime = 0;
			this.restDebt += dt * REST_RATIO;
			// contractions: the diaphragm, every few seconds once the urge is strong
			if ( this.co2 > 0.6 ) {

				this._contraction -= dt;
				if ( this._contraction <= 0 ) {

					this._contraction = 3.5 - 2 * Math.min( 1, ( this.co2 - 0.6 ) / 0.5 );
					this.contractions ++;
					this.onContraction && this.onContraction( this.co2 );

				}

			}

		} else {

			if ( this.under ) this.lastDive = { time: this.diveTime, depth: this.maxDepth };
			this.surfaceTime += dt;
			this.restDebt = Math.max( 0, this.restDebt - dt );
			// breathing at the top: O2 back within ~20 s, the CO2 slower (breathe-up)
			this.o2 += ( 0.21 - this.o2 ) * ( 1 - Math.exp( - dt / 6 ) );
			this.co2 = Math.max( 0, this.co2 - dt / 18 );
			this._contraction = 0;

		}

		this.under = under;
		this.ppo2 = this.o2 * ( under ? P : 1 );
		if ( under && this.ppo2 < PPO2_BLACKOUT ) this.blackout = true;
		return this;

	}

	// 0 clear .. 1 about to black out (tunnel vision, the edges going grey)
	get hypoxia() {

		return Math.max( 0, Math.min( 1, ( PPO2_HYPOXIC - this.ppo2 ) / ( PPO2_HYPOXIC - PPO2_BLACKOUT ) ) );

	}

	// the urge to breathe as the diver feels it, 0 .. 1
	get urge() {

		return Math.min( 1, this.co2 );

	}

	recover() {

		this.blackout = false;
		this.o2 = 0.12;
		this.co2 = 0.5;
		this.under = false;

	}

}
