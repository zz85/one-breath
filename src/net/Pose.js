// A diver's pose on the wire, and the buffer that plays other divers' poses back smoothly.
// No DOM, no WebRTC: test/net-pose.mjs runs it in Node.
//
// One pose is 10 float32s (40 bytes), sent ~12 times a second (game/NetPlay.js):
//   0 t       sender's clock, seconds
//   1-3 x y z  the player's position (the feet on land, the float point swimming)
//   4 yaw  5 pitch   the view
//   6 mode    0 walk, 1 swim, 2 deck, 3 boat
//   7 flags   FLAG.* bits (duck: in a duck dive from the surface; aim: the gun raised to the eye;
//             loaded: bands loaded, 0-3, in two bits; shaftOut: the shaft is off the gun)
//   8 speed   m/s
//   9 depth   m below the surface (0 at or above it)

export const POSE_LEN = 10;
export const MODE_CODE = { walk: 0, swim: 1, deck: 2, boat: 3 };
export const MODE_NAME = [ 'walk', 'swim', 'deck', 'boat' ];
export const FLAG = { floating: 1, gun: 2, blackout: 4, duck: 8, aim: 16, loaded: 32, shaftOut: 128 }; // loaded: 2 bits (32, 64)

export function encodePose( p, out = new Float32Array( POSE_LEN ) ) {

	out[ 0 ] = p.t;
	out[ 1 ] = p.x; out[ 2 ] = p.y; out[ 3 ] = p.z;
	out[ 4 ] = p.yaw; out[ 5 ] = p.pitch;
	out[ 6 ] = MODE_CODE[ p.mode ] ?? 0;
	out[ 7 ] = ( p.floating ? FLAG.floating : 0 ) | ( p.gun ? FLAG.gun : 0 ) | ( p.blackout ? FLAG.blackout : 0 ) | ( p.duck ? FLAG.duck : 0 )
		| ( p.aim ? FLAG.aim : 0 ) | ( Math.min( 3, Math.max( 0, p.loaded | 0 ) ) * FLAG.loaded ) | ( p.shaftOut ? FLAG.shaftOut : 0 );
	out[ 8 ] = p.speed || 0;
	out[ 9 ] = p.depth || 0;
	return out;

}

// null where the bytes aren't a pose (wrong length, NaN or a position off any map)
export function decodePose( data ) {

	let a = data;
	if ( a instanceof ArrayBuffer ) a = new Float32Array( a );
	else if ( ArrayBuffer.isView( a ) && ! ( a instanceof Float32Array ) ) {

		if ( a.byteLength % 4 ) return null;
		a = new Float32Array( a.buffer, a.byteOffset, a.byteLength / 4 );

	}

	if ( ! ( a instanceof Float32Array ) || a.length < POSE_LEN ) return null;
	for ( let i = 0; i < POSE_LEN; i ++ ) if ( ! Number.isFinite( a[ i ] ) ) return null;
	if ( Math.abs( a[ 1 ] ) > 1e5 || Math.abs( a[ 2 ] ) > 1e4 || Math.abs( a[ 3 ] ) > 1e5 ) return null;
	const flags = a[ 7 ] | 0;
	return {
		t: a[ 0 ], x: a[ 1 ], y: a[ 2 ], z: a[ 3 ], yaw: a[ 4 ], pitch: a[ 5 ],
		mode: MODE_NAME[ a[ 6 ] | 0 ] || 'walk',
		floating: !! ( flags & FLAG.floating ), gun: !! ( flags & FLAG.gun ), blackout: !! ( flags & FLAG.blackout ), duck: !! ( flags & FLAG.duck ),
		aim: !! ( flags & FLAG.aim ), loaded: ( flags >> 5 ) & 3, shaftOut: !! ( flags & FLAG.shaftOut ),
		speed: a[ 8 ], depth: a[ 9 ],
	};

}

const wrap = ( a ) => Math.atan2( Math.sin( a ), Math.cos( a ) );
const lerpAngle = ( a, b, k ) => a + wrap( b - a ) * k;

// Plays a remote diver's poses back `delay` seconds behind, interpolating between the two poses
// around that time, so 12 updates a second look smooth and late packets don't jerk.
// The sender's clock is mapped to ours by the smallest ( arrival - sent ) seen: the packet that
// came fastest. That estimate creeps up slowly, so a clock that drifts or a route that gets
// slower is followed.
export class PoseBuffer {

	constructor( { delay = 0.12, keep = 2, maxExtrapolate = 0.25 } = {} ) {

		this.delay = delay;
		this.keep = keep;
		this.maxExtrapolate = maxExtrapolate;
		this.poses = [];
		this.offset = null; // our clock minus theirs, for the fastest packet
		this.lastArrival = - Infinity;

	}

