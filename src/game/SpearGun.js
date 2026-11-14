import { Mesh, Matrix4, Vector3, BufferGeometry, Float32BufferAttribute } from '../engine/index.js';
import { prepare, mergePrepared, cylinder, sphere, rod, mat4, lathe, roundedBox, tube, box } from '../world/boat/GeoKit.js';
import { createPropMaterial, createLineMaterial, PAT } from './GameMaterials.js';

// The speargun in the diver's hand, its shaft and the shooting line.
//
// A band-powered "euro" / railgun at real scale: a barrel (wood, teak or a carbon tube) with a rail
// the shaft lies in, an open muzzle the bands thread through, a pistol grip with trigger, guard and
// line release behind it, two line pegs under the barrel, a rubber butt pad; one or two latex bands
// (16 mm, amber) with dyneema wishbones; a stainless shaft with a tri-cut tip, a hinged flopper and
// two shark fins the wishbones hook onto; 1.6 mm mono shooting line wrapped from the shaft's tail to
// the muzzle and back to the release.
//
// Gun frame: +Y along the barrel (butt at 0, muzzle at gunM), +Z up (the rail), the grip hangs
// toward -Z, +X to the right. Held in first person by the grip, relative to the camera: a pose
// (elevation, sideways swing, hand position) is eased between the states the controller sets
// (stowed, idle, aim, loading). The shaft has its own frame: +Y from its tail (0) to its tip.
//
// The bands are separate meshes per band and state (stretched to the shaft's fins, or hanging slack
// from the muzzle), shown by the controller's bandsLoaded.
export const SHAFT_EXTRA = 0.28; // the shaft sticks out ahead of the muzzle by about this much
export const SHAFT_TAIL = 0.06; // and its tail sits in the trigger mechanism, this far ahead of the butt
export const GRIP_Y = 0.16; // the hand holds the grip here
export const RAIL_Z = 0.026; // shaft axis above the barrel's axis
const LINE_SEGS = 40;
// where the loaded bands hook the shaft's shark fins along the barrel: front band, rear band
const finY = ( gunM, k ) => gunM * 0.45 - k * 0.05;

const _m = new Matrix4(), _v = new Vector3(), _w = new Vector3(), _x = new Vector3(), _y = new Vector3(), _z = new Vector3(), _h = new Vector3();
const _up = new Vector3( 0, 1, 0 );

export const GUN_POSES = {
	stowed: { elev: - 1.0, side: 0.45, hand: [ 0.28, - 0.6, - 0.1 ] },
	idle: { elev: - 0.12, side: 0.1, hand: [ 0.17, - 0.2, - 0.32 ] },
	// aim: the gun under the eye, tilted up a touch so the shaft's line crosses the view about 3 m out
	aim: { elev: 0.02, side: 0.0, hand: [ 0.0, - 0.085, - 0.3 ] },
	// loading: the butt against the chest, the gun pointing down and ahead
	loading: { elev: - 0.65, side: - 0.05, hand: [ 0.05, - 0.32, - 0.12 ] },
	// arm out, the line in the other hand
	haul: { elev: - 0.2, side: 0.2, hand: [ 0.22, - 0.24, - 0.28 ] },
};

export class SpearGun {

