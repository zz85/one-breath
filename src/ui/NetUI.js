// The dive-with-friends panel, under the brand at the top left (game/NetPlay.js drives it):
//   not in a room   "Dive with friends": makes a room and copies its invite link
//   in a room       who's in the water, Invite (copy the link again), Leave, and the chat
// Enter opens the chat box (the pointer is let go while you type), Enter sends, Esc closes.
// On a phone, the Chat button opens it. Chat lines fade after a while; with the box open the
// last ones show again.
const CSS = /* css */`
.nu { display: flex; flex-direction: column; align-items: flex-start; gap: var(--tw-1); max-width: min(calc(380 * var(--tw-u)), 80vw); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); }
.nu-bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--tw-2); padding: var(--tw-1) var(--tw-1) var(--tw-1) var(--tw-3); border-radius: 999px; }
.nu-bar.is-solo { padding: 0; background: none; border: 0; -webkit-backdrop-filter: none; backdrop-filter: none; }
.nu-count { white-space: nowrap; }
.nu-count b { font-family: var(--tw-mono); color: var(--tw-aqua); font-weight: 600; }
.nu-code { font-family: var(--tw-mono); color: var(--tw-ink-3); font-size: var(--tw-fs-sm); }
.nu-btn { padding: calc(3 * var(--tw-u)) var(--tw-3) !important; border-radius: 999px !important; background: var(--tw-fill-2) !important; color: var(--tw-ink) !important; font: 600 var(--tw-fs-sm) var(--tw-font) !important; cursor: pointer; white-space: nowrap; }
.nu-btn:hover { background: rgba(var(--tw-aqua-rgb, 95, 227, 212), 0.25) !important; }
.nu-btn.is-main { padding: calc(6 * var(--tw-u)) var(--tw-3) !important; }
.nu-people { display: flex; flex-wrap: wrap; gap: var(--tw-1) var(--tw-2); padding: 0 var(--tw-2); font-size: var(--tw-fs-sm); color: var(--tw-ink-2); }
.nu-people span::before { content: ''; display: inline-block; width: 0.55em; height: 0.55em; border-radius: 50%; margin-right: 0.35em; background: var(--nu-c); }
.nu-people .is-self { color: var(--tw-ink-3); }
.nu-people .is-me { cursor: pointer; border-bottom: 1px dashed rgba(255,255,255,0.3); }
.nu-people .is-me:hover { color: var(--tw-ink); }
.nu-people .is-me::after { content: ' \\270E'; opacity: 0.7; }
.nu-rename { width: calc(140 * var(--tw-u)); padding: 1px var(--tw-2); border-radius: 999px; border: 1px solid var(--tw-aqua);
	background: rgba(12, 18, 26, 0.85); color: var(--tw-ink); font: 500 var(--tw-fs-sm) var(--tw-font); outline: none; }
.nu-log { display: flex; flex-direction: column; gap: 2px; padding: 0 var(--tw-2); }
.nu-line { font-size: var(--tw-fs-md); line-height: 1.35; text-shadow: 0 1px 3px rgba(0,0,0,0.7); overflow-wrap: anywhere; transition: opacity 1.2s ease; }
.nu-line b { color: var(--nu-c); font-weight: 600; margin-right: 0.35em; }
.nu-line.is-sys { color: var(--tw-ink-3); font-style: italic; }
.nu-line.is-old { opacity: 0; }
.nu.is-typing .nu-line.is-old { opacity: 0.85; }
.nu-input { display: none; width: calc(300 * var(--tw-u)); max-width: 100%; box-sizing: border-box; padding: var(--tw-2) var(--tw-3); border-radius: var(--tw-r-md); border: 1px solid var(--tw-line);
	background: rgba(12, 18, 26, 0.8); color: var(--tw-ink); font: 500 var(--tw-fs-md) var(--tw-font); outline: none; }
.nu.is-typing .nu-input { display: block; }
.nu-input:focus { border-color: var(--tw-aqua); }
.nu-hint { font-size: var(--tw-fs-sm); color: var(--tw-ink-3); padding: 0 var(--tw-2); }
.tw-root:not(.is-locked) .nu-hint-locked { display: none; }
`;

