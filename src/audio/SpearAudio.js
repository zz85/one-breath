// Sounds of spearfishing, synthesised on the soundscape's audio context (audio/SoundScape.js) and
// played on its `near` bus, which the mix keeps unmuffled under water (the diver's own gear):
//   shot       the bands slamming into the muzzle and the shaft leaving: a hard wooden clack, a
//              low thump through the water, the hiss of the line paying out
//   hit        the shaft striking flesh; clank / thud on reef or sand
//   stretch    a band pulled back (rubber creak); hook: the wishbone dropping into the fin's notch
//   heartbeat  the slow, heavy pulse of a long breath-hold, louder as the urge grows
//   gasp       the recovery breaths at the surface
// Every call is guarded: no context, a suspended one or a failed one plays nothing.
export class SpearAudio {

	constructor( soundscape ) {

		this.s = soundscape;
		this._noise = null;

	}

	get ctx() {

		const s = this.s;
		return s && s.ctx && ! s._failed && s.ctx.state === 'running' && ! s.muted ? s.ctx : null;

	}

	_out() {

		return this.s.near || this.s.master;

	}

	_noiseBuf( c ) {

		if ( this._noise && this._noise.sampleRate === c.sampleRate ) return this._noise;
		const b = c.createBuffer( 1, c.sampleRate, c.sampleRate );
		const d = b.getChannelData( 0 );
		for ( let i = 0; i < d.length; i ++ ) d[ i ] = Math.random() * 2 - 1;
		return ( this._noise = b );

	}

	// a burst of filtered noise: type, frequency, Q, peak gain, attack, decay (s), at time t
	_burst( c, t, { type = 'bandpass', f = 1000, q = 1, g = 0.3, a = 0.002, d = 0.1, f1 = null, rate = 1 } ) {

		const src = c.createBufferSource();
		src.buffer = this._noiseBuf( c );
		src.playbackRate.value = rate;
		const flt = c.createBiquadFilter();
		flt.type = type;
		flt.frequency.setValueAtTime( f, t );
		if ( f1 ) flt.frequency.exponentialRampToValueAtTime( f1, t + a + d );
		flt.Q.value = q;
		const env = c.createGain();
		env.gain.setValueAtTime( 0, t );
		env.gain.linearRampToValueAtTime( g, t + a );
		env.gain.exponentialRampToValueAtTime( 1e-4, t + a + d );
		src.connect( flt ).connect( env ).connect( this._out() );
		src.start( t, Math.random() * 0.5 );
		src.stop( t + a + d + 0.05 );

	}

	// a decaying sine (thumps, knocks): f0 -> f1 Hz
	_tone( c, t, { f0 = 120, f1 = 50, g = 0.4, a = 0.003, d = 0.2, type = 'sine' } ) {

		const o = c.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime( f0, t );
		o.frequency.exponentialRampToValueAtTime( Math.max( 20, f1 ), t + a + d );
		const env = c.createGain();
		env.gain.setValueAtTime( 0, t );
		env.gain.linearRampToValueAtTime( g, t + a );
		env.gain.exponentialRampToValueAtTime( 1e-4, t + a + d );
		o.connect( env ).connect( this._out() );
		o.start( t );
		o.stop( t + a + d + 0.05 );

	}

	shot( power = 1, under = true ) {

		const c = this.ctx;
		if ( ! c ) return;
		const t = c.currentTime + 0.005;
		this._burst( c, t, { type: 'bandpass', f: under ? 1800 : 3200, q: 1.4, g: 0.55 * power, d: 0.05 } ); // clack
		this._tone( c, t, { f0: 140, f1: 45, g: 0.6 * power, d: 0.22 } ); // thump through the water
		this._burst( c, t + 0.02, { type: 'highpass', f: 2500, q: 0.7, g: 0.08 * power, a: 0.02, d: 0.35 } ); // line hiss

	}

	hit( strength = 1 ) {

		const c = this.ctx;
		if ( ! c ) return;
		const t = c.currentTime + 0.003;
		this._tone( c, t, { f0: 210, f1: 80, g: 0.35 * strength, d: 0.09 } );
		this._burst( c, t, { type: 'lowpass', f: 900, q: 0.8, g: 0.3 * strength, d: 0.08 } );

	}

	clank( rock = true ) {

		const c = this.ctx;
		if ( ! c ) return;
		const t = c.currentTime + 0.003;
		if ( rock ) {

			this._tone( c, t, { f0: 2400, f1: 2100, g: 0.12, d: 0.25, type: 'triangle' } );
			this._burst( c, t, { type: 'bandpass', f: 3500, q: 3, g: 0.25, d: 0.06 } );

		} else this._burst( c, t, { type: 'lowpass', f: 500, q: 0.7, g: 0.3, d: 0.12 } );

	}

	stretch( k = 0 ) {

		const c = this.ctx;
		if ( ! c ) return;
		const t = c.currentTime + 0.003;
		this._burst( c, t, { type: 'bandpass', f: 380 + k * 60, f1: 900, q: 6, g: 0.07, a: 0.25, d: 0.5, rate: 0.3 } );

	}

	hook() {

		const c = this.ctx;
		if ( ! c ) return;
		const t = c.currentTime + 0.003;
		this._burst( c, t, { type: 'bandpass', f: 2600, q: 4, g: 0.25, d: 0.03 } );
		this._tone( c, t, { f0: 600, f1: 300, g: 0.08, d: 0.05 } );

	}

	heartbeat( urge = 0.5 ) {

		const c = this.ctx;
		if ( ! c ) return;
		const t = c.currentTime + 0.003, g = 0.08 + 0.25 * urge;
		this._tone( c, t, { f0: 62, f1: 40, g, d: 0.12 } );
		this._tone( c, t + 0.19, { f0: 55, f1: 38, g: g * 0.7, d: 0.12 } );

	}

	gasp( deep = 1 ) {

		const c = this.ctx;
		if ( ! c ) return;
		const t = c.currentTime + 0.003;
		this._burst( c, t, { type: 'bandpass', f: 1200, f1: 700, q: 0.9, g: 0.12 * deep, a: 0.15, d: 0.55 } );

	}

	twang( tension = 0.5 ) {

		const c = this.ctx;
		if ( ! c ) return;
		const t = c.currentTime + 0.003;
		this._tone( c, t, { f0: 300 + 500 * tension, f1: 200 + 300 * tension, g: 0.06, d: 0.18, type: 'triangle' } );

	}

}
