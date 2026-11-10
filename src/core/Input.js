// Keyboard / mouse input with pointer lock support, and the touch controls' virtual keys and buttons
// (ui/TouchControls.js): a virtual key reads as held through down() and pressed through hit() exactly
// like a real one, so the game reads one set of controls whatever drives them.
export class Input {

	constructor( dom ) {

		this.dom = dom;
		this.keys = new Set();
		this.pressed = new Set();
		this.look = { x: 0, y: 0 };
		this.wheel = 0;
		this._mouse = [ false, false ]; // physical left / right buttons
		this.touchButtons = [ false, false ]; // the same, held on the touch controls
		this.vkeys = new Set(); // keys held on the touch controls
		this.lookScale = 1; // look sensitivity (lowered while aiming down a gun)
		this.touch = false; // set once a touch has been seen
		this.locked = false;
		this.enabled = true;

		window.addEventListener( 'keydown', ( e ) => {

			if ( e.target && ( e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' ) ) return;
			if ( ! this.keys.has( e.code ) ) this.pressed.add( e.code );
			this.keys.add( e.code );
			if ( [ 'Space', 'ArrowUp', 'ArrowDown', 'Tab' ].includes( e.code ) ) e.preventDefault();

		} );
		window.addEventListener( 'keyup', ( e ) => this.keys.delete( e.code ) );
		window.addEventListener( 'blur', () => {

			this.keys.clear();
			this._mouse[ 0 ] = this._mouse[ 1 ] = false;

		} );

		dom.addEventListener( 'mousedown', ( e ) => {

			if ( e.button === 0 ) this._mouse[ 0 ] = true;
			if ( e.button === 2 ) this._mouse[ 1 ] = true;

		} );
		window.addEventListener( 'mouseup', ( e ) => {

			if ( e.button === 0 ) this._mouse[ 0 ] = false;
			if ( e.button === 2 ) this._mouse[ 1 ] = false;

		} );
		dom.addEventListener( 'contextmenu', ( e ) => e.preventDefault() );
		window.addEventListener( 'mousemove', ( e ) => {

			if ( this.locked || this._mouse[ 0 ] || this._mouse[ 1 ] ) {

				this.look.x += e.movementX;
				this.look.y += e.movementY;

			}

		} );
		dom.addEventListener( 'wheel', ( e ) => {

			this.wheel += Math.sign( e.deltaY );
			e.preventDefault();

		}, { passive: false } );

		document.addEventListener( 'pointerlockchange', () => {

			this.locked = document.pointerLockElement === dom;

		} );

	}

	get mouseDown() {

		return this._mouse[ 0 ] || this.touchButtons[ 0 ];

	}

	get rightDown() {

		return this._mouse[ 1 ] || this.touchButtons[ 1 ];

	}

	// ---- the touch controls
	setVirtual( code, on ) {

		if ( on && ! this.vkeys.has( code ) ) this.pressed.add( code );
		if ( on ) this.vkeys.add( code );
		else this.vkeys.delete( code );

	}

	// a tap: pressed for this frame (hit), not held
	tap( code ) {

		this.pressed.add( code );

	}

	addLook( dx, dy ) {

		this.look.x += dx;
		this.look.y += dy;

	}

	requestLock() {

		if ( this.touch ) return;
		if ( ! this.locked ) this.dom.requestPointerLock?.()?.catch?.( () => {} );

	}

	down( code ) {

		return this.enabled && ( this.keys.has( code ) || this.vkeys.has( code ) );

	}

	// true once per physical key press
	hit( code ) {

		return this.enabled && this.pressed.has( code );

	}

	consumeLook() {

		const l = { x: this.look.x * this.lookScale, y: this.look.y * this.lookScale };
		this.look.x = 0;
		this.look.y = 0;
		return l;

	}

	consumeWheel() {

		const w = this.wheel;
		this.wheel = 0;
		return w;

	}

	endFrame() {

		this.pressed.clear();

	}

}