const FADE_MS = 14000;
const KEEP = 40; // lines kept; the last SHOW show
const SHOW = 6;

const el = ( tag, cls, text ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( text != null ) e.textContent = text;
	return e;

};

export class NetUI {

	constructor( ui, net ) {

		this.ui = ui;
		this.net = net;
		const style = el( 'style' );
		style.textContent = CSS;
		document.head.append( style );
		const root = this.root = el( 'div', 'nu tw-interactive' );
		this.bar = el( 'div', 'nu-bar tw-glass' );
		this.count = el( 'span', 'nu-count' );
		this.codeEl = el( 'span', 'nu-code' );
		this.mainBtn = this.button( 'Dive with friends', () => this.net.invite(), 'is-main' );
		this.inviteBtn = this.button( 'Invite', () => this.net.copyLink() );
		this.chatBtn = this.button( 'Chat', () => this.open() );
		this.leaveBtn = this.button( 'Leave', () => this.net.leave() );
		this.bar.append( this.mainBtn, this.count, this.codeEl, this.inviteBtn, this.chatBtn, this.leaveBtn );
		this.peopleEl = el( 'div', 'nu-people' );
		this.log = el( 'div', 'nu-log' );
		this.hint = el( 'div', 'nu-hint' );
		this.hint.innerHTML = '<span class="nu-hint-locked">Enter: chat · Esc: use the mouse, then click your name to change it</span>';
		this.input = el( 'input', 'nu-input' );
		this.input.type = 'text';
		this.input.maxLength = 200;
		this.input.placeholder = 'Say something · Enter to send, Esc to close';
		this.input.addEventListener( 'keydown', ( e ) => {

			e.stopPropagation();
			if ( e.key === 'Enter' ) {

				const t = this.input.value;
				this.input.value = '';
				if ( t.trim() ) this.net.say( t );
				this.close( true );

			} else if ( e.key === 'Escape' ) this.close( false );

		} );
		this.input.addEventListener( 'blur', () => this.close( false, true ) );
		root.append( this.bar, this.peopleEl, this.log, this.input, this.hint );
		const tl = ui.hud && ui.hud.querySelector( '.tw-tl' );
		( tl || ui.hud || ui.root ).append( root );
		this.lines = [];
		this.typing = false;
		this.inRoom = false;
		// Enter opens the chat, unless something else has the keyboard or the start screen is up
		window.addEventListener( 'keydown', ( e ) => {

			if ( e.key !== 'Enter' || this.typing || ! this.inRoom ) return;
			const t = e.target;
			if ( t && ( t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable ) ) return;
			if ( this.ui.startEl && ! this.ui.startEl.hidden ) return;
			e.preventDefault();
			this.open();

		} );

	}

	button( label, fn, cls = '' ) {

		const b = el( 'button', 'nu-btn ' + cls, label );
		b.type = 'button';
		b.addEventListener( 'click', ( e ) => {

			e.stopPropagation();
			fn();
			b.blur();

		} );
		return b;

	}

	// code null: not in a room (joining: on the way in)
	setRoom( code, people, joining ) {

		this.inRoom = !! code;
		const ids = Object.keys( people || {} );
		this.bar.classList.toggle( 'is-solo', ! code );
		this.mainBtn.hidden = !! code;
		this.mainBtn.textContent = joining ? 'Joining the dive...' : 'Dive with friends';
		this.mainBtn.disabled = !! joining;
		for ( const b of [ this.count, this.codeEl, this.inviteBtn, this.chatBtn, this.leaveBtn ] ) b.hidden = ! code;
		this.hint.hidden = ! code;
		this.peopleEl.hidden = ! code;
		if ( ! code ) {

			this.close( false );
			return;

		}

		this.count.innerHTML = '';
		const n = el( 'b', '', String( ids.length ) );
		this.count.append( n, document.createTextNode( ' in the water' ) );
		this.codeEl.textContent = code;
		ids.sort( ( a, b ) => ( people[ b ].self - people[ a ].self ) || people[ a ].name.localeCompare( people[ b ].name ) );
		this.peopleEl.replaceChildren( ...ids.map( ( id ) => {

			const p = people[ id ];
			const s = el( 'span', p.self ? 'is-self is-me' : '', p.self ? `${ p.name } (you)` : p.name );
			if ( p.self ) {

				s.title = 'Change your name';
				s.addEventListener( 'click', ( e ) => {

					e.stopPropagation();
					this.rename( s, p.name );

				} );

			}

			s.style.setProperty( '--nu-c', hsl( p.hue ) );
			return s;

		} ) );
		if ( ids.length < 2 ) this.peopleEl.append( el( 'span', 'is-self', 'waiting for friends: Invite copies the link' ) );

	}

