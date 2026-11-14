import { Group, Mesh, Vector3, Color } from '../engine/index.js';
import { prepare, mergePrepared, cylinder, sphere, roundedBox, box, rod, mat4 } from '../world/boat/GeoKit.js';
import { PAT } from './GameMaterials.js';
import { PoseBuffer } from '../net/Pose.js';

// The other divers in your dive room (game/NetPlay.js feeds their poses): a freediver in a
// wetsuit, hood, mask and long fins in their own colour, upright on land and on deck, lying flat
// and kicking in the water, with their name over their head.
//   const divers = new RemoteDivers( { scene, material, root } )
//   divers.pose( userId, pose, now ); divers.setPeople( people ); divers.update( dt, now, camera )

const HIP = 0.92; // the legs swing from here
const SWIM_PIVOT = 1.45; // swimming, the figure turns about this height: the float point at the chest
const _v = new Vector3();
const _c = new Color();

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
			d = new RemoteDiver( id, who ? who.hue : 0.55, this.material );
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
			else d.setName( who.name );

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

	constructor( id, hue, material ) {

		this.id = id;
		this.hue = hue;
		this.buffer = new PoseBuffer();
		this.group = new Group();
		this.group.name = 'Diver:' + id.slice( 0, 8 );
		this.group.visible = false;
		this.tilt = new Group(); // stands up (0) or lies along the view (swimming)
		this.body = new Group();
		this.tilt.add( this.body );
		this.group.add( this.tilt );
		const accent = _c.setHSL( hue, 0.75, 0.5 ).getHex();
		this.geos = [ buildBody( accent ), buildLeg( accent, false ), buildLeg( accent, true ) ];
		this.torso = new Mesh( this.geos[ 0 ], material );
		this.body.add( this.torso );
		this.legs = [];
		this.fins = [];
		for ( const s of [ - 1, 1 ] ) {

			const pivot = new Group();
			pivot.position.set( s * 0.1, HIP, 0 );
			const leg = new Mesh( this.geos[ 1 ], material );
			const fin = new Mesh( this.geos[ 2 ], material );
			pivot.add( leg, fin );
			this.body.add( pivot );
			this.legs.push( pivot );
			this.fins.push( fin );

		}

		for ( const m of [ this.torso, ...this.legs.flatMap( ( l ) => l.children ) ] ) m.castShadow = true;
		this.pose = {};
		this.lie = 0; // 0 upright .. 1 lying along the view
		this.kick = 0;
		this.kickAmp = 0;
		this.name = '';
		this.tag = null;

	}

	setName( name ) {

		if ( name === this.name ) return;
		this.name = name;
		if ( this.tag ) {

			this.tag.textContent = name;
			this.tag.style.setProperty( '--nt-c', `hsl(${ Math.round( this.hue * 360 ) } 80% 60%)` );

		}

	}

	update( dt, now ) {

		const p = this.buffer.sample( now, dt, this.pose );
		const g = this.group;
		if ( ! p ) return;
		g.visible = true;
		const swim = p.mode === 'swim';
		// lie flat swimming; at the surface the head stays a little up, looking ahead
		const wantLie = swim ? 1 : 0;
		this.lie += ( wantLie - this.lie ) * ( 1 - Math.exp( - dt * 5 ) );
		const pitch = Math.max( - 1.45, Math.min( 1.3, p.pitch ) );
		const swimTilt = p.floating ? Math.PI / 2 - 0.12 - pitch * 0.25 : Math.PI / 2 - pitch;
		const blackout = p.blackout ? 1 : 0;
		g.position.set( p.x, p.y, p.z );
		g.rotation.order = 'YXZ';
		g.rotation.y = p.yaw + Math.PI; // the figure faces +Z, the view looks down -Z
		this.tilt.rotation.x = swimTilt * this.lie + blackout * 0.4;
		this.body.position.y = - SWIM_PIVOT * this.lie;
		// fins on in the water, off on land; kicking with the speed through the water
		for ( const f of this.fins ) f.visible = this.lie > 0.5;
		const kicking = swim && ! blackout ? Math.min( 1, p.speed / 1.2 ) : 0;
		this.kickAmp += ( kicking - this.kickAmp ) * ( 1 - Math.exp( - dt * 4 ) );
		this.kick += dt * ( 4 + 3 * this.kickAmp );
		const swing = Math.sin( this.kick ) * ( 0.06 + 0.32 * this.kickAmp ) * this.lie;
		this.legs[ 0 ].rotation.x = swing;
		this.legs[ 1 ].rotation.x = - swing;

	}

	// the head's centre in the world, for the name tag
	headWorld( out ) {

		this.group.updateMatrixWorld( true );
		return out.set( 0, 1.58, 0 ).applyMatrix4( this.body.matrixWorld );

	}

	dispose() {

		for ( const g of this.geos ) g.dispose();

	}

}

