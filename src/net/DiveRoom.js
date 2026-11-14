// The dive room: a peer-to-peer room of up to MAX_DIVERS players over WebRTC (Trystero). Public
// Nostr relays introduce the browsers to each other; after that, poses and chat go directly
// between them. Nothing of ours is hosted. Everyone who has the invite link's code can join; the
// code is the room's password too, so the relays only see an encrypted handshake.
//
//   const net = await DiveRoom.join( code, { name } )
//   net.onPose( ( userId, pose ) => ... )      // ~12 a second from each diver
//   net.onChat( ( userId, text ) => ... )
//   net.onPeople( ( people ) => ... )          // { [userId]: { name, hue, look, host, self } } on every change
//   net.onWorld( ( conditions ) => ... )       // the host's time and weather (not your own)
//   net.sendPose( float32Array ); net.say( text ); net.setName( name ); net.setLook( look )
//   net.setWorld( conditions )                 // the host only; net.isHost, net.hostId
//   net.setGear( { gunM, bands, gunKind } )     // your speargun, in your profile
//   net.shoot( p, d, v ); net.onShot( ( userId, shot ) => ... )   // a shot, for the others to see
//   net.sendLife( fish, whale ); net.onLife( ( fish, whale, sentAt ) => ... )   // the host's animals
//   net.lifeEvent( ev ); net.onLifeEvent( ( userId, ev ) => ... )    // to the host: a guest hit its whale
//   net.leave()
//
// The host is the player who made the dive (DiveRoom.join with host: true; their browser
// remembers the codes it made, so a reload keeps it). Their profile says so, and the others take
// the time and weather from them alone: a shared state anyone could write, read only from the
// host. Among friends that's enough; a stranger with the link could claim it too.
//
// Trystero is loaded on the first join, so a player who never dives with friends doesn't
// download it.
import { decodePose, hueOf, cleanName, cleanChat, cleanGear, cleanShot } from './Pose.js';
import { cleanLook } from '../game/Look.js';

export const APP_ID = 'zz85/one-breath';
export const MAX_DIVERS = 8;
const CHAT_PER_10S = 10; // more than this from one player is dropped

export class DiveRoom {

	static async join( code, { name = 'Diver', look = null, host = false, joinRoom = null } = {} ) {

		const join = joinRoom || ( await import( 'trystero' ) ).joinRoom;
		const r = new DiveRoom( code, join, name, look, host );
		await r._start();
		return r;

	}

	constructor( code, join, name, look = null, host = false ) {

		this.code = code;
		this._look = cleanLook( look );
		this._gear = null;
		this._host = !! host;
		this.hostId = null;
		this.selfId = null;
		this.error = null;
		this._handlers = { pose: [], chat: [], people: [], error: [], world: [], shot: [], life: [], lifeEvent: [] };
		this._chatTimes = new Map();
		this._names = {};
		this.room = join( {
			appId: APP_ID,
			password: code,
			maxUsers: MAX_DIVERS,
			// a fresh id each time: two tabs of the same browser are two divers
			identity: 'none',
		}, 'dive-' + code );
		this._name = cleanName( name ) || 'Diver';

	}

