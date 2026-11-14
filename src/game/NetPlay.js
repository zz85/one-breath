import { encodePose, makeDiveCode, cleanDiveCode, cleanName } from '../net/Pose.js';
import { DiveRoom, MAX_DIVERS } from '../net/DiveRoom.js';
import { RemoteDivers } from './RemoteDivers.js';
import { NetUI } from '../ui/NetUI.js';

// Diving with friends: an invite link (?dive=<code>) puts everyone who opens it in one
// peer-to-peer room (net/DiveRoom.js). Each player sends their own pose ~12 times a second,
// sees the others as divers with name tags (game/RemoteDivers.js), and can chat (ui/NetUI.js).
// The fish, weather and time of day are still each player's own.
const SEND_HZ = 12;
const NAME_KEY = 'onebreath.name';

export class NetPlay {

	constructor( game ) {

		this.game = game;
		this.app = game.app;
		this.room = null;
		this.joining = null;
		this.code = null;
		this.people = {};
		this.ui = null;
		this.divers = null;
		this._sendT = 0;
		this._buf = new Float32Array( 10 );
		this._pose = {};
		this.name = loadName();
		// an invite link's code: joined once the player starts (start()), so the start screen can
		// ask their name first. A page with no start screen (tests) joins at once.
		this.linkCode = cleanDiveCode( this.app.qs && this.app.qs.get( 'dive' ) );
		if ( this.linkCode && ! game.deferJoin ) this.join( this.linkCode );

	}

	// the start screen's pick: multi { host } makes a dive, { code } joins one, and with neither
	// an invite link's code is joined anyway. multi.name sets your name first.
	start( multi ) {

		if ( multi && multi.name ) this.setName( multi.name, true );
		if ( multi && multi.host ) return this.invite();
		const code = ( multi && cleanDiveCode( multi.code ) ) || this.linkCode;
		if ( code && code !== this.code ) return this.join( code );

	}

	// once the HUD exists (Game.update)
	attach( ui ) {

		this.divers = new RemoteDivers( { scene: this.app.scene, material: this.game.stand.material, root: ui.root } );
		this.divers.setPeople( this.people );
		this.ui = new NetUI( ui, this );
		this.ui.setRoom( this.room ? this.code : null, this.people, !! this.joining );

	}

	get now() {

		return performance.now() / 1000;

	}

	// a new room of your own: the link goes in the address bar and on the clipboard
	async invite() {

		if ( this.room || this.joining ) return this.copyLink();
		const code = makeDiveCode( randomUnit );
		await this.join( code );
		this.copyLink();

	}

	link( code = this.code ) {

		const u = new URL( location.href );
		for ( const k of [ 'hunt', 'wild', 'bench', 'fly' ] ) u.searchParams.delete( k );
		u.searchParams.set( 'dive', code );
		return u.toString();

	}

	copyLink() {

		if ( ! this.code ) return;
		const url = this.link();
		const done = ( ok ) => this.ui && this.ui.system( ok ? 'Invite link copied. Send it to your friends.' : `Send your friends this link: ${ url }` );
		if ( navigator.share && this.app.input && this.app.input.touch ) {

			navigator.share( { title: 'One Breath', text: 'Come freediving with me', url } ).then( () => done( true ), () => done( false ) );
			return;

		}

		if ( navigator.clipboard ) navigator.clipboard.writeText( url ).then( () => done( true ), () => done( false ) );
		else done( false );

	}

	async join( code ) {

		if ( this.room ) await this.leave();
		this.code = code;
		history.replaceState( null, '', this.link( code ) );
		if ( this.ui ) this.ui.setRoom( null, {}, true );
		const joining = this.joining = DiveRoom.join( code, { name: this.name } );
		let room;
		try {

			room = await joining;

		} catch ( e ) {

			console.error( 'NetPlay: join failed', e );
			this.joining = null;
			if ( this.ui ) {

				this.ui.setRoom( null, {}, false );
				this.ui.system( 'Couldn\'t reach the matchmaking relays. Check your connection and try again.' );

			}

			return;

		}

		if ( this.joining !== joining ) {

			room.leave();
			return;

		}

		this.joining = null;
		this.room = room;
		room.onPeople( ( p ) => this._people( p ) );
		room.onPose( ( id, p ) => this.divers && this.divers.pose( id, p, this.now ) );
		room.onChat( ( id, text ) => {

			const who = this.people[ id ];
			if ( this.ui ) this.ui.chat( who ? who.name : 'Diver', text, who ? who.hue : 0.5 );

		} );
		room.onError( ( e ) => {

			if ( ! this.ui ) return;
			if ( e.code === 'room-full' ) this.ui.system( `This dive is full (${ MAX_DIVERS } divers).` );
			else if ( e.code === 'peer-connect-failed' ) this.ui.system( 'Couldn\'t connect to one of the divers. Their network (often mobile data) blocks direct connections.' );

		} );
		this._people( room.people() );
		if ( this.ui ) this.ui.system( `You're ${ this.name }. Press Enter to chat, or type /name to change your name.` );

	}

