import { SUIT_COLOURS, LOOK_PRESETS, wearPreset, presetOf, hexCss } from '../game/Look.js';

// The suit picker: a row of looks (the plain suit, and the presets from photos in game/Look.js),
// then a row of swatches each for the suit, the accent and the fins. Used in the start screen's
// Multiplayer panel and the dive panel's Suit popover.
//   const p = suitPicker( look, ( look ) => ... )   // p.el to put in the page, p.set( look )
const CSS = /* css */`
.sp { display: flex; flex-direction: column; gap: calc(6 * var(--tw-u, 1px)); }
.sp-row { display: flex; align-items: center; gap: calc(5 * var(--tw-u, 1px)); flex-wrap: wrap; }
.sp-lab { width: calc(52 * var(--tw-u, 1px)); font-size: var(--tw-fs-sm, 12px); opacity: 0.75; text-align: right; margin-right: calc(4 * var(--tw-u, 1px)); }
.sp-sw { width: calc(22 * var(--tw-u, 1px)); height: calc(22 * var(--tw-u, 1px)); border-radius: 50% !important; padding: 0 !important; cursor: pointer;
	background: var(--sp-c) !important; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.25); transition: transform 120ms ease; }
.sp-sw:hover { transform: scale(1.12); }
.sp-pre { font-size: var(--tw-fs-sm, 12px); padding: calc(3 * var(--tw-u, 1px)) calc(9 * var(--tw-u, 1px)) !important; border-radius: calc(999 * var(--tw-u, 1px)) !important; cursor: pointer;
	background: rgba(255,255,255,0.1) !important; color: inherit; border: 0; }
.sp-pre:hover { background: rgba(255,255,255,0.2) !important; }
.sp-pre[aria-checked="true"] { background: rgba(255,255,255,0.3) !important; box-shadow: 0 0 0 1px #fff; }
.sp-sw[aria-checked="true"] { box-shadow: 0 0 0 2px #fff, 0 0 0 4px rgba(0,0,0,0.4); }
@media (pointer: coarse) { .sp-sw { width: 30px; height: 30px; } }
`;
let styled = false;

const PARTS = [ [ 'suit', 'Suit' ], [ 'accent', 'Trim' ], [ 'fins', 'Fins' ] ];

export function suitPicker( look, onChange ) {

	if ( ! styled && typeof document !== 'undefined' ) {

		const st = document.createElement( 'style' );
		st.textContent = CSS;
		document.head.append( st );
		styled = true;

	}

	let cur = { ...( look || {} ) };
	const el = document.createElement( 'div' );
	el.className = 'sp';
	const rows = {};
	// the looks: a preset dresses the figure whole, the swatches below then change its colours
	const looks = document.createElement( 'div' );
	looks.className = 'sp-row';
	looks.setAttribute( 'role', 'radiogroup' );
	looks.setAttribute( 'aria-label', 'Look' );
	const lab0 = document.createElement( 'span' );
	lab0.className = 'sp-lab';
	lab0.textContent = 'Look';
	looks.append( lab0 );
	for ( const key in LOOK_PRESETS ) {

		const b = document.createElement( 'button' );
		b.type = 'button';
		b.className = 'sp-pre';
		b.textContent = LOOK_PRESETS[ key ].label;
		b.setAttribute( 'role', 'radio' );
		b.dataset.preset = key;
		b.addEventListener( 'click', ( e ) => {

			e.stopPropagation();
			cur = wearPreset( cur, key ) || {};
			mark();
			onChange( { ...cur } );

		} );
		looks.append( b );

	}

	el.append( looks );
	for ( const [ part, label ] of PARTS ) {

		const row = document.createElement( 'div' );
		row.className = 'sp-row';
		row.setAttribute( 'role', 'radiogroup' );
		row.setAttribute( 'aria-label', label );
		const lab = document.createElement( 'span' );
		lab.className = 'sp-lab';
		lab.textContent = label;
		row.append( lab );
		for ( const [ name, hex ] of Object.entries( SUIT_COLOURS[ part ] ) ) {

			const b = document.createElement( 'button' );
			b.type = 'button';
			b.className = 'sp-sw';
			b.title = `${ label }: ${ name }`;
			b.setAttribute( 'role', 'radio' );
			b.setAttribute( 'aria-label', `${ label } ${ name }` );
			b.dataset.part = part;
			b.dataset.hex = String( hex );
			b.style.setProperty( '--sp-c', hexCss( hex ) );
			b.addEventListener( 'click', ( e ) => {

				e.stopPropagation();
				cur = { ...cur, [ part ]: hex };
				mark();
				onChange( { ...cur } );

			} );
			row.append( b );

		}

		rows[ part ] = row;
		el.append( row );

	}

	const mark = () => {

		for ( const b of el.querySelectorAll( '.sp-sw' ) ) b.setAttribute( 'aria-checked', String( cur[ b.dataset.part ] === Number( b.dataset.hex ) ) );
		const on = presetOf( cur );
		for ( const b of el.querySelectorAll( '.sp-pre' ) ) b.setAttribute( 'aria-checked', String( b.dataset.preset === on ) );

	};
	mark();
	return {
		el,
		set( look ) {

			cur = { ...( look || {} ) };
			mark();

		},
		get look() {

			return { ...cur };

		},
	};

}
