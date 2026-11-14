import { Group, Mesh, Vector3 } from '../engine/index.js';

const _Y = new Vector3( 0, 1, 0 ), _d = new Vector3();
import { buildGunGeometry, buildBandGeometry, buildShaftGeometry, SHAFT_TAIL, RAIL_Z } from './SpearGun.js';
import { createPropMaterial } from './GameMaterials.js';

// Another diver's speargun, in their hand (Diver.gunMount): the same gun as your own (SpearGun.js
// builds it), its length, bands and wood from their profile, the bands loaded or hanging slack,
// the shaft on the rail until it's shot.
//   const g = new DiverGun( diver.gunMount );  g.setGear( { gunM, bands, gunKind } )
//   g.update( { gun, loaded, shaftOut } )
let material = null;
const sharedMaterial = () => material || ( material = createPropMaterial( 'diverGun', { clearcoat: true } ) );

export class DiverGun {

	constructor( mount, mat = null ) {

		this.mat = mat || ( typeof document !== 'undefined' ? sharedMaterial() : null );
		this.group = new Group();
		this.group.name = 'DiverGun';
		this.group.visible = false;
		mount.add( this.group );
		this.gear = null;
		this.gun = this._mesh();
		this.shaft = this._mesh();
		this.shaft.position.set( 0, SHAFT_TAIL, RAIL_Z );
		this.bands = [ 0, 1 ].map( () => ( { loaded: this._mesh(), slack: this._mesh() } ) );
		this.setGear( null );

	}

	_mesh() {

		const m = new Mesh( undefined, this.mat );
		m.castShadow = true;
		this.group.add( m );
		return m;

	}

	setGear( gear ) {

		const g = gear || { gunM: 0.75, bands: 1, gunKind: 'wood' };
		const c = this.gear;
		if ( c && c.gunM === g.gunM && c.bands === g.bands && c.gunKind === g.gunKind ) return;
		this.gear = { ...g };
		const swap = ( m, geo ) => {

			if ( m.geometry && m.geometry.dispose ) m.geometry.dispose();
			m.geometry = geo;

		};
		swap( this.gun, buildGunGeometry( g.gunM, g.gunKind ) );
		swap( this.shaft, buildShaftGeometry( g.gunM ) );
		for ( let k = 0; k < 2; k ++ ) {

			swap( this.bands[ k ].loaded, buildBandGeometry( g.gunM, k, true, g.gunKind ) );
			swap( this.bands[ k ].slack, buildBandGeometry( g.gunM, k, false, g.gunKind ) );

		}

	}

	// the pose's gun state: out or not, bands loaded, the shaft off the gun
	update( { gun = false, loaded = 0, shaftOut = false } = {} ) {

		this.group.visible = !! gun;
		if ( ! gun ) return;
		const n = this.gear.bands;
		for ( let k = 0; k < 2; k ++ ) {

			this.bands[ k ].loaded.visible = k < n && k < loaded && ! shaftOut;
			this.bands[ k ].slack.visible = k < n && ! ( k < loaded && ! shaftOut );

		}

		this.shaft.visible = ! shaftOut;

	}

	dispose() {

		for ( const m of [ this.gun, this.shaft, ...this.bands.flatMap( ( b ) => [ b.loaded, b.slack ] ) ] ) if ( m.geometry ) m.geometry.dispose();
		this.group.removeFromParent();

	}

}

// A shot someone else fired: their shaft flying out along its line and slowing in the water, then
// hanging where it stopped until their pose says it's back on the gun (or 20 s pass).
export class FlyingShaft {

	constructor( scene, shot, gunM = 0.75, mat = null ) {

		this.scene = scene;
		this.mesh = new Mesh( buildShaftGeometry( gunM ), mat || ( typeof document !== 'undefined' ? sharedMaterial() : null ) );
		this.mesh.name = 'RemoteShaft';
		this.mesh.castShadow = true;
		this.p = shot.p.slice();
		this.d = shot.d.slice();
		this.v = shot.v;
		this.t = 0;
		this.place();
		scene.add( this.mesh );

	}

	// the shaft's frame: +Y tail to tip; it points along d
	place() {

		const m = this.mesh;
		m.position.set( this.p[ 0 ], this.p[ 1 ], this.p[ 2 ] );
		m.quaternion.setFromUnitVectors( _Y, _d.set( this.d[ 0 ], this.d[ 1 ], this.d[ 2 ] ) );

	}

	// false once it's done (back on their gun, or too long out)
	update( dt, shaftOut ) {

		this.t += dt;
		if ( this.v > 0.05 ) {

			// water drag on a 6.5 mm shaft: it loses about 15 percent of its speed a metre
			const step = this.v * dt;
			for ( let i = 0; i < 3; i ++ ) this.p[ i ] += this.d[ i ] * step;
			this.v *= Math.exp( - 0.15 * step );
			if ( this.v < 1.5 ) this.v = Math.max( 0, this.v - dt * 4 );
			this.place();

		}

		return ! ( this.t > 20 || ( this.t > 0.5 && shaftOut === false ) );

	}

	dispose() {

		this.scene.remove( this.mesh );
		if ( this.mesh.geometry ) this.mesh.geometry.dispose();

	}

}