	async _start() {

		const room = this.room;
		room.onError( ( e ) => {

			this.error = e;
			this._emit( 'error', e );

		} );
		const self = await room.getSelf();
		this.selfId = self.userId;
		// name and colour: each player's own signed slot, replayed to anyone who joins later
		this.profile = room.makeUserState( 'profile', { name: 'Diver' }, { maxBytes: 512 } );
		this.profile.onChange( () => this._emitPeople(), { replay: true } );
		this._sendProfile();
		// the time and weather: whoever writes it, it's taken from the host's writes alone
		this.world = room.makeState( 'world', null, { maxBytes: 1024 } );
		this.world.onChange( ( value, ctx ) => {

			if ( ctx && ctx.userId === this.hostId && ctx.userId !== this.selfId ) this._emit( 'world', value );

		}, { replay: true } );
		room.onUserJoin( () => this._emitPeople() );
		room.onUserLeave( ( { userId } ) => {

			this._chatTimes.delete( userId );
			this._emitPeople();

		} );

		this._pose = room.makeAction( 'pose' );
		this._pose.onReceive( ( { byteLength } ) => byteLength <= 256 );
		this._pose.onMessage( ( data, { userId } ) => {

			const p = decodePose( data );
			if ( p ) this._emit( 'pose', userId, p );

		} );

		this._shot = room.makeAction( 'shot' );
		this._shot.onReceive( ( { byteLength } ) => byteLength <= 512 );
		this._shot.onMessage( ( data, { userId } ) => {

			const shot = cleanShot( data );
			if ( shot ) this._emit( 'shot', userId, shot );

		} );

		// the host's animals: the fish groups as floats, then (at times) the whale; from the host alone
		this._fish = room.makeAction( 'fish' );
		this._fish.onReceive( ( { byteLength } ) => byteLength <= 32768 );
		this._fish.onMessage( ( data, { userId, metadata } ) => {

			if ( userId !== this.hostId || userId === this.selfId ) return;
			const sentAt = metadata && Number.isFinite( metadata.t ) ? metadata.t : null;
			let a = data;
			if ( a instanceof ArrayBuffer ) a = new Float32Array( a );
			else if ( ArrayBuffer.isView( a ) && ! ( a instanceof Float32Array ) ) a = a.byteLength % 4 ? null : new Float32Array( a.buffer, a.byteOffset, a.byteLength / 4 );
			if ( a instanceof Float32Array ) this._emit( 'life', a, null, sentAt );

		} );
		this._whale = room.makeAction( 'whale' );
		this._whale.onReceive( ( { byteLength } ) => byteLength <= 16384 );
		this._whale.onMessage( ( data, { userId } ) => {

			if ( userId !== this.hostId || userId === this.selfId || ! data || typeof data !== 'object' ) return;
			this._emit( 'life', null, data.w || null, Number.isFinite( data.t ) ? data.t : null );

		} );
		this._lifeEv = room.makeAction( 'lifeev' );
		this._lifeEv.onReceive( ( { byteLength } ) => byteLength <= 256 );
		this._lifeEv.onMessage( ( data, { userId } ) => {

			if ( ! this._host || ! data || typeof data !== 'object' ) return;
			if ( data.whale === 'startle' && ( data.side === 1 || data.side === - 1 ) ) this._emit( 'lifeEvent', userId, { whale: 'startle', side: data.side } );

		} );

		this._chat = room.makeAction( 'chat' );
		this._chat.onReceive( ( { byteLength } ) => byteLength <= 2048 );
		this._chat.onMessage( ( data, { userId } ) => {

			const text = cleanChat( data && data.text );
			if ( ! text || ! this._allowChat( userId ) ) return;
			this._emit( 'chat', userId, text );

		} );
		this._emitPeople();

	}

	_allowChat( userId, now = Date.now() ) {

		const ts = ( this._chatTimes.get( userId ) || [] ).filter( ( t ) => now - t < 10000 );
		ts.push( now );
		this._chatTimes.set( userId, ts );
		return ts.length <= CHAT_PER_10S;

	}

	_sendProfile() {

		if ( ! this.profile ) return;
		const p = { name: this._name };
		if ( this._look ) p.look = this._look;
		if ( this._host ) p.host = true;
		if ( this._gear ) p.gear = this._gear;
		this.profile.set( p ).catch( () => {} );

	}

	// the host: an online player whose profile says so (the first by id, where two do)
	_findHost( people ) {

		const ids = Object.keys( people ).filter( ( id ) => people[ id ].host ).sort();
		const before = this.hostId;
		this.hostId = ids[ 0 ] || null;
		// a host found late (their profile came after their world state): take what they wrote
		if ( this.hostId && this.hostId !== before && this.hostId !== this.selfId && this.world ) {

			const meta = this.world.getMeta();
			if ( meta && meta.userId === this.hostId && this.world.get() ) this._emit( 'world', this.world.get() );

		}

	}

