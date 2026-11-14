// The host's animals in a dive room, without the network or a GPU: the host's FishSchools sends
// its big animals and bait ball five times a second (netState), a guest's own simulation is pulled
// toward them (applyNet / netCorrect), and the whale follows the host's along its route.
//   node test/net-life.mjs
import * as E from '../src/engine/index.js';
import { WORLD } from '../src/world/WorldLayout.js';
import { FishSchools } from '../src/world/Fish.js';
import { WhaleBrain } from '../src/world/marine/WhaleBrain.js';
import { TerrainData } from '../src/world/TerrainData.js';

let fails = 0;
const check = ( ok, what ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + what );
	if ( ! ok ) fails ++;

};

const terrain = new TerrainData();
const rc = WORLD.reef.center;
const make = () => new FishSchools( { parent: new E.Group(), terrain, center: rc.clone(), radius: WORLD.reef.radius + 10 } );
const host = make(), guest = make(), alone = make();
// what makes two players' worlds drift apart in a real game: their own random draws and frame rates
let seed = 99;
const rnd = () => ( ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 );
for ( const w of [ guest, alone ] ) for ( const g of w.groups ) {

	let s = Math.floor( rnd() * 1e9 );
	g.rng = () => ( ( s = ( s * 48271 ) % 2147483647 ) / 2147483647 );

}
const idx = host.netGroups();
const names = idx.map( ( i ) => host.groups[ i ].sp.name );
check( names.includes( 'bait' ) && names.includes( 'turtle' ) && names.includes( 'eagleRay' ) && ! names.includes( 'chromis' ) && ! names.includes( 'wrasse' ), `shared: the bait ball and the big animals, not the reef fish (${ [ ...new Set( names ) ].join( ', ' ) })` );
check( JSON.stringify( idx ) === JSON.stringify( guest.netGroups() ), 'every client numbers the groups the same' );

// the host floats at the drop-off over the bait ball; the guest is 15 m away. Each sees the
// other as one of `others`. The third world has no host: it shows how far apart they drift.
const bait = host.groups.find( ( g ) => g.sp.name === 'bait' );
const hostAt = bait.center.clone().add( new E.Vector3( 0, 1, 6 ) );
const guestAt = hostAt.clone().add( new E.Vector3( 15, 0, 0 ) );
host.others = [ guestAt ];
guest.others = [ hostAt ];
alone.others = [ hostAt ];
const sent = [];
let bytes = 0;
const DT = 1 / 60, DG = 1 / 45;
let tg = 0;
for ( let f = 0; f < 60 * 40; f ++ ) {

	host.update( DT, hostAt );
	// the guest's game runs at 45 fps
	while ( tg < ( f + 1 ) * DT ) {

		guest.update( DG, guestAt );
		alone.update( DG, guestAt );
		tg += DG;

	}

	if ( f % 12 === 0 ) {

		const s = host.netState();
		bytes = Math.max( bytes, s.byteLength );
		sent.push( s );
		// on the way: 80 ms
		if ( sent.length > 0 ) guest.applyNet( sent.shift(), 0.08 );

	}

}

check( bytes < 4096, `one message of the host's animals: ${ bytes } bytes` );
const gap = ( a, b, gi ) => {

	const ga = a.groups[ gi ], gb = b.groups[ gi ];
	if ( ga.count > 10 ) return ga.center.distanceTo( gb.center );
	let m = 0;
	for ( let k = 0; k < ga.count; k ++ ) {

		const i = ( ga.offset + k ) * 3;
		m = Math.max( m, Math.hypot( a.pos[ i ] - b.pos[ i ], a.pos[ i + 1 ] - b.pos[ i + 1 ], a.pos[ i + 2 ] - b.pos[ i + 2 ] ) );

	}

	return m;

};
const near = idx.filter( ( gi ) => host.groups[ gi ].active && guest.groups[ gi ].active );
const synced = near.map( ( gi ) => gap( host, guest, gi ) ), free = near.map( ( gi ) => gap( host, alone, gi ) );
const worst = Math.max( ...synced ), worstFree = Math.max( ...free );
console.log( '     after 40 s, the farthest any shared animal is from the host\'s:', near.map( ( gi, k ) => `${ host.groups[ gi ].sp.name } ${ synced[ k ].toFixed( 1 ) } m (free ${ free[ k ].toFixed( 1 ) })` ).join( ', ' ) );
check( near.length >= 4, `${ near.length } shared groups near the two divers` );
check( worst < 2.5, `with the host's word: within ${ worst.toFixed( 1 ) } m of where the host has them` );
check( worstFree > 4 * worst, `on their own they drift ${ worstFree.toFixed( 1 ) } m apart` );
const bh = bait.ball, bg = guest.groups[ host.groups.indexOf( bait ) ].ball;
check( Math.abs( bh - bg ) < 0.2, `the bait ball is balled up the same (${ bh.toFixed( 2 ) } / ${ bg.toFixed( 2 ) })` );
// the host stops sending (left): the guest's animals swim on their own
for ( let f = 0; f < 60 * 4; f ++ ) guest.update( DT, guestAt );
check( guest._net.size === 0, 'no word from the host for 3 s: they swim free' );

// ---- the whale
const wh = new WhaleBrain( { terrain, seed: 1 } ), wg = new WhaleBrain( { terrain, seed: 7 } );
wg.u += 60; // the guest's is somewhere else along its route
let blowH = [], blowG = [], tt = 0;
wh.onBlow = () => blowH.push( tt );
wg.onBlow = () => blowG.push( tt );
for ( let f = 0; f < 60 * 240; f ++ ) {

	tt = f * DT;
	wh.update( DT );
	wg.update( DT );
	if ( f % 60 === 0 ) wg.applyNet( JSON.parse( JSON.stringify( wh.netState() ) ), 0.08 );

}

const d = wh.position.distanceTo( wg.position );
check( d < 1.5, `the guest's whale swims where the host's does (${ d.toFixed( 2 ) } m apart after 4 min)` );
check( blowH.length > 0 && blowG.length >= blowH.length - 1 && blowH.slice( - 3 ).every( ( t ) => blowG.some( ( u ) => Math.abs( u - t ) < 1.2 ) ), `it blows when the host's does (${ blowH.length } breaths: ${ blowH.slice( - 3 ).map( ( t ) => t.toFixed( 0 ) ) } s / ${ blowG.slice( - 3 ).map( ( t ) => t.toFixed( 0 ) ) } s)` );
check( wg.applyNet( { u: 'x' } ) === false && wg.applyNet( null ) === false, 'junk for a whale is ignored' );

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