	constructor( { scene, camera } ) {

		this.camera = camera;
		this.scene = scene;
		this.equipped = false;
		this.state = 'stowed'; // pose: stowed | idle | aim | loading | haul
		this.bandsLoaded = 0;
		this.loadT = 0; // the band being stretched now, 0..1
		this.shaftHome = true;
		this.recoil = 0;
		this.pose = { elev: GUN_POSES.stowed.elev, side: GUN_POSES.stowed.side, hand: new Vector3( ...GUN_POSES.stowed.hand ) };
		this.t = 0;
		this.muzzle = new Vector3(); // world: the muzzle's front, on the shaft's axis
		this.lineClip = new Vector3(); // world: where the line leaves the muzzle
		this.forward = new Vector3( 0, 0, - 1 ); // world: along the barrel
		this.shaftPos = new Vector3(); // world: the shaft's tail (when out)
		this.shaftDir = new Vector3( 0, 0, - 1 ); // world: tail to tip (when out)
		this.lineSlack = 0; // 0 taut .. 1 loose
		this.gear = null;

		this.mat = createPropMaterial( 'speargun', { clearcoat: true } );
		this.gunMesh = this._mesh( 'Speargun' );
		this.shaftMesh = this._mesh( 'SpearShaft' );
		this.bandMeshes = [ 0, 1 ].map( ( k ) => ( { loaded: this._mesh( `Band${ k }Loaded` ), slack: this._mesh( `Band${ k }Slack` ) } ) );
		this.lineMat = createLineMaterial( LINE_SEGS );
		this.lineMesh = new Mesh( buildLineGeometry( LINE_SEGS ), this.lineMat );
		this.lineMesh.name = 'ShootingLine';
		this.lineMesh.frustumCulled = false;
		this.lineMesh.castShadow = false;
		this.lineMesh.visible = false;
		scene.add( this.lineMesh );
		// let go of: the gun on its own in the water ({ p: muzzle, dir: butt to muzzle }), and the float
		// line from its butt to a torpedo float at the surface (or in the diver's hand)
		this.loose = null;
		this.float = null; // { p } while the float line is out
		this.floatMesh = this._mesh( 'SpearFloat', buildFloatGeometry() );
		this.floatLineMat = createLineMaterial( LINE_SEGS );
		this.floatLine = new Mesh( buildLineGeometry( LINE_SEGS ), this.floatLineMat );
		this.floatLine.name = 'FloatLine';
		this.floatLine.frustumCulled = false;
		this.floatLine.castShadow = false;
		this.floatLine.visible = false;
		scene.add( this.floatLine );
		this.butt = new Vector3();
		this.setGear( { gunM: 0.75, bands: 1, gunKind: 'wood' } );

	}

	_mesh( name, geo = null ) {

		const m = new Mesh( geo || mergePrepared( [ prepare( box( 0.001, 0.001, 0.001 ) ) ] ), this.mat );
		m.name = name;
		m.frustumCulled = false;
		m.castShadow = false;
		m.matrixAutoUpdate = false;
		m.visible = false;
		this.scene.add( m );
		return m;

	}

	get gunM() {

		return this.gear ? this.gear.gunM : 0.75;

	}

	get shaftL() {

		return this.gunM + SHAFT_EXTRA - SHAFT_TAIL;

	}

	setGear( { gunM, bands, gunKind } ) {

		const g = this.gear;
		if ( g && g.gunM === gunM && g.bands === bands && g.gunKind === gunKind ) return;
		this.gear = { gunM, bands, gunKind };
		const swap = ( mesh, geo ) => {

			if ( mesh.geometry && mesh.geometry.dispose ) mesh.geometry.dispose();
			mesh.geometry = geo;

		};

		swap( this.gunMesh, buildGunGeometry( gunM, gunKind ) );
		swap( this.shaftMesh, buildShaftGeometry( gunM ) );
		for ( let k = 0; k < 2; k ++ ) {

			swap( this.bandMeshes[ k ].loaded, buildBandGeometry( gunM, k, true, gunKind ) );
			swap( this.bandMeshes[ k ].slack, buildBandGeometry( gunM, k, false, gunKind ) );

		}

		this.bandsLoaded = Math.min( this.bandsLoaded, bands );

	}

	// gun frame -> world
	gunToWorld( x, y, z, out ) {

		return out.set( x, y, z ).applyMatrix4( this.gunMesh.matrix );

	}

	// the shaft's tail in the gun frame when it is home in the rail (it sits back in the release)
	get shaftHomeY() {

		return SHAFT_TAIL;

	}

