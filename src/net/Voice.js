// Push-to-talk in a dive room: your mic goes to everyone while you hold the key (B) or the Talk
// button, and everyone else's voice plays to you, at the same loudness wherever they are.
//
// The mic is asked for the first time you press to talk (the browser shows its permission
// prompt then). The stream goes to the room once (net/DiveRoom.js setVoice) and stays connected;
// between presses its track is off, which sends silence, so a press is heard at once with no
// new connection. Whether you're talking goes in your pose (net/Pose.js FLAG.talking) for the
// others' "speaking" marks.
//
//   const v = new Voice( { onState } )      // onState( { talking, mic: 'off' | 'asking' | 'on' | 'denied' | 'none' } )
//   await v.press(); v.release(); v.attach( room ) / v.detach()
//   v.hear( userId, stream ); v.forget( userId ); v.muted = true   // everyone else's voices
export const PTT_KEY = 'KeyB';

export class Voice {

	constructor( { onState = null, getUserMedia = null } = {} ) {

		this.onState = onState;
		this._gum = getUserMedia || ( typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? ( c ) => navigator.mediaDevices.getUserMedia( c ) : null );
		this.stream = null;
		this.mic = this._gum ? 'off' : 'none';
		this.held = false;
		this.room = null;
		this.players = new Map(); // userId -> <audio>
		this._muted = false;
		this._asking = null;

	}

	get talking() {

		return this.held && this.mic === 'on';

	}

	_state() {

		if ( this.onState ) this.onState( { talking: this.talking, mic: this.mic } );

	}

	// a dive room to send the mic to (it goes once the mic is on)
	attach( room ) {

		this.room = room;
		if ( this.stream && room ) room.setVoice( this.stream );

	}

	detach() {

		this.release();
		this.room = null;
		for ( const id of [ ...this.players.keys() ] ) this.forget( id );

	}

	// the key or the button went down: ask for the mic the first time, then talk while held
	async press() {

		this.held = true;
		if ( this.mic === 'on' ) {

			this._track( true );
			this._state();
			return true;

		}

		if ( this.mic === 'none' || this.mic === 'denied' ) {

			this._state();
			return false;

		}

		if ( ! this._asking ) this._asking = this._ask();
		const ok = await this._asking;
		this._asking = null;
		// let go while the prompt was up: the mic stays on for the next press, quiet for now
		this._track( ok && this.held );
		this._state();
		return ok;

	}

	release() {

		this.held = false;
		this._track( false );
		this._state();

	}

	async _ask() {

		this.mic = 'asking';
		this._state();
		try {

			const stream = await this._gum( { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false } );
			this.stream = stream;
			this.mic = 'on';
			this._track( false );
			if ( this.room ) await this.room.setVoice( stream );
			return true;

		} catch ( e ) {

			this.mic = e && ( e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ) ? 'none' : 'denied';
			return false;

		}

	}

	_track( on ) {

		if ( this.stream ) for ( const t of this.stream.getAudioTracks() ) t.enabled = !! on;

	}

	// someone else's voice arrived: play it (it's silent until they talk)
	hear( userId, stream ) {

		let a = this.players.get( userId );
		if ( ! a ) {

			a = document.createElement( 'audio' );
			a.autoplay = true;
			a.setAttribute( 'playsinline', '' );
			a.dataset.voice = userId;
			a.style.display = 'none';
			document.body.append( a );
			this.players.set( userId, a );

		}

		a.srcObject = stream;
		a.muted = this._muted;
		this._play( a );

	}

	// a browser that blocked the autoplay: play on the next click or key
	_play( a ) {

		const p = a.play();
		if ( p && p.catch ) p.catch( () => {

			const go = () => {

				window.removeEventListener( 'pointerdown', go, true );
				window.removeEventListener( 'keydown', go, true );
				a.play().catch( () => {} );

			};
			window.addEventListener( 'pointerdown', go, true );
			window.addEventListener( 'keydown', go, true );

		} );

	}

	forget( userId ) {

		const a = this.players.get( userId );
		if ( ! a ) return;
		a.srcObject = null;
		a.remove();
		this.players.delete( userId );

	}

	get muted() {

		return this._muted;

	}

	set muted( on ) {

		this._muted = !! on;
		for ( const a of this.players.values() ) a.muted = this._muted;

	}

	// the mic off for good (leaving the dive): the browser's mic light goes out
	stop() {

		this.detach();
		if ( this.stream ) for ( const t of this.stream.getTracks() ) t.stop();
		this.stream = null;
		if ( this.mic === 'on' ) this.mic = 'off';
		this._state();

	}

}
