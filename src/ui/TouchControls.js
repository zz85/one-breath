// Touch controls for phones and tablets: they switch on at the first touch of the screen (or with
// ?touch in the URL), and drive the same controls as the keyboard and mouse through Input's virtual
// keys and buttons (core/Input.js), so nothing else in the game reads touch.
//
//   left half    a floating analog stick where your thumb lands (Input.stick; Shift pushed all the way)
//   right half   drag to look
//   buttons      only the ones that do something now, read from the game each frame:
//                Fire (tap: shoot, hold: haul the line), Aim (Q), Load (hold R), Gun (G), Dive (hold
//                C), Up / Jump (hold Space), Use (E), Camera (V, at the helm), Bag (I)
// The prompts name the buttons in place of keys while touch is on ("Hold R" reads "Hold Load").
const CSS = /* css */`
.tc { position: absolute; inset: 0; pointer-events: none; z-index: 5; display: none; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.tc.is-on { display: block; }
.tc-stick { position: absolute; width: calc(120 * var(--tw-u)); height: calc(120 * var(--tw-u)); margin: calc(-60 * var(--tw-u)); border-radius: 50%;
	border: 2px solid rgba(238, 246, 248, 0.35); background: rgba(12, 18, 26, 0.25); opacity: 0; transition: opacity 120ms; }
.tc-stick.is-on { opacity: 1; }
.tc-knob { position: absolute; left: 50%; top: 50%; width: calc(52 * var(--tw-u)); height: calc(52 * var(--tw-u)); margin: calc(-26 * var(--tw-u));
	border-radius: 50%; background: rgba(238, 246, 248, 0.55); }
.tc-hint { position: absolute; left: 22%; bottom: 18%; transform: translateX(-50%); font: 500 var(--tw-fs-sm) var(--tw-font); color: var(--tw-ink-3); }
.tc-pad { position: absolute; right: calc(env(safe-area-inset-right) + var(--tw-edge)); bottom: calc(env(safe-area-inset-bottom) + var(--tw-edge)); width: 0; height: 0; }
.tc-pad .tc-btn { position: absolute; right: calc(var(--r) * var(--tw-u)); bottom: calc(var(--b) * var(--tw-u)); }
.tc-btn { pointer-events: auto; width: calc(64 * var(--tw-u)); height: calc(64 * var(--tw-u)); border-radius: 50%; display: none;
	align-items: center; justify-content: center; font: 600 calc(12.5 * var(--tw-u)) var(--tw-font); color: var(--tw-ink); letter-spacing: 0.02em;
	background: rgba(12, 18, 26, 0.55); border: 1.5px solid rgba(170, 215, 235, 0.3); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); touch-action: none; }
.tc-btn.is-shown { display: flex; }
.tc-btn.is-down, .tc-btn.is-latched { background: rgba(95, 227, 212, 0.35); border-color: var(--tw-aqua); }
.tc-btn.is-big { width: calc(88 * var(--tw-u)); height: calc(88 * var(--tw-u)); font-size: calc(15 * var(--tw-u)); background: rgba(255, 122, 133, 0.32); border-color: rgba(255, 122, 133, 0.7); }
.tc-btn.is-cue { animation: tc-cue 1.1s ease-in-out infinite; }
@keyframes tc-cue { 50% { box-shadow: 0 0 0 calc(6 * var(--tw-u)) rgba(255, 184, 107, 0.45); } }
.tc-top { position: absolute; top: calc(env(safe-area-inset-top) + var(--tw-edge) + 44 * var(--tw-u)); right: calc(env(safe-area-inset-right) + var(--tw-edge)); display: flex; gap: calc(8 * var(--tw-u)); }
.tc-top .tc-btn { width: calc(46 * var(--tw-u)); height: calc(46 * var(--tw-u)); font-size: calc(11 * var(--tw-u)); }
`;

// the buttons: id, label, the key it taps or holds or the mouse button it holds, and its fixed place
// from the lower right corner (r, b in --tw-u), so a button doesn't move when others come and go
const BUTTONS = [
	{ id: 'fire', label: 'Fire', mouse: 0, big: true, r: 0, b: 0 },
	{ id: 'aim', label: 'Aim', tap: 'KeyQ', r: 104, b: 8 },
	{ id: 'load', label: 'Load', hold: 'KeyR', r: 12, b: 104 },
	{ id: 'use', label: 'Use', tap: 'KeyE', r: 98, b: 98 },
	{ id: 'dive', label: 'Dive', hold: 'KeyC', r: 196, b: 0 },
	{ id: 'up', label: 'Up', hold: 'Space', r: 196, b: 76 },
	{ id: 'gun', label: 'Gun', tap: 'KeyG', r: 12, b: 190 },
	{ id: 'cam', label: 'Cam', tap: 'KeyV', r: 98, b: 176 },
];
const TOP = [ { id: 'bag', label: 'Bag', tap: 'KeyI' } ];