// ---- the figure: ~1.75 m, facing +Z, feet at the origin (legs and fins are separate: buildLeg)
const SUIT = { color: 0x16191c, rough: 0.55, pattern: PAT.rubber };
const SKIN = { color: 0x9a6a4a, rough: 0.55, pattern: PAT.skin };

function buildBody( accent ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const V = ( x, y, z ) => new Vector3( x, y, z );
	const ACC = { color: accent, rough: 0.5 };
	// hips and torso, a coloured stripe down each side
	add( roundedBox( 0.34, 0.2, 0.22, 0.07, 2 ), { ...SUIT, matrix: mat4( 0, 0.94, 0 ) } );
	add( roundedBox( 0.38, 0.5, 0.23, 0.09, 3 ), { ...SUIT, matrix: mat4( 0, 1.24, 0 ) } );
	for ( const s of [ - 1, 1 ] ) add( box( 0.012, 0.42, 0.08 ), { ...ACC, matrix: mat4( s * 0.192, 1.22, 0 ) } );
	add( box( 0.2, 0.05, 0.012 ), { ...ACC, matrix: mat4( 0, 1.36, 0.118 ) } );
	// arms along the sides (freedivers glide with the arms back)
	for ( const s of [ - 1, 1 ] ) {

		add( rod( V( s * 0.22, 1.44, 0 ), V( s * 0.25, 1.16, 0.0 ), 0.05, 8, 0.045 ), SUIT );
		add( rod( V( s * 0.25, 1.16, 0.0 ), V( s * 0.24, 0.9, 0.03 ), 0.042, 8, 0.036 ), SUIT );
		add( sphere( 0.042, 8, 6 ), { ...SUIT, matrix: mat4( s * 0.24, 0.85, 0.04, 0, 0, 0, 0.8, 1.2, 1 ) } );

	}

	// neck, hooded head, face, mask and snorkel
	add( cylinder( 0.06, 0.065, 0.1, 10 ), { ...SUIT, matrix: mat4( 0, 1.52, 0 ) } );
	add( sphere( 0.11, 14, 10 ), { ...SUIT, matrix: mat4( 0, 1.63, 0, 0, 0, 0, 1, 1.12, 1.04 ) } );
	add( sphere( 0.085, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6 ), { ...SKIN, matrix: mat4( 0, 1.6, 0.05, Math.PI / 2, 0, 0, 0.9, 1, 1.1 ) } );
	add( roundedBox( 0.17, 0.075, 0.05, 0.02, 2 ), { color: 0x0b0d0e, rough: 0.35, matrix: mat4( 0, 1.66, 0.105 ) } );
	add( box( 0.15, 0.055, 0.008 ), { color: 0x6f8f9c, rough: 0.05, metal: 0.2, matrix: mat4( 0, 1.66, 0.131 ) } );
	add( torus0( 0.116, 0.008 ), { ...ACC, matrix: mat4( 0, 1.66, - 0.005 ) } );
	add( rod( V( 0.11, 1.56, 0.06 ), V( 0.12, 1.84, 0.0 ), 0.012, 6 ), { ...ACC } );
	return mergePrepared( P );

}

// one leg, in the pivot's frame (the hip at the origin): the suit, or with `fin` the long blade
function buildLeg( accent, fin ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const V = ( x, y, z ) => new Vector3( x, y, z );
	if ( ! fin ) {

		add( rod( V( 0, 0, 0 ), V( 0, - 0.45, 0.01 ), 0.075, 10, 0.06 ), SUIT );
		add( rod( V( 0, - 0.45, 0.01 ), V( 0, - 0.86, - 0.02 ), 0.058, 10, 0.045 ), SUIT );
		add( roundedBox( 0.09, 0.07, 0.22, 0.03, 2 ), { ...SUIT, matrix: mat4( 0, - 0.89, 0.05 ) } );

	} else {

		// foot pocket, then a long thin blade carrying on along the leg
		add( roundedBox( 0.1, 0.11, 0.24, 0.035, 2 ), { color: 0x0b0d0e, rough: 0.6, pattern: PAT.rubber, matrix: mat4( 0, - 0.9, 0.04 ) } );
		add( box( 0.2, 0.75, 0.012 ), { color: accent, rough: 0.35, matrix: mat4( 0, - 1.32, 0 ) } );
		for ( const s of [ - 1, 1 ] ) add( box( 0.012, 0.75, 0.03 ), { color: 0x0b0d0e, rough: 0.5, matrix: mat4( s * 0.1, - 1.32, 0 ) } );

	}

	return mergePrepared( P );

}

function torus0( R, r ) {

	// a ring for the mask strap: a short open cylinder reads the same at this size
	return cylinder( R, R, r * 2, 16, 1, true );

}
