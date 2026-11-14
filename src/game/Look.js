// What your freediver wears (game/Diver.js draws it): the suit, the accent (the side stripes, the
// mask strap, the snorkel) and the fin blades, each a colour. Kept in this browser, worn in single
// player as well, and sent to the others in a dive (net/DiveRoom.js's profile).
//   { suit, accent, fins }: hex numbers, each optional (a black suit, the accent from your
//   colour, fins to match)
const KEY = 'onebreath.look';

// the swatches the suit picker offers (ui/SuitPicker.js); any colour is taken from someone else
export const SUIT_COLOURS = {
	suit: { Black: 0x16191c, Charcoal: 0x3a3d42, Navy: 0x1b2a44, Ocean: 0x1f4f7a, Reef: 0x3a4a2e, Sand: 0x8a7656, Red: 0x6e1c1c, White: 0xc9c9c0 },
	accent: { Aqua: 0x2fd0c0, Orange: 0xff7a1a, Yellow: 0xffd21f, Pink: 0xff4fa0, Lime: 0x8bd62a, Red: 0xe8322e, White: 0xf0f0f0, Purple: 0x8a5cff },
	fins: { Black: 0x111316, Carbon: 0x2e3236, Blue: 0x1f6fd1, Aqua: 0x2fd0c0, Red: 0xd12a2a, Yellow: 0xe8c21a, Green: 0x2e9a4a, White: 0xe8e8e8 },
};

// a look from anywhere (a save, the wire): only colours, only the three parts; null for none
export function cleanLook( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return null;
	const out = {};
	for ( const k of [ 'suit', 'accent', 'fins' ] ) {

		const v = raw[ k ];
		if ( Number.isInteger( v ) && v >= 0 && v <= 0xffffff ) out[ k ] = v;

	}

	return Object.keys( out ).length ? out : null;

}

export function loadLook() {

	try {

		return cleanLook( JSON.parse( localStorage.getItem( KEY ) || 'null' ) );

	} catch ( e ) {

		return null;

	}

}

export function saveLook( look ) {

	try {

		localStorage.setItem( KEY, JSON.stringify( cleanLook( look ) ) );

	} catch ( e ) { /* private mode */ }

}

export const hexCss = ( v ) => '#' + ( v >>> 0 ).toString( 16 ).padStart( 6, '0' );

// your look: the saved one, or a black suit with a trim and fins picked at random, saved so that
// you look the same to yourself and to everyone else from now on
export function myLook( rand = Math.random ) {

	const saved = loadLook();
	if ( saved && saved.suit !== undefined && saved.accent !== undefined && saved.fins !== undefined ) return saved;
	const acc = Object.values( SUIT_COLOURS.accent );
	const accent = acc[ Math.floor( rand() * acc.length ) ];
	const look = { suit: SUIT_COLOURS.suit.Black, accent, fins: rand() < 0.5 ? accent : SUIT_COLOURS.fins.Black, ...( saved || {} ) };
	saveLook( look );
	return look;

}

// a player's colour for their name, tag and chat lines: their suit's trim, else their hue
export function personColour( who ) {

	if ( who && who.look && who.look.accent !== undefined ) return hexCss( who.look.accent );
	return `hsl(${ Math.round( ( who && who.hue !== undefined ? who.hue : 0.5 ) * 360 ) } 80% 62%)`;

}