	// per frame. sway: { x, y } radians of hand wobble; underwater tint isn't needed (lit as is)
	update( dt, { visible, sway = null } ) {

		this.t += dt;
		const cam = this.camera;
		const target = GUN_POSES[ this.equipped ? this.state : 'stowed' ] || GUN_POSES.idle;
		const k = 1 - Math.exp( - ( this.state === 'aim' ? 9 : 6 ) * dt );
		const p = this.pose;
		p.elev += ( target.elev - p.elev ) * k;
		p.side += ( target.side - p.side ) * k;
		p.hand.x += ( target.hand[ 0 ] - p.hand.x ) * k;
		p.hand.y += ( target.hand[ 1 ] - p.hand.y ) * k;
		p.hand.z += ( target.hand[ 2 ] - p.hand.z ) * k;
		// the kick of the shot (the bands slam forward, the gun jumps up and back), and the hand's sway
		this.recoil = Math.max( 0, this.recoil - dt * 5 );
		const r = this.recoil * this.recoil;
		let elev = p.elev + r * 0.18, side = p.side;
		if ( sway ) {

			elev += sway.y;
			side += sway.x;

		}

		// loading: the gun rocks as each band is pulled back
		if ( this.state === 'loading' ) elev += Math.sin( this.loadT * Math.PI ) * 0.1;
		_y.set( 0, 0, - 1 ).applyAxisAngle( _x.set( 1, 0, 0 ), elev ).applyAxisAngle( _up, side ).normalize();
		_z.set( 0, 1, 0 ).addScaledVector( _y, - _y.y ).normalize();
		_x.crossVectors( _y, _z ).normalize();
		_m.makeBasis( _x, _y, _z ).setPosition( _h.copy( p.hand ).addScaledVector( _y, - GRIP_Y + r * 0.06 ) );
		cam.updateMatrixWorld();
		let M;
		if ( this.loose ) {

			// let go of: towed muzzle first behind the fish, rolled a little
			const L = this.loose;
			_y.copy( L.dir ).normalize();
			_w.copy( Math.abs( _y.y ) > 0.95 ? _x.set( 1, 0, 0 ) : _up );
			_z.copy( _w ).addScaledVector( _y, - _y.dot( _w ) ).normalize();
			_x.crossVectors( _y, _z ).normalize();
			M = this.gunMesh.matrix.makeBasis( _x, _y, _z ).setPosition( _h.copy( L.p ).addScaledVector( _y, - this.gunM ) );

		} else M = this.gunMesh.matrix.multiplyMatrices( cam.matrixWorld, _m );
		this.gunMesh.matrixWorldNeedsUpdate = true;
		const show = this.loose ? true : visible && ( this.equipped || p.elev > GUN_POSES.stowed.elev + 0.1 );
		this.gunMesh.visible = show;
		for ( let b = 0; b < 2; b ++ ) {

			const has = this.gear && b < this.gear.bands;
			const loaded = b < this.bandsLoaded;
			const B = this.bandMeshes[ b ];
			B.loaded.matrix.copy( M );
			B.slack.matrix.copy( M );
			B.loaded.matrixWorldNeedsUpdate = B.slack.matrixWorldNeedsUpdate = true;
			B.loaded.visible = show && has && loaded;
			B.slack.visible = show && has && ! loaded;

		}

		this.gunToWorld( 0, this.gunM, RAIL_Z, this.muzzle );
		this.gunToWorld( 0, this.gunM - 0.01, - 0.03, this.lineClip );
		this.forward.set( 0, 1, 0 ).transformDirection( M );
		this.gunToWorld( 0, 0.02, - 0.01, this.butt );

		// the float and its line to the gun's butt
		const F = this.float;
		this.floatMesh.visible = !! F;
		this.floatLine.visible = !! F;
		if ( F ) {

			// lying along the line's pull, bobbing a little
			_v.copy( this.butt ).sub( F.p ).setY( 0 );
			const yaw = _v.lengthSq() > 1e-6 ? Math.atan2( _v.x, _v.z ) : 0;
			this.floatMesh.matrix.makeRotationY( yaw ).setPosition( F.p.x, F.p.y + 0.02 + Math.sin( this.t * 1.7 ) * 0.015, F.p.z );
			this.floatMesh.matrixWorldNeedsUpdate = true;
			const lm = this.floatLineMat.uniforms;
			lm.lineA.value.copy( F.p );
			lm.lineB.value.copy( this.butt );
			const len = F.p.distanceTo( this.butt );
			lm.lineCtl.value.copy( F.p ).lerp( this.butt, 0.5 );
			lm.lineCtl.value.y -= Math.max( 0, ( F.slack || 0 ) ) * len * 0.25;
			lm.lineShow.value = 1;

		}

		// the shaft: in the rail, or out on its own
		const S = this.shaftMesh;
		if ( this.shaftHome ) {

			S.matrix.copy( M ).multiply( _m.makeTranslation( 0, this.shaftHomeY, RAIL_Z ) );
			S.visible = show;

		} else {

			_y.copy( this.shaftDir ).normalize();
			_z.copy( Math.abs( _y.y ) > 0.95 ? _w.set( 1, 0, 0 ) : _up ).addScaledVector( _y, - _y.dot( Math.abs( _y.y ) > 0.95 ? _w : _up ) ).normalize();
			_x.crossVectors( _y, _z ).normalize();
			S.matrix.makeBasis( _x, _y, _z ).setPosition( this.shaftPos );
			S.visible = visible;

		}

		S.matrixWorldNeedsUpdate = true;

		// the shooting line, from the muzzle's clip to the shaft's tail (out only)
		const out = ! this.shaftHome;
		this.lineMesh.visible = visible && out;
		if ( out ) {

			const lm = this.lineMat.uniforms;
			lm.lineA.value.copy( this.lineClip );
			lm.lineB.value.copy( this.shaftPos );
			const len = this.lineClip.distanceTo( this.shaftPos );
			// mono is nearly neutral in water: a loose line drifts in a lazy belly, a taut one is straight
			lm.lineCtl.value.copy( this.lineClip ).lerp( this.shaftPos, 0.5 );
			lm.lineCtl.value.y -= len * 0.12 * this.lineSlack;
			lm.lineCtl.value.x += Math.sin( this.t * 0.7 ) * len * 0.05 * this.lineSlack;
			lm.lineShow.value = 1;

		}

	}