	push( pose, now ) {

		const off = now - pose.t;
		if ( this.offset === null || off < this.offset ) this.offset = off;
		const P = this.poses;
		// out of order: drop it (newer is already here); a sender that restarted its clock: start over
		if ( P.length && pose.t <= P[ P.length - 1 ].t ) {

			if ( P[ P.length - 1 ].t - pose.t > 5 ) {

				P.length = 0;
				this.offset = off;

			} else return false;

		}

		P.push( pose );
		this.lastArrival = now;
		const oldest = pose.t - this.keep;
		while ( P.length > 2 && P[ 1 ].t < oldest ) P.shift();
		return true;

	}

	// seconds since the last pose arrived
	age( now ) {

		return now - this.lastArrival;

	}

	// the pose to draw now, or null before the first one
	sample( now, dt = 0, out = {} ) {

		const P = this.poses;
		if ( ! P.length ) return null;
		if ( dt > 0 && this.offset !== null ) this.offset += dt * 0.01; // creep: forget a lucky fast packet
		const t = now - ( this.offset ?? 0 ) - this.delay;
		let a = P[ 0 ], b = null;
		for ( let i = P.length - 1; i >= 0; i -- ) {

			if ( P[ i ].t <= t ) {

				a = P[ i ];
				b = P[ i + 1 ] || null;
				break;

			}

		}

		Object.assign( out, a );
		if ( t <= a.t ) return out; // before the first pose: hold it
		if ( b ) {

			const k = ( t - a.t ) / Math.max( 1e-4, b.t - a.t );
			out.x = a.x + ( b.x - a.x ) * k;
			out.y = a.y + ( b.y - a.y ) * k;
			out.z = a.z + ( b.z - a.z ) * k;
			out.yaw = lerpAngle( a.yaw, b.yaw, k );
			out.pitch = a.pitch + ( b.pitch - a.pitch ) * k;
			out.speed = a.speed + ( b.speed - a.speed ) * k;
			out.depth = a.depth + ( b.depth - a.depth ) * k;
			if ( k > 0.5 ) Object.assign( out, { mode: b.mode, floating: b.floating, gun: b.gun, blackout: b.blackout, duck: b.duck, aim: b.aim, loaded: b.loaded, shaftOut: b.shaftOut } );
			return out;

		}

		// past the newest pose (a packet is late): carry on along the last motion a little way
		const prev = P.length > 1 ? P[ P.length - 2 ] : null;
		if ( prev ) {

			const span = Math.max( 1e-4, a.t - prev.t );
			const e = Math.min( t - a.t, this.maxExtrapolate ) / span;
			out.x = a.x + ( a.x - prev.x ) * e;
			out.y = a.y + ( a.y - prev.y ) * e;
			out.z = a.z + ( a.z - prev.z ) * e;

		}

		return out;

	}

}

// a stable hue for a user id, so everyone sees the same diver in the same colour
export function hueOf( id ) {

	let h = 2166136261;
	for ( let i = 0; i < id.length; i ++ ) h = Math.imul( h ^ id.charCodeAt( i ), 16777619 );
	return ( ( h >>> 0 ) % 360 ) / 360;

}

// a room code for an invite link: 6 letters and digits, without the ones people misread
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function makeDiveCode( rand = Math.random ) {

	let s = '';
	for ( let i = 0; i < 6; i ++ ) s += ALPHABET[ Math.floor( rand() * ALPHABET.length ) ];
	return s;

}

export function cleanDiveCode( s ) {

	const c = String( s || '' ).toLowerCase().replace( /[^a-z0-9]/g, '' ).slice( 0, 16 );
	return c.length >= 4 ? c : null;

}

// what a player may call themselves, and say
export function cleanName( s ) {

	return String( s || '' ).replace( /[\u0000-\u001f\u007f]/g, '' ).trim().slice( 0, 20 );

}

export function cleanChat( s ) {

	return String( s || '' ).replace( /[\u0000-\u001f\u007f]/g, ' ' ).trim().slice( 0, 200 );

}

// a speargun as a profile carries it: its length (m), bands and kind; null where it isn't one
export function cleanGear( g ) {

	if ( ! g || typeof g !== 'object' ) return null;
	const gunM = Number( g.gunM ), bands = Number( g.bands );
	if ( ! Number.isFinite( gunM ) || gunM < 0.4 || gunM > 1.6 ) return null;
	return { gunM: Math.round( gunM * 100 ) / 100, bands: bands >= 2 ? 2 : 1, gunKind: [ 'wood', 'teak', 'carbon' ].includes( g.gunKind ) ? g.gunKind : 'wood' };

}

// a shot as it goes on the wire: from p along d (normalized) at v m/s; null where it isn't one
export function cleanShot( s ) {

	if ( ! s || ! Array.isArray( s.p ) || ! Array.isArray( s.d ) || s.p.length !== 3 || s.d.length !== 3 ) return null;
	const p = s.p.map( Number ), d = s.d.map( Number ), v = Number( s.v );
	if ( ! [ ...p, ...d, v ].every( Number.isFinite ) || p.some( ( x ) => Math.abs( x ) > 1e5 ) || v <= 0 || v > 60 ) return null;
	const n = Math.hypot( ...d );
	if ( n < 0.5 ) return null;
	return { p, d: d.map( ( x ) => x / n ), v };

}
