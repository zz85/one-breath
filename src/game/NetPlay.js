import { encodePose, makeDiveCode, cleanDiveCode, cleanName } from '../net/Pose.js';
import { DiveRoom, MAX_DIVERS } from '../net/DiveRoom.js';
import { RemoteDivers } from './RemoteDivers.js';
import { NetUI } from '../ui/NetUI.js';
import { myLook, saveLook, cleanLook, personColour } from './Look.js';

// Diving with friends: an invite link (?dive=<code>) puts everyone who opens it in one
// peer-to-peer room (net/DiveRoom.js). Each player sends their own pose ~12 times a second,
// sees the others as divers with name tags (game/RemoteDivers.js), and can chat (ui/NetUI.js).
// Everyone wears their own suit colours (game/Look.js). The host (who made the dive) sets the time
// of day and the weather for everyone; the fish and other animals are still each player's own.
const SEND_HZ = 12;
const WORLD_EVERY = 1; // s: how often the host checks its time and weather for a change
const TIME_EVERY = 5; // s: with time running, how often the host sends it again
const NAME_KEY = 'onebreath.name';
const HOSTED_KEY = 'onebreath.hosted'; // the codes of the dives this browser made: you're their host

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
		this.look = myLook();
		if ( game.spear ) game.spear.onShot = ( p, d, v ) => this.shot( p, d, v );
		this._worldT = 0;
		this._worldSent = null;
		this._worldSentAt = - Infinity;
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
		rememberHosted( code );
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
		const joining = this.joining = DiveRoom.join( code, { name: this.name, look: this.look, host: isHosted( code ) } );
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
			if ( this.ui ) this.ui.chat( who ? who.name : 'Diver', text, personColour( who ) );

		} );
		// the host's time and weather (never your own: the host's own writes don't come back)
		room.onWorld( ( c ) => this.applyWorld( c ) );
		room.onShot( ( id, shot ) => this.divers && this.divers.shot( id, shot ) );
		this._gearKey = null;
		this._worldSent = null;
		room.onError( ( e ) => {

			if ( ! this.ui ) return;
			if ( e.code === 'room-full' ) this.ui.system( `This dive is full (${ MAX_DIVERS } divers).` );
			else if ( e.code === 'peer-connect-failed' ) this.ui.system( 'Couldn\'t connect to one of the divers. Their network (often mobile data) blocks direct connections.' );

		} );
		this._people( room.people() );
		if ( this.ui ) this.ui.system( `You're ${ this.name }. Press Enter to chat. Click your name above to change it.` );

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
		const host = Object.keys( people ).find( ( id ) => people[ id ].host && ! people[ id ].self );
		const hadHost = Object.keys( before ).find( ( id ) => before[ id ].host && ! before[ id ].self );
		if ( host && ! hadHost ) this.ui.system( `${ people[ host ].name } hosts this dive: they set the time and weather` );
		this.ui.setRoom( this.code, people, false );

	}

	get isHost() {

		return !! ( this.room && this.room.isHost );

	}

	// the host's name, where someone else hosts
	get hostName() {

		const id = this.room && this.room.hostId;
		const p = id && this.people[ id ];
		return p && ! p.self ? p.name : null;

	}

	// a guest: the host's time and weather (AppUI clamps every number)
	applyWorld( c ) {

		if ( this.isHost || ! this.app.ui || ! this.app.ui.setConditions ) return;
		this.app.ui.setConditions( c );
		if ( this.ui ) this.ui.worldChanged();

	}

	// the host: time and weather to everyone, when they change (and the time every few seconds
	// while it runs, so everyone's sun stays together)
	_sendWorld( dt, now ) {

		if ( ! this.isHost || ! this.app.ui || ! this.app.ui.getConditions ) return;
		this._worldT -= dt;
		if ( this._worldT > 0 ) return;
		this._worldT = WORLD_EVERY;
		const c = this.app.ui.getConditions();
		const last = this._worldSent;
		const { time, ...rest } = c;
		const changed = ! last || JSON.stringify( rest ) !== JSON.stringify( last.rest ) || Math.abs( time - last.time ) > ( c.speed ? 0.5 : 0.01 ) || ( c.speed && now - this._worldSentAt > TIME_EVERY );
		if ( ! changed ) return;
		this._worldSent = { time, rest };
		this._worldSentAt = now;
		this.room.setWorld( round( c ) );

	}

	// the host's quick controls (ui/NetUI.js): a time of day, time running or not, a weather
	setTime( hour, speed ) {

		const app = this.app;
		if ( ! app.ui || ! app.ui.setConditions ) return;
		app.ui.setConditions( { time: hour, ...( speed !== undefined ? { speed } : {} ) } );
		app.settings.timeOfDay = hour; // exactly, not eased
		this._worldT = 0;
		this._worldSent = null;

	}

	setWeather( name ) {

		if ( ! this.app.ui || ! this.app.ui.setWeather ) return;
		this.app.ui.setWeather( name );
		this._worldT = 0;

	}

	// your suit: worn at once, kept for next time, sent to the dive
	setLook( look ) {

		const l = { ...this.look, ...( cleanLook( look ) || {} ) };
		this.look = l;
		saveLook( l );
		if ( this.game.me && this.game.me.diver ) this.game.me.diver.setLook( l );
		if ( this.room ) this.room.setLook( l );

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
		if ( sent && this.ui ) this.ui.chat( this.name, sent, personColour( me ), true );

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
		this._sendWorld( dt, now );
		this._sendGear();
		this._sendT -= dt;
		if ( this._sendT > 0 ) return;
		this._sendT = 1 / SEND_HZ;
		// nobody to send to: skip it (the room still announces you to the relays)
		if ( Object.keys( this.people ).length < 2 ) return;
		this.room.sendPose( encodePose( this.myPose( now ), this._buf ) );

	}

	// your speargun (its length, bands and wood: the gear you bought) in your profile, when it changes
	_sendGear() {

		const sp = this.game.spear, g = sp && sp.gun && sp.gun.gear;
		if ( ! g ) return;
		const key = `${ g.gunM }/${ g.bands }/${ g.gunKind }`;
		if ( key === this._gearKey ) return;
		this._gearKey = key;
		this.room.setGear( g );

	}

	// your shot (Spearfishing.onShot): the others see the shaft fly
	shot( p, d, v ) {

		if ( this.room && Object.keys( this.people ).length > 1 ) this.room.shoot( p, d, v );

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
		o.aim = !! ( sp && sp.equipped && sp.aiming );
		o.loaded = sp && sp.gun ? sp.gun.bandsLoaded : 0;
		o.shaftOut = !! ( sp && sp.gun && ! sp.gun.shaftHome );
		o.duck = p.duck !== null && p.duck !== undefined;
		o.speed = Math.hypot( p.velocity.x, p.velocity.y, p.velocity.z );
		o.depth = Math.max( 0, ( p.waterH || 0 ) - p.position.y );
		return o;

	}

}

const round = ( c ) => {

	const o = {};
	for ( const k in c ) o[ k ] = typeof c[ k ] === 'number' ? Math.round( c[ k ] * 1000 ) / 1000 : c[ k ];
	return o;

};

function isHosted( code ) {

	try {

		return ( JSON.parse( localStorage.getItem( HOSTED_KEY ) || '[]' ) ).includes( code );

	} catch ( e ) {

		return false;

	}

}

function rememberHosted( code ) {

	try {

		const list = ( JSON.parse( localStorage.getItem( HOSTED_KEY ) || '[]' ) ).filter( ( c ) => c !== code );
		list.push( code );
		localStorage.setItem( HOSTED_KEY, JSON.stringify( list.slice( - 20 ) ) );

	} catch ( e ) { /* private mode */ }

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