	// the shaft's tip (world), when out
	tip( out ) {

		return out.copy( this.shaftPos ).addScaledVector( this.shaftDir, this.shaftL );

	}

}

// ---- geometry

const WOODS = {
	wood: { color: 0x7a5432, rough: 0.55, metal: 0, pattern: PAT.wood }, // varnished mahogany
	teak: { color: 0x5c3b20, rough: 0.4, metal: 0, pattern: PAT.wood },
	carbon: { color: 0x15181c, rough: 0.35, metal: 0.15, pattern: PAT.carbon },
};
const POLY = { color: 0x16171a, rough: 0.6, metal: 0, pattern: PAT.plain }; // glass-filled nylon
const RUBBER = { color: 0x101012, rough: 0.85, metal: 0, pattern: PAT.rubber };
const STAINLESS = { color: 0xb9bec2, rough: 0.2, metal: 1, pattern: PAT.machined };
const MONO = { color: 0xc8ccc8, rough: 0.3, metal: 0 };
const DYNEEMA = { color: 0xd8d4c4, rough: 0.8, metal: 0, pattern: PAT.braid };
const LATEX = { color: 0xb86a1c, rough: 0.45, metal: 0, pattern: PAT.rubber }; // amber latex
const LATEX_BLACK = { color: 0x1a1a1c, rough: 0.5, metal: 0, pattern: PAT.rubber };

