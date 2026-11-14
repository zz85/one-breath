// The dive room: a peer-to-peer room of up to MAX_DIVERS players over WebRTC (Trystero). Public
// Nostr relays introduce the browsers to each other; after that, poses and chat go directly
// between them. Nothing of ours is hosted. Everyone who has the invite link's code can join; the
// code is the room's password too, so the relays only see an encrypted handshake.
//
//   const net = await DiveRoom.join( code, { name } )
//   net.onPose( ( userId, pose ) => ... )      // ~12 a second from each diver
//   net.onChat( ( userId, text ) => ... )
//   net.onPeople( ( people ) => ... )          // { [userId]: { name, hue, self } } on every change
//   net.sendPose( float32Array ); net.say( text ); net.setName( name ); net.leave()
//
// Trystero is loaded on the first join, so a player who never dives with friends doesn't
// download it.
import { decodePose, hueOf, cleanName, cleanChat } from './Pose.js';

export const APP_ID = 'zz85/one-breath';
export const MAX_DIVERS = 8;
const CHAT_PER_10S = 10; // more than this from one player is dropped

export class DiveRoom {

	static async join( code, { name = 'Diver', joinRoom = null } = {} ) {

		const join = joinRoom || ( await import( 'trystero' ) ).joinRoom;
		const r = new DiveRoom( code, join, name );
		await r._start();
		return r;

	}

	constructor( code, join, name ) {

		this.code = code;
		this.selfId = null;
		this.error = null;
		this._handlers = { pose: [], chat: [], people: [], error: [] };
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
		this.profile = room.makeUserState( 'profile', { name: 'Diver' }, { maxBytes: 256 } );
		this.profile.onChange( () => this._emitPeople(), { replay: true } );
		this.profile.set( { name: this._name } ).catch( () => {} );
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
			out[ id ] = { name: cleanName( p && p.name ) || 'Diver', hue: hueOf( id ), self };

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
		if ( this.profile ) this.profile.set( { name: n } ).catch( () => {} );

	}

	get name() {

		return this._name;

	}

	async leave() {

		const room = this.room;
		this.room = null;
		this._handlers = { pose: [], chat: [], people: [], error: [] };
		if ( room ) await room.leave();

	}

	onPose( fn ) { this._handlers.pose.push( fn ); }
	onChat( fn ) { this._handlers.chat.push( fn ); }
	onPeople( fn ) { this._handlers.people.push( fn ); }
	onError( fn ) { this._handlers.error.push( fn ); }

	_emitPeople() {

		if ( this.room ) this._emit( 'people', this.people() );

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
