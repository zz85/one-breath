// Game modes and difficulty, chosen on the start screen (ui/UI.js showModeMenu) or from the URL:
//   ?mode=leisure | depth | spear      &difficulty=easy | standard | realistic
// The last choice is saved and preselected next time. ?hunt (game/Practice.js) is spearfishing.
//
//   leisure   explore the reef on one breath: no speargun, nothing to sell
//   depth     dive a line from a buoy, competition style (not built yet: the menu shows it, locked)
//   spear     the speargun hunt
//
// Difficulty scales the breath-hold (the gear's holdS): easy gives more time, realistic is the
// gear's own figure. Easy is the beginner's game too (game/Spearfishing.js reads `easy`): no
// blackout (your buddy brings you up as the breath runs out, the fish stays on), calmer fish, a
// steadier aim, and a warning instead of a fine for a protected or undersized fish.
// The equalizing, buoyancy and judging rules of depth mode will read it too.

const KEY = 'onebreath.mode';

export const MODES = {
	leisure: {
		label: 'Leisure Freediving',
		blurb: 'Explore the reef on one breath. Glide slowly and the fish come close.',
		gun: false,
	},
	depth: {
		label: 'Depth Freediving',
		blurb: 'Announce a depth, breathe up at the buoy, dive the line and surface clean.',
		gun: false,
		locked: 'Coming next',
	},
	spear: {
		label: 'Spearfishing',
		blurb: 'Hunt the reef with a speargun, sell your catch, buy better gear.',
		gun: true,
	},
};

export const DIFFICULTY = {
	easy: { label: 'Easy', holdMul: 1.6, easy: true },
	standard: { label: 'Standard', holdMul: 1.2 },
	realistic: { label: 'Realistic', holdMul: 1 },
};

function safeStorage() {

	try {

		return typeof localStorage !== 'undefined' ? localStorage : null;

	} catch ( e ) {

		return null;

	}

}

const usable = ( m ) => MODES[ m ] && ! MODES[ m ].locked;

// { mode, difficulty, fromURL }: the URL's choice, else the saved one, else leisure / standard
export function pickMode( qs, storage = safeStorage() ) {

	let saved = {};
	try {

		saved = JSON.parse( ( storage && storage.getItem( KEY ) ) || '{}' ) || {};

	} catch ( e ) { /* a bad save: the defaults */ }

	const qm = qs && qs.get( 'mode' ), qd = qs && qs.get( 'difficulty' );
	const hunt = !! ( qs && qs.has( 'hunt' ) );
	const mode = hunt ? 'spear' : usable( qm ) ? qm : usable( saved.mode ) ? saved.mode : 'leisure';
	const old = ( d ) => d === 'relaxed' ? 'easy' : d; // Easy was called Relaxed
	const difficulty = DIFFICULTY[ old( qd ) ] ? old( qd ) : DIFFICULTY[ old( saved.difficulty ) ] ? old( saved.difficulty ) : 'standard';
	return { mode, difficulty, fromURL: hunt || usable( qm ) };

}

export function saveMode( choice, storage = safeStorage() ) {

	try {

		if ( storage ) storage.setItem( KEY, JSON.stringify( { mode: choice.mode, difficulty: choice.difficulty } ) );

	} catch ( e ) { /* storage blocked: keep playing */ }

}