export function buildGunGeometry( L, kind ) {

	const parts = [];
	const M = ( x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx ) => mat4( x, y, z, rx, ry, rz, sx, sy, sz );
	const add = ( g, o ) => parts.push( prepare( g, o ) );
	const V = ( x, y, z ) => new Vector3( x, y, z );
	const W = WOODS[ kind ] || WOODS.teak;
	const tubeGun = kind === 'carbon';

	// barrel: a wooden beam (railgun) or a round carbon tube with a rail on top
	const b0 = 0.035, b1 = L - 0.065;
	if ( tubeGun ) {

		add( cylinder( 0.0145, 0.0145, b1 - b0, 28 ), { ...W, matrix: M( 0, ( b0 + b1 ) / 2, 0 ) } );
		add( roundedBox( 0.013, b1 - b0, 0.012, 0.004, 2 ), { ...POLY, matrix: M( 0, ( b0 + b1 ) / 2, 0.016 ) } );

	} else {

		add( roundedBox( 0.032, b1 - b0, 0.044, 0.008, 3 ), { ...W, matrix: M( 0, ( b0 + b1 ) / 2, 0 ) } );
		// the rail's groove: a darker strip the shaft lies in
		add( roundedBox( 0.008, b1 - b0 - 0.01, 0.003, 0.0012, 1 ), { ...W, color: 0x24170c, matrix: M( 0, ( b0 + b1 ) / 2, 0.0215 ) } );

	}

	// muzzle: an open polymer block, a slot over the shaft, a hole each side for the bands
	const my = L - 0.04;
	add( roundedBox( 0.05, 0.05, 0.034, 0.008, 3 ), { ...POLY, matrix: M( 0, my, 0.004 ) } );
	for ( const sx of [ - 1, 1 ] ) {

		add( roundedBox( 0.008, 0.05, 0.034, 0.003, 2 ), { ...POLY, matrix: M( sx * 0.012, my + 0.02, RAIL_Z + 0.006 ) } ); // the shaft guide's cheeks
		add( cylinder( 0.0105, 0.0105, 0.006, 16 ), { ...RUBBER, matrix: M( sx * 0.0255, my, 0.0, 0, 0, Math.PI / 2 ) } ); // band hole bushings

	}

	add( roundedBox( 0.012, 0.016, 0.01, 0.003, 1 ), { ...POLY, matrix: M( 0, L - 0.012, - 0.025 ) } ); // line clip under the muzzle

	// butt and handle: rubber pad, the trigger mechanism housing, a raked pistol grip with finger grooves
	add( roundedBox( 0.036, 0.04, 0.05, 0.012, 3 ), { ...RUBBER, matrix: M( 0, 0.02, 0 ) } );
	add( roundedBox( 0.032, 0.12, 0.03, 0.006, 2 ), { ...POLY, matrix: M( 0, 0.12, - 0.03 ) } );
	{

		const pts = [];
		for ( let i = 0; i <= 8; i ++ ) {

			const t = i / 8;
			pts.push( V( 0, 0.15 - t * 0.035, - 0.04 - t * 0.1 ) );

		}

		add( tube( pts, 0.016, 16, 12 ), { ...POLY, matrix: M( 0, 0, 0, 0, 0, 0, 1.0, 1, 1 ) } );
		// finger grooves on the front of the grip
		for ( let i = 0; i < 3; i ++ ) add( sphere( 0.0085, 10, 6 ), { ...POLY, matrix: M( 0, 0.163 - i * 0.012, - 0.065 - i * 0.026, 0, 0, 0, 1.6, 0.8, 0.8 ) } );
		add( roundedBox( 0.03, 0.03, 0.012, 0.004, 2 ), { ...POLY, matrix: M( 0, 0.112, - 0.145 ) } ); // grip foot

	}

	// trigger guard (a loop under the barrel) and the trigger
	{

		const pts = [];
		for ( let i = 0; i <= 12; i ++ ) {

			const a = Math.PI * i / 12;
			pts.push( V( 0, 0.2 + 0.04 * Math.cos( a ), - 0.045 - 0.032 * Math.sin( a ) ) );

		}

		add( tube( pts, 0.004, 24, 6 ), POLY );
		add( roundedBox( 0.006, 0.01, 0.026, 0.002, 1 ), { ...STAINLESS, matrix: M( 0, 0.186, - 0.058, - 0.35, 0, 0 ) } );

	}

	// line release: a stainless lever on top behind the shaft
	add( roundedBox( 0.008, 0.03, 0.006, 0.002, 1 ), { ...STAINLESS, matrix: M( 0.012, 0.09, 0.022, 0.2, 0, 0 ) } );
	add( cylinder( 0.004, 0.004, 0.01, 8 ), { ...STAINLESS, matrix: M( 0.012, 0.075, 0.02, 0, 0, Math.PI / 2 ) } );

	// line pegs under the barrel and the mono wrapped between the muzzle and the release
	const pegs = [ 0.3, L * 0.62 ];
	for ( const y of pegs ) add( cylinder( 0.004, 0.005, 0.016, 8 ), { ...STAINLESS, matrix: M( 0, y, - 0.028 ) } );
	const below = tubeGun ? - 0.018 : - 0.026;
	const wrap = [ [ 0.09, 0.024, 0.012 ], [ 0.09, below - 0.008, 0.012 ], [ pegs[ 0 ], below - 0.012, 0.004 ], [ pegs[ 1 ], below - 0.012, - 0.004 ], [ L - 0.012, - 0.03, 0 ] ];
	for ( let i = 0; i < wrap.length - 1; i ++ ) add( rod( V( wrap[ i ][ 2 ], wrap[ i ][ 0 ], wrap[ i ][ 1 ] ), V( wrap[ i + 1 ][ 2 ], wrap[ i + 1 ][ 0 ], wrap[ i + 1 ][ 1 ] ), 0.0008, 3 ), MONO );
	add( rod( V( 0.003, L - 0.012, - 0.03 ), V( 0.003, pegs[ 1 ], below - 0.012 ), 0.0008, 3 ), MONO );

	return mergePrepared( parts );

}

