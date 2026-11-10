// Practice mode, from the URL: straight to the fish with the gun loaded.
//   ?hunt              next to a school of jacks, under water, facing it, the gun out and loaded
//   ?hunt=barracuda    another kind (the world's swimmers, world/Fish.js; ?hunt=list names them)
//   &dist=3            how far from the school (m)
//   &gear              the best gear (a 110 cm carbon gun, the best shaft, a reel, carbon fins),
//                      bought with money given for it; it stays in your save
//   &wild              the fish as wary as ever and a real breath-hold (practice makes them calm and
//                      your breath endless otherwise)
// In practice mode N takes you to another school of the same kind. window.__hunt( name, dist ) does
// the same from the console, with or without ?hunt.
const BEST = [ 'gun', 'gun', 'shaft', 'shaft', 'reel', 'fins', 'fins' ];

export class Practice {

	constructor( game ) {

		this.game = game;
		const qs = game.app.qs;
		this.on = !! qs && qs.has( 'hunt' );
		this.kind = ( qs && qs.get( 'hunt' ) ) || 'jack';
		this.dist = Math.max( 1, Number( qs && qs.get( 'dist' ) ) || 3 );
		this._started = false;
		this._last = - 1;
		if ( typeof window !== 'undefined' ) window.__hunt = ( name = this.kind, dist = this.dist ) => this.goTo( name, dist );
		if ( ! this.on ) return;
		if ( qs.has( 'gear' ) ) {

			const s = game.state;
			s.money += 5000;
			for ( const k of BEST ) s.buy( k );

		}

		if ( ! qs.has( 'wild' ) ) game.spear.practice = { calm: true, air: true };

	}

	// the kinds of swimmer in the world
	kinds() {

		const fish = this.game.spear.fish;
		return fish ? [ ...new Set( fish.groups.map( ( g ) => g.sp.name ) ) ].filter( ( n ) => n !== 'remora' ) : [];

	}

	goTo( name = this.kind, dist = this.dist ) {

		const app = this.game.app, sp = this.game.spear, fish = sp.fish, p = app.player;
		if ( ! fish ) return 'no fish in this world';
		if ( name === 'list' ) {

			const msg = this.kinds().join( ', ' );
			this.game.toast( `Kinds: ${ msg }`, 8000 );
			return msg;

		}
		// the whale's escort only exists while the whale swims near
		const gs = fish.groups.filter( ( g ) => g.sp.name === name && g.count > 0 );
		if ( ! gs.length ) {

			const msg = `No ${ name } here. Try: ${ this.kinds().join( ', ' ) }`;
			this.game.toast( msg, 5000 );
			return msg;

		}

		// the next school of that kind each time
		this._last = ( this._last + 1 ) % gs.length;
		const g = gs[ this._last ];
		const c = g.center;
		// out of the free camera without dropping the player where it is (we place them below)
		if ( app.freeCam ) app.freeCam = false;
		// off the boat: at the helm or on deck the player rides it
		if ( p.mode === 'boat' && app.boatCtl ) app.boatCtl.driven = false;

		// beside the school, at its depth (never above 1.5 m down), on the side with water to swim in
		const terrain = app.terrainData;
		let best = null;
		for ( let k = 0; k < 12; k ++ ) {

			const a = k / 12 * Math.PI * 2;
			const x = c.x + Math.cos( a ) * dist, z = c.z + Math.sin( a ) * dist;
			const floor = terrain.heightAt( x, z );
			const room = Math.min( - 0.5, c.y ) - floor;
			if ( ! best || room > best.room ) best = { x, z, room, floor };

		}

		const y = Math.max( best.floor + 0.6, Math.min( c.y, - 1.5 ) );
		p.mode = 'swim';
		p.floating = false;
		p.velocity.set( 0, 0, 0 );
		p.position.set( best.x, y, best.z );
		const dx = c.x - best.x, dy = c.y - y, dz = c.z - best.z;
		p.yaw = Math.atan2( - dx, - dz );
		p.pitch = Math.atan2( dy, Math.hypot( dx, dz ) );
		sp.equip( true );
		if ( sp.phase === 'home' ) sp.gun.bandsLoaded = sp.stats.bands;
		const msg = `${ g.count } ${ name } ${ ( - c.y ).toFixed( 1 ) } m down${ this.on ? '   ·   N  next school' : '' }`;
		this.game.toast( msg, 3500 );
		return msg;

	}

	update() {

		if ( ! this.on ) return;
		const app = this.game.app;
		// once the world runs (the fish have been placed and the player has had a frame)
		if ( ! this._started ) {

			this._started = true;
			this.goTo();
			return;

		}

		if ( app.input.hit( 'KeyN' ) ) this.goTo();

	}

}