// key names in the prompts -> the buttons that do them
const KEY_WORDS = [
	[ /\bHold LMB\b/g, 'Hold Fire' ], [ /\bLMB\b/g, 'Fire' ], [ /\bRMB\b/g, 'Aim' ], [ /\bHold R\b/g, 'Hold Load' ],
	[ /\bHold to aim \(or Q\)/g, 'Tap to aim' ], [ /\bG\s+let go of the gun/g, 'Let go  of the gun' ], [ /\bQ\b/g, 'Aim' ], [ /\bE\b/g, 'Use' ], [ /\bG\b/g, 'Gun' ], [ /\bR\b/g, 'Load' ],
	[ /\bSpace\b/g, 'Up' ], [ /\bV\b/g, 'Cam' ], [ /\bI\b/g, 'Bag' ],
];
export function touchWords( text ) {

	let t = String( text );
	for ( const [ re, w ] of KEY_WORDS ) t = t.replace( re, w );
	return t;

}

const STICK_R = 60; // css px at --tw-u = 1
const LOOK_GAIN = 2.2; // look units (mouse px) per finger px

const h = ( tag, cls, html ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html !== undefined ) e.innerHTML = html;
	return e;

};

export class TouchControls {

	constructor( { app, game, root } ) {

		this.app = app;
		this.game = game;
		this.input = app.input;
		this.on = false;
		const style = h( 'style' );
		style.textContent = CSS;
		document.head.append( style );
		this.el = h( 'div', 'tc' );
		this.stick = h( 'div', 'tc-stick', '<div class="tc-knob"></div>' );
		this.knob = this.stick.firstChild;
		this.hint = h( 'div', 'tc-hint', 'Thumb here to move · drag on the right to look' );
		this.pad = h( 'div', 'tc-pad' );
		this.top = h( 'div', 'tc-top' );
		this.btn = {};
		for ( const [ list, parent ] of [ [ BUTTONS, this.pad ], [ TOP, this.top ] ] ) for ( const b of list ) {

			const e = h( 'button', 'tc-btn tw-interactive' + ( b.big ? ' is-big' : '' ), b.label );
			e.type = 'button';
			if ( b.r !== undefined ) {

				e.style.setProperty( '--r', b.r );
				e.style.setProperty( '--b', b.b );

			}
			this.wireButton( e, b );
			parent.append( e );
			this.btn[ b.id ] = e;

		}

		this.el.append( this.stick, this.hint, this.pad, this.top );
		root.append( this.el );
		this.stickTouch = null; // { id, x, y }
		this.lookTouch = null; // { id, x, y }
		this.move = { x: 0, y: 0 };
		this._moved = false;

		// the canvas: the stick on the left, look on the right
		const dom = this.input.dom;
		dom.style.touchAction = 'none';
		const opts = { passive: false };
		dom.addEventListener( 'pointerdown', ( e ) => this.onDown( e ), opts );
		window.addEventListener( 'pointermove', ( e ) => this.onMove( e ), opts );
		window.addEventListener( 'pointerup', ( e ) => this.onUp( e ), opts );
		window.addEventListener( 'pointercancel', ( e ) => this.onUp( e ), opts );
		// the first touch anywhere turns touch mode on (a mouse turns nothing off: a laptop with a
		// touch screen keeps both)
		window.addEventListener( 'pointerdown', ( e ) => {

			if ( e.pointerType === 'touch' ) this.enable();

		}, { capture: true, passive: true } );
		if ( app.qs && app.qs.has( 'touch' ) ) this.enable();

	}

	enable() {

		if ( this.on ) return;
		this.on = true;
		this.input.touch = true;
		this.el.classList.add( 'is-on' );
		document.documentElement.classList.add( 'tw-touch' );
		if ( this.app.audio ) this.app.audio.resume();
		this.game.toast( 'Touch controls: left thumb to move, drag the right side to look', 4000 );

	}

	wireButton( e, b ) {

		const inp = this.input;
		const press = ( on ) => {

			if ( b.mouse !== undefined ) inp.touchButtons[ b.mouse ] = on;
			if ( b.hold ) inp.setVirtual( b.hold, on );
			if ( b.tap && on ) inp.tap( b.tap );
			e.classList.toggle( 'is-down', on );

		};

		e.addEventListener( 'pointerdown', ( ev ) => {

			ev.preventDefault();
			ev.stopPropagation();
			this.enable();
			e.setPointerCapture?.( ev.pointerId );
			press( true );

		} );
		const up = ( ev ) => {

			ev.preventDefault();
			press( false );

		};

		e.addEventListener( 'pointerup', up );
		e.addEventListener( 'pointercancel', up );
		e.addEventListener( 'lostpointercapture', () => press( false ) );
		e.addEventListener( 'contextmenu', ( ev ) => ev.preventDefault() );

	}