// band k: 0 front, 1 rear. loaded: stretched back to the shaft's fins; else hanging off the muzzle
export function buildBandGeometry( L, k, loaded, kind ) {

	const parts = [];
	const V = ( x, y, z ) => new Vector3( x, y, z );
	const my = L - 0.04;
	const R = loaded ? 0.0052 : 0.0078; // a 16 mm band thins as it stretches
	const LAT = k === 1 && kind === 'carbon' ? LATEX_BLACK : LATEX;
	const notch = finY( L, k );
	for ( const sx of [ - 1, 1 ] ) {

		if ( loaded ) {

			// out of the hole, along the side of the barrel, up onto the shaft at the fin
			const pts = [ V( sx * 0.0255, my, 0 ), V( sx * 0.026, my - 0.08, 0.008 ), V( sx * 0.019, ( my + notch ) / 2, 0.02 ), V( sx * 0.012, notch + 0.03, RAIL_Z + 0.004 ), V( sx * 0.007, notch + 0.008, RAIL_Z + 0.008 ) ];
			parts.push( prepare( tube( pts, R, 40, 8 ), LAT ) );

		} else {

			// slack: a short loop hanging forward and down from the muzzle
			const pts = [ V( sx * 0.0255, my, 0 ), V( sx * 0.032, my + 0.04, - 0.035 ), V( sx * 0.026, my + 0.08, - 0.11 ), V( sx * 0.012, my + 0.1, - 0.16 ) ];
			parts.push( prepare( tube( pts, R, 24, 8 ), LAT ) );

		}

	}

	// the wishbone: dyneema across the top of the shaft at the fin, or hanging at the bottom of the loop
	if ( loaded ) parts.push( prepare( tube( [ V( - 0.007, notch + 0.008, RAIL_Z + 0.008 ), V( 0, notch + 0.006, RAIL_Z + 0.0075 ), V( 0.007, notch + 0.008, RAIL_Z + 0.008 ) ], 0.0016, 8, 5 ), DYNEEMA ) );
	else parts.push( prepare( tube( [ V( - 0.012, my + 0.1, - 0.16 ), V( 0, my + 0.103, - 0.172 ), V( 0.012, my + 0.1, - 0.16 ) ], 0.0016, 8, 5 ), DYNEEMA ) );
	return mergePrepared( parts );

}

