import { Vector3 } from '../engine/index.js';
import { PoseBuffer } from '../net/Pose.js';
import { Diver } from './Diver.js';

// The other divers in your dive room (game/NetPlay.js feeds their poses): the freediver figure
// (game/Diver.js) in their own colour, upright on land and on deck, lying along their view and
// kicking in the water, with their name over their head.
//   const divers = new RemoteDivers( { scene, material, root } )
//   divers.pose( userId, pose, now ); divers.setPeople( people ); divers.update( dt, now, camera )

const _v = new Vector3();

const TAG_CSS = /* css */`
.nt-layer { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.nt { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); white-space: nowrap; will-change: transform;
	padding: calc(2 * var(--tw-u, 1px)) calc(8 * var(--tw-u, 1px)); border-radius: 999px; background: rgba(8, 20, 28, 0.55);
	font: 600 var(--tw-fs-sm, 12px) var(--tw-font, sans-serif); color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.6); }
.nt::before { content: ''; display: inline-block; width: 0.6em; height: 0.6em; border-radius: 50%; margin-right: 0.4em; background: var(--nt-c); vertical-align: 0.05em; }
.nt.is-away { opacity: 0.45 !important; font-style: italic; }
.tw-root.is-photo .nt-layer { display: none; }
`;

export class RemoteDivers {

	constructor( { scene, material, root = null } ) {

		this.scene = scene;
		this.material = material;
		this.divers = new Map();
		this.people = {};
		this.layer = null;
		if ( root && typeof document !== 'undefined' ) {

			const style = document.createElement( 'style' );
			style.textContent = TAG_CSS;
			document.head.append( style );
			this.layer = document.createElement( 'div' );
			this.layer.className = 'nt-layer';
			root.prepend( this.layer );

		}

	}

	// someone's pose arrived
	pose( id, p, now ) {

		let d = this.divers.get( id );
		if ( ! d ) {

			const who = this.people[ id ];
			if ( who && who.self ) return;
			d = new RemoteDiver( id, who ? who.hue : 0.55, this.material, who ? who.look : null );
			this.divers.set( id, d );
			this.scene.add( d.group );
			if ( this.layer ) {

				d.tag = document.createElement( 'div' );
				d.tag.className = 'nt';
				this.layer.append( d.tag );
				d.setName( who ? who.name : 'Diver' );

			}

		}

		d.buffer.push( p, now );

	}

	// who is in the room ({ [userId]: { name, hue, self } }): names change, leavers go
	setPeople( people ) {

		this.people = people;
		for ( const [ id, d ] of this.divers ) {

			const who = people[ id ];
			if ( ! who || who.self ) this.remove( id );
			else {

				d.diver.setLook( who.look );
				d.setName( who.name, true );

			}

		}

	}

	remove( id ) {

		const d = this.divers.get( id );
		if ( ! d ) return;
		this.scene.remove( d.group );
		d.dispose();
		if ( d.tag ) d.tag.remove();
		this.divers.delete( id );

	}

	clear() {

		for ( const id of [ ...this.divers.keys() ] ) this.remove( id );

	}

	// where each one is now, and their name tags over their heads
	update( dt, now, camera ) {

		const w = this.layer ? this.layer.clientWidth : 0, h = this.layer ? this.layer.clientHeight : 0;
		if ( camera && this.layer ) camera.updateMatrixWorld();
		for ( const d of this.divers.values() ) {

			d.update( dt, now );
			if ( ! d.tag ) continue;
			const away = d.buffer.age( now ) > 3;
			d.tag.classList.toggle( 'is-away', away );
			const g = d.group;
			if ( ! g.visible || ! camera ) {

				d.tag.style.display = 'none';
				continue;

			}

			d.headWorld( _v );
			const dist = _v.distanceTo( camera.position );
			_v.y += 0.35;
			_v.project( camera );
			if ( _v.z < - 1 || _v.z > 1 || dist > 120 || Math.abs( _v.x ) > 1.2 || Math.abs( _v.y ) > 1.2 ) {

				d.tag.style.display = 'none';
				continue;

			}

			d.tag.style.display = '';
			d.tag.style.opacity = String( Math.max( 0.35, Math.min( 1, 1.4 - dist / 80 ) ) );
			d.tag.style.transform = `translate(${ ( ( _v.x + 1 ) / 2 * w ).toFixed( 1 ) }px, ${ ( ( 1 - _v.y ) / 2 * h ).toFixed( 1 ) }px) translate(-50%, -100%)`;

		}

	}

	get count() {

		return this.divers.size;

	}

}

class RemoteDiver {

	constructor( id, hue, material, look = null ) {

		this.id = id;
		this.hue = hue;
		this.buffer = new PoseBuffer();
		this.diver = new Diver( { material, hue, look } );
		this.group = this.diver.group;
		this.group.name = 'Diver:' + id.slice( 0, 8 );
		this.group.visible = false;
		this.pose = {};
		this.name = '';
		this.tag = null;
		this._pos = new Vector3();

	}

	// the figure's joints, for the tests and the tags
	get legs() { return this.diver.legs; }
	get fins() { return this.diver.fins; }

	// the tag: the name, and a dot in the suit's trim colour
	setName( name, force = false ) {

		if ( name === this.name && ! force ) return;
		this.name = name;
		if ( this.tag ) {

			this.tag.textContent = name;
			const a = this.diver.look.accent;
			this.tag.style.setProperty( '--nt-c', '#' + a.toString( 16 ).padStart( 6, '0' ) );

		}

	}

	update( dt, now ) {

		const p = this.buffer.sample( now, dt, this.pose );
		if ( ! p ) return;
		this.group.visible = true;
		const d = this.diver;
		d.setPose( { mode: p.mode, floating: p.floating, pitch: p.pitch, speed: p.speed, blackout: p.blackout, gun: p.gun, sprint: p.speed > 2.0 } );
		// a duck dive starts as the flag comes on; the figure keeps its own clock for the rest
		if ( p.duck && ! this._duck ) d.duckDive();
		this._duck = !! p.duck;
		d.update( dt );
		d.place( p.yaw, this._pos.set( p.x, p.y, p.z ) );

	}

	// the head's centre in the world, for the name tag
	headWorld( out ) {

		return this.diver.headWorld( out );

	}

	dispose() {

		this.diver.dispose();

	}

}