	async leave() {

		const room = this.room;
		this.room = null;
		this.joining = null;
		this.code = null;
		this.people = {};
		if ( this.divers ) this.divers.clear();
		const u = new URL( location.href );
		u.searchParams.delete( 'dive' );
		history.replaceState( null, '', u.toString() );
		if ( this.ui ) this.ui.setRoom( null, {}, false );
		if ( room ) await room.leave();

	}

	_people( people ) {

		const before = this.people;
		this.people = people;
		if ( this.divers ) this.divers.setPeople( people );
		if ( ! this.ui ) return;
		for ( const id in people ) if ( ! before[ id ] && ! people[ id ].self && Object.keys( before ).length ) this.ui.system( `${ people[ id ].name } is in the water` );
		for ( const id in before ) if ( ! people[ id ] && ! before[ id ].self ) this.ui.system( `${ before[ id ].name } left` );
		for ( const id in people ) if ( before[ id ] && ! people[ id ].self && before[ id ].name !== people[ id ].name ) this.ui.system( `${ before[ id ].name } is now ${ people[ id ].name }` );
		this.ui.setRoom( this.code, people, false );

	}

	// a line from the chat box: /name changes your name, anything else goes to everyone
	say( text ) {

		const m = /^\/name\s+(.+)$/i.exec( text.trim() );
		if ( m ) {

			this.setName( m[ 1 ] );
			return;

		}

		if ( /^\/(invite|link)$/i.test( text.trim() ) ) return this.copyLink();
		if ( /^\/leave$/i.test( text.trim() ) ) return this.leave();
		if ( ! this.room ) return;
		const sent = this.room.say( text );
		const me = this.people[ this.room.selfId ];
		if ( sent && this.ui ) this.ui.chat( this.name, sent, me ? me.hue : 0.5, true );

	}

	setName( name, quiet = false ) {

		const n = cleanName( name );
		if ( ! n || n === this.name ) return;
		this.name = n;
		try {

			localStorage.setItem( NAME_KEY, n );

		} catch ( e ) { /* private mode */ }

		if ( this.room ) this.room.setName( n );
		if ( this.ui && ! quiet ) this.ui.system( `You're ${ n } now` );

	}

	update( dt ) {

		const now = this.now;
		if ( this.divers ) this.divers.update( dt, now, this.app.camera );
		if ( this.ui ) this.ui.update( dt );
		if ( ! this.room ) return;
		this._sendT -= dt;
		if ( this._sendT > 0 ) return;
		this._sendT = 1 / SEND_HZ;
		// nobody to send to: skip it (the room still announces you to the relays)
		if ( Object.keys( this.people ).length < 2 ) return;
		this.room.sendPose( encodePose( this.myPose( now ), this._buf ) );

	}

	myPose( t ) {

		const p = this.app.player, sp = this.game.spear, o = this._pose;
		o.t = t;
		o.x = p.position.x; o.y = p.position.y; o.z = p.position.z;
		o.yaw = p.yaw; o.pitch = p.pitch;
		o.mode = p.mode;
		o.floating = !! p.floating;
		o.gun = !! ( sp && sp.equipped );
		o.blackout = !! ( sp && sp.phase === 'blackout' );
		o.duck = p.duck !== null && p.duck !== undefined;
		o.speed = Math.hypot( p.velocity.x, p.velocity.y, p.velocity.z );
		o.depth = Math.max( 0, ( p.waterH || 0 ) - p.position.y );
		return o;

	}

}

function randomUnit() {

	const a = new Uint32Array( 1 );
	crypto.getRandomValues( a );
	return a[ 0 ] / 4294967296;

}

function loadName() {

	try {

		const n = cleanName( localStorage.getItem( NAME_KEY ) );
		if ( n ) return n;

	} catch ( e ) { /* private mode */ }

	return 'Diver ' + ( 10 + Math.floor( Math.random() * 90 ) );

}