	get isHost() {

		return this._host;

	}

	setWorld( conditions ) {

		if ( ! this._host || ! this.world ) return;
		this.world.set( conditions ).catch( () => {} );

	}

	setGear( gear ) {

		const g = cleanGear( gear );
		if ( JSON.stringify( g ) === JSON.stringify( this._gear ) ) return;
		this._gear = g;
		this._sendProfile();

	}

	shoot( p, d, v ) {

		if ( ! this._shot ) return;
		const r = ( x ) => Math.round( x * 1000 ) / 1000;
		this._shot.send( { p: [ r( p.x ), r( p.y ), r( p.z ) ], d: [ r( d.x ), r( d.y ), r( d.z ) ], v: r( v ) } ).catch( () => {} );

	}

	// the host: its animals. t is its clock (performance.now() / 1000 - a guest maps it with the
	// fish poses' offset); whale as WhaleBrain.netState(), at times
	sendLife( fish, whale, t ) {

		if ( ! this._host ) return;
		if ( fish && fish.length && this._fish ) this._fish.send( fish, { metadata: { t } } ).catch( () => {} );
		if ( whale && this._whale ) this._whale.send( { w: whale, t } ).catch( () => {} );

	}

	lifeEvent( ev ) {

		if ( this._lifeEv && ! this._host ) this._lifeEv.send( ev ).catch( () => {} );

	}

	setLook( look ) {

		const l = cleanLook( look );
		if ( JSON.stringify( l ) === JSON.stringify( this._look ) ) return;
		this._look = l;
		this._sendProfile();

	}

	// everyone in the room, you included
	people() {

		const out = {};
		const profiles = this.profile ? this.profile.getAll() : {};
		const ids = new Set( [ ...Object.keys( this.room.getUsers() ), ...Object.keys( profiles ) ] );
		if ( this.selfId ) ids.add( this.selfId );
		for ( const id of ids ) {

			const self = id === this.selfId;
			if ( ! self && ! this.room.getUsers()[ id ] ) continue; // a profile left behind
			const p = profiles[ id ];
			out[ id ] = { name: cleanName( p && p.name ) || 'Diver', hue: hueOf( id ), look: cleanLook( p && p.look ), gear: cleanGear( p && p.gear ), host: !! ( p && p.host === true ), self };

		}

		return out;

	}

	get count() {

		return Object.keys( this.people() ).length;

	}

	sendPose( buf ) {

		if ( this._pose ) this._pose.send( buf ).catch( () => {} );

	}

	say( text ) {

		const t = cleanChat( text );
		if ( ! t || ! this._chat ) return null;
		this._chat.send( { text: t } ).catch( () => {} );
		return t;

	}

	setName( name ) {

		const n = cleanName( name );
		if ( ! n || n === this._name ) return;
		this._name = n;
		this._sendProfile();

	}

	get name() {

		return this._name;

	}

	async leave() {

		const room = this.room;
		this.room = null;
		this._handlers = { pose: [], chat: [], people: [], error: [], world: [], shot: [], life: [], lifeEvent: [] };
		if ( room ) await room.leave();

	}

	onPose( fn ) { this._handlers.pose.push( fn ); }
	onChat( fn ) { this._handlers.chat.push( fn ); }
	onPeople( fn ) { this._handlers.people.push( fn ); }
	onError( fn ) { this._handlers.error.push( fn ); }
	onWorld( fn ) { this._handlers.world.push( fn ); }
	onShot( fn ) { this._handlers.shot.push( fn ); }
	onLife( fn ) { this._handlers.life.push( fn ); }
	onLifeEvent( fn ) { this._handlers.lifeEvent.push( fn ); }

	_emitPeople() {

		if ( ! this.room ) return;
		const people = this.people();
		this._findHost( people );
		this._emit( 'people', people );

	}

	_emit( kind, ...args ) {

		for ( const fn of this._handlers[ kind ] ) {

			try {

				fn( ...args );

			} catch ( e ) {

				console.error( 'DiveRoom', kind, e );

			}

		}

	}

}