	// your name in the list turns into a box: Enter keeps the new name, Esc or a click away doesn't
	rename( span, current ) {

		const box = el( 'input', 'nu-rename' );
		box.type = 'text';
		box.maxLength = 20;
		box.value = current;
		box.setAttribute( 'aria-label', 'Your name' );
		this.typing = true; // Enter in the box isn't the chat's
		const inp = this.net.app.input;
		if ( inp ) inp.keys.clear();
		if ( document.pointerLockElement ) document.exitPointerLock();
		let done = false;
		const finish = ( keep ) => {

			if ( done ) return;
			done = true;
			this.typing = false;
			if ( keep && box.value.trim() && box.value.trim() !== current ) this.net.setName( box.value );
			box.replaceWith( span );
			if ( keep && inp && ! inp.touch && inp.requestLock ) inp.requestLock();

		};
		box.addEventListener( 'keydown', ( e ) => {

			e.stopPropagation();
			if ( e.key === 'Enter' ) finish( true );
			else if ( e.key === 'Escape' ) finish( false );

		} );
		box.addEventListener( 'blur', () => finish( false ) );
		span.replaceWith( box );
		box.focus();
		box.select();

	}

	chat( name, text, hue, self = false ) {

		const line = el( 'div', 'nu-line' );
		const who = el( 'b', '', name );
		line.style.setProperty( '--nu-c', hsl( hue ) );
		line.append( who, document.createTextNode( text ) );
		if ( self ) line.classList.add( 'is-self' );
		this.add( line );
		if ( ! self && this.net.app.audio && this.net.app.audio.tick ) this.net.app.audio.tick();

	}

	system( text ) {

		this.add( el( 'div', 'nu-line is-sys', text ) );

	}

	add( line ) {

		line._t = performance.now();
		this.lines.push( line );
		this.log.append( line );
		while ( this.lines.length > KEEP ) this.lines.shift().remove();
		this.layout();

	}

	layout() {

		const n = this.lines.length;
		this.lines.forEach( ( l, i ) => {

			l.hidden = i < n - ( this.typing ? SHOW + 4 : SHOW );

		} );

	}

	open() {

		if ( ! this.inRoom || this.typing ) return;
		this.typing = true;
		this.root.classList.add( 'is-typing' );
		const inp = this.net.app.input;
		if ( inp ) {

			inp.keys.clear();
			inp.vkeys && inp.vkeys.clear();

		}

		if ( document.pointerLockElement ) document.exitPointerLock();
		this.layout();
		// the Enter that opened it has been handled (preventDefault): it doesn't reach the box
		this.input.focus();

	}

	close( relock, fromBlur = false ) {

		if ( ! this.typing ) return;
		this.typing = false;
		this.root.classList.remove( 'is-typing' );
		if ( ! fromBlur ) this.input.blur();
		this.layout();
		const inp = this.net.app.input;
		if ( relock && inp && ! inp.touch && inp.requestLock ) inp.requestLock();

	}

	update() {

		const now = performance.now();
		for ( const l of this.lines ) l.classList.toggle( 'is-old', now - l._t > FADE_MS );

	}

}

const hsl = ( h ) => `hsl(${ Math.round( h * 360 ) } 80% 62%)`;