	onDown( e ) {

		if ( e.pointerType !== 'touch' ) return;
		e.preventDefault();
		const left = e.clientX < window.innerWidth * 0.45;
		if ( left && ! this.stickTouch ) {

			this.stickTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
			const s = this.stick.style;
			s.left = `${ e.clientX }px`;
			s.top = `${ e.clientY }px`;
			this.stick.classList.add( 'is-on' );
			this._moved = true;

		} else if ( ! left && ! this.lookTouch ) this.lookTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };

	}

	onMove( e ) {

		if ( e.pointerType !== 'touch' ) return;
		const st = this.stickTouch, lt = this.lookTouch;
		if ( st && e.pointerId === st.id ) {

			e.preventDefault();
			const u = this.unit();
			let dx = ( e.clientX - st.x ) / ( STICK_R * u ), dy = ( e.clientY - st.y ) / ( STICK_R * u );
			const l = Math.hypot( dx, dy );
			if ( l > 1 ) {

				dx /= l;
				dy /= l;

			}

			this.move.x = dx;
			this.move.y = dy;
			this.knob.style.transform = `translate(${ dx * STICK_R * u }px, ${ dy * STICK_R * u }px)`;

		} else if ( lt && e.pointerId === lt.id ) {

			e.preventDefault();
			this.input.addLook( ( e.clientX - lt.x ) * LOOK_GAIN, ( e.clientY - lt.y ) * LOOK_GAIN );
			lt.x = e.clientX;
			lt.y = e.clientY;

		}

	}

	onUp( e ) {

		if ( this.stickTouch && e.pointerId === this.stickTouch.id ) {

			this.stickTouch = null;
			this.move.x = this.move.y = 0;
			this.knob.style.transform = '';
			this.stick.classList.remove( 'is-on' );

		}

		if ( this.lookTouch && e.pointerId === this.lookTouch.id ) this.lookTouch = null;

	}

	unit() {

		const v = parseFloat( getComputedStyle( document.documentElement ).getPropertyValue( '--tw-u' ) );
		return Number.isFinite( v ) && v > 0 ? v : 1;

	}

	// per frame, after the game: the stick's keys, which buttons show, and the prompt in their words
	update() {

		if ( ! this.on ) return;
		const inp = this.input, app = this.app, g = this.game, p = app.player, sp = g.spear;
		// the stick is analog: a dead zone at the centre, then speed grows with the push (eased, so a
		// light push creeps); pushed all the way it sprints
		const m = this.move, l = Math.hypot( m.x, m.y ), D = 0.15;
		const k = l > D ? Math.pow( ( Math.min( 1, l ) - D ) / ( 1 - D ), 1.4 ) / l : 0;
		inp.stick.x = m.x * k;
		inp.stick.y = - m.y * k;
		inp.setVirtual( 'ShiftLeft', l > 0.97 );
		if ( this._moved ) {

			this._moved = false;
			this.hint.remove();

		}

		const swim = p.mode === 'swim', helm = p.mode === 'boat', free = app.freeCam;
		const gun = sp.equipped, home = sp.phase === 'home';
		const prompt = p.prompt;
		const show = {
			fire: gun && ! helm,
			aim: gun && home && swim,
			load: gun && home && sp.gun.bandsLoaded < sp.stats.bands,
			use: !! prompt && /\bE\b/.test( `${ prompt.key } ${ prompt.text }` ),
			up: swim || free || p.mode === 'walk' || p.mode === 'deck',
			dive: swim || free,
			gun: g.canFish && ( gun || sp.allowGun !== false ) && ( gun || swim || p.surface === 'wetsand' || p.surface === 'water' ),
			cam: helm,
			bag: true,
		};
		for ( const id in this.btn ) this.btn[ id ].classList.toggle( 'is-shown', !! show[ id ] );
		this.btn.up.textContent = swim || free ? 'Up' : 'Jump';
		// with a fish on, the gun button lets go of the gun
		const letGo = sp.phase === 'fight';
		this.btn.gun.textContent = letGo ? 'Let go' : 'Gun';
		this.btn.aim.classList.toggle( 'is-latched', !! sp.aimLatched );
		// cue the button the prompt asks for
		const key = prompt ? String( prompt.key ) : '';
		const cue = /LMB/.test( key ) ? 'fire' : /RMB|^Q$/.test( key ) ? 'aim' : /\bR\b/.test( key ) ? 'load' : key === 'E' ? 'use' : key === 'G' ? 'gun' : key === 'Space' ? 'up' : null;
		for ( const id in this.btn ) this.btn[ id ].classList.toggle( 'is-cue', id === cue );
		if ( prompt ) {

			let k = touchWords( prompt.key );
			if ( letGo && k === 'Gun' ) k = 'Let go';
			p.prompt = { key: k, text: touchWords( prompt.text ) };

		}

	}

}
