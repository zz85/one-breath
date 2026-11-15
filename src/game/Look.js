// What your freediver wears and looks like (game/Diver.js draws it). Kept in this browser, worn in
// single player as well, and sent to the others in a dive (net/DiveRoom.js's profile). Every field
// is optional; a missing one takes the default in game/Diver.js's resolveLook.
//   suit, accent, fins   hex colours: the suit, its trim (the side stripes, the mask strap, the
//                        snorkel) and the fin blades
//   skin, hands, hair    hex colours: the skin; the hands where gloved (else skin); the hair,
//                        shown where there is no hood
//   pattern              how the suit is printed: 'rubber' (plain neoprene), 'strokes' (the accent
//                        brushed over black, the way a Fluyd training suit is), 'floral' (flowers
//                        on the suit colour, a printed swimsuit)
//   hood                 true: a hood in the suit's colour; false: bare head, hair
//   legs                 true: the suit covers the legs; false: bare legs (a swimsuit)
//   height               metres, 1.4 to 2.1 (the figure is drawn at 1.75 and scaled)
const KEY = 'onebreath.look';

// the swatches the suit picker offers (ui/SuitPicker.js); any colour is taken from someone else
export const SUIT_COLOURS = {
	suit: { Black: 0x16191c, Charcoal: 0x3a3d42, Navy: 0x1b2a44, Ocean: 0x1f4f7a, Reef: 0x3a4a2e, Sand: 0x8a7656, Red: 0x6e1c1c, White: 0xc9c9c0 },
	accent: { Aqua: 0x2fd0c0, Orange: 0xff7a1a, Yellow: 0xffd21f, Pink: 0xff4fa0, Lime: 0x8bd62a, Red: 0xe8322e, White: 0xf0f0f0, Purple: 0x8a5cff },
	fins: { Black: 0x111316, Carbon: 0x2e3236, Blue: 0x1f6fd1, Aqua: 0x2fd0c0, Red: 0xd12a2a, Yellow: 0xe8c21a, Green: 0x2e9a4a, White: 0xe8e8e8 },
};

export const SUIT_PATTERNS = [ 'rubber', 'strokes', 'floral' ];

// Whole looks, from photos of real divers (test/diver.html offers them; a player picks one as a
// start and the suit picker changes its colours). Colours are linear albedo, as the figure takes them.
export const LOOK_PRESETS = {
	// a black Fluyd training suit with cyan brush strokes, a black Salvimar hood, pink gloves
	fluyd: {
		label: 'Fluyd suit, hood, pink gloves',
		suit: 0x0c0e10, accent: 0x18b4c4, fins: 0x2e3236, pattern: 'strokes', hood: true, legs: true,
		skin: 0xa8734f, hands: 0xc26a8e, hair: 0x14100d, height: 1.62,
	},
	// a long-sleeved one-piece printed with pink, purple and blue flowers; no hood, dark hair with
	// sun-bleached ends
	floral: {
		label: 'Floral swimsuit, no hood',
		suit: 0xd9d6cc, accent: 0xc44a86, fins: 0x1f6fd1, pattern: 'floral', hood: false, legs: false,
		skin: 0xa8734f, hair: 0x14100d, height: 1.62,
	},
};

const COLOURS = [ 'suit', 'accent', 'fins', 'skin', 'hands', 'hair' ];

// a look from anywhere (a save, the wire): only the fields above, each checked; null for none
export function cleanLook( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return null;
	const out = {};
	for ( const k of COLOURS ) {

		const v = raw[ k ];
		if ( Number.isInteger( v ) && v >= 0 && v <= 0xffffff ) out[ k ] = v;

	}

	if ( SUIT_PATTERNS.includes( raw.pattern ) && raw.pattern !== 'rubber' ) out.pattern = raw.pattern;
	if ( raw.hood === false ) out.hood = false;
	if ( raw.legs === false ) out.legs = false;
	if ( typeof raw.height === 'number' && raw.height >= 1.4 && raw.height <= 2.1 && Math.abs( raw.height - 1.75 ) > 1e-3 ) out.height = Math.round( raw.height * 100 ) / 100;
	return Object.keys( out ).length ? out : null;

}

// a preset by its key, as a look (without its label); null for an unknown key
export function presetLook( key ) {

	const p = LOOK_PRESETS[ key ];
	if ( ! p ) return null;
	const { label, ...look } = p;
	return cleanLook( look );

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