export function buildShaftGeometry( gunM ) {

	const SL = gunM + SHAFT_EXTRA - SHAFT_TAIL;

	const parts = [];
	const add = ( g, o ) => parts.push( prepare( g, o ) );
	const R = 0.0032;
	// the rod, a tri-cut point
	add( cylinder( R, R, SL - 0.03, 10 ), { ...STAINLESS, matrix: mat4( 0, ( SL - 0.03 ) / 2, 0 ) } );
	add( lathe( [ [ R, SL - 0.03 ], [ R * 0.75, SL - 0.012 ], [ 0.0002, SL ] ], 3 ), STAINLESS );
	// flopper: a thin blade hinged behind the point, lying along the top of the shaft
	add( roundedBox( 0.0032, 0.085, 0.0016, 0.0006, 1 ), { ...STAINLESS, matrix: mat4( 0, SL - 0.085, R + 0.0009, 0.04, 0, 0 ) } );
	add( cylinder( 0.0012, 0.0012, 0.008, 6 ), { ...STAINLESS, matrix: mat4( 0, SL - 0.127, R + 0.0004, 0, 0, Math.PI / 2 ) } );
	// shark fins at the back, the wishbones hook onto them
	for ( const y of [ finY( gunM, 0 ) - SHAFT_TAIL, finY( gunM, 1 ) - SHAFT_TAIL ] ) add( roundedBox( 0.0016, 0.022, 0.006, 0.0006, 1 ), { ...STAINLESS, matrix: mat4( 0, y + 0.004, R + 0.002, - 0.35, 0, 0 ) } );
	// tail: the line hole and a crimped loop of mono
	add( cylinder( R * 1.1, R, 0.012, 10 ), { ...STAINLESS, matrix: mat4( 0, 0.006, 0 ) } );
	add( rod( new Vector3( 0, 0.004, 0 ), new Vector3( 0, - 0.012, - 0.004 ), 0.0009, 4 ), MONO );
	return mergePrepared( parts );

}

// a torpedo float: 60 cm of orange foam with a reflective band, the line's ring at the front; it lies
// along local +Z
function buildFloatGeometry() {

	const parts = [];
	const ORANGE = { color: 0xff5a0a, rough: 0.55, metal: 0, pattern: PAT.plain };
	const WHITE = { color: 0xe8e8e2, rough: 0.35, metal: 0, pattern: PAT.plain };
	const prof = [];
	for ( let i = 0; i <= 16; i ++ ) {

		const t = i / 16;
		prof.push( [ 0.085 * Math.sin( Math.PI * Math.pow( t, 0.8 ) ) + 0.002, t * 0.6 - 0.3 ] );

	}

	parts.push( prepare( lathe( prof, 18 ), { ...ORANGE, matrix: mat4( 0, 0, 0, Math.PI / 2, 0, 0 ) } ) );
	parts.push( prepare( cylinder( 0.087, 0.087, 0.05, 18 ), { ...WHITE, matrix: mat4( 0, 0, 0.04, Math.PI / 2, 0, 0 ) } ) );
	parts.push( prepare( sphere( 0.012, 8, 6 ), { ...STAINLESS, matrix: mat4( 0, 0, 0.305 ) } ) );
	return mergePrepared( parts );

}

// the ribbon the line material lays along its curve: ( t along the line, side )
function buildLineGeometry( n ) {

	const pos = new Float32Array( ( n + 1 ) * 2 * 3 );
	const line = new Float32Array( ( n + 1 ) * 2 * 2 );
	const idx = [];
	for ( let i = 0; i <= n; i ++ ) {

		for ( let s = 0; s < 2; s ++ ) {

			const j = i * 2 + s;
			line[ j * 2 ] = i / n;
			line[ j * 2 + 1 ] = s ? 1 : - 1;

		}

		if ( i < n ) {

			const a = i * 2;
			idx.push( a, a + 1, a + 2, a + 1, a + 3, a + 2 );

		}

	}

	const g = new BufferGeometry();
	g.setAttribute( 'position', new Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'aLine', new Float32BufferAttribute( line, 2 ) );
	g.setIndex( idx );
	return g;

}

