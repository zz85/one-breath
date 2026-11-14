import { Group, Mesh, Vector3, Color, MathUtils } from '../engine/index.js';
import { prepare, mergePrepared, cylinder, sphere, roundedBox, box, rod, mat4 } from '../world/boat/GeoKit.js';
import { PAT } from './GameMaterials.js';

// A freediver: a jointed figure in a wetsuit, hood, mask, snorkel and long fins, posed in code
// from a few numbers (the same ones the dive room sends, net/Pose.js), so your own body, the
// other divers and later a dive buddy all share it.
//
//   const d = new Diver( { material, hue } );  scene.add( d.group )
//   d.setPose( { mode, floating, pitch, speed, blackout, gun, sprint } )   // what the diver is doing
//   d.update( dt )                                                       // ease the joints, kick
//   d.place( yaw, position )                     // feet (walking) or the float point (swimming) here
//   d.placeEye( yaw, eyeWorld )                  // or: the eyes exactly here (the local player)
//
// Figure frame: faces +Z, feet at the origin, ~1.75 m tall. `tilt` lies it along the view:
// its +Y (feet to head) points along the swim direction, so its face (+Z) looks at the seabed and
// the neck bends back to look ahead, the way a freediver swims. Each limb is two rods on pivots
// (shoulder / elbow, hip / knee) and the fin blades flex at the ankle a beat behind the kick.
//
// Poses (continuous, eased, so a change of mode or of what the player does blends over ~0.3 s):
//   standing   on land / on deck: upright, arms down
//   surface    floating still: hanging legs down, head out, arms out a little (a breathe-up)
//   swimming   lying along the view, arms along the thighs, kicking with the speed
//   streamline arms overhead, hands together: sprinting down (a duck dive / freefall)
//   gun        arms forward (holding the speargun; the gun itself is the SpearGun's)
//   blackout   limp: arms hanging, head dropped, body drifting flat

const PIVOT = 1.45; // swimming, the body hangs from the float point here (the chest)
const EYE = new Vector3( 0, 1.66, 0.09 ); // the eyes, in the figure frame (head upright)
const HEAD_Y = 1.63;
const NECK_Y = 1.50;
const SHOULDER = { x: 0.2, y: 1.45 };
const UPPER_ARM = 0.3, FOREARM = 0.27;
const HIP = { x: 0.1, y: 0.9 };
const THIGH = 0.44, SHIN = 0.42;
const SUIT = { color: 0x16191c, rough: 0.55, pattern: PAT.rubber };
const SKIN = { color: 0x9a6a4a, rough: 0.55, pattern: PAT.skin };
const BLACK = { color: 0x0b0d0e, rough: 0.5, pattern: PAT.rubber };
const _c = new Color();
const _v = new Vector3();
const _v2 = new Vector3();
const V = ( x, y, z ) => new Vector3( x, y, z );
const ease = ( a, b, dt, rate ) => a + ( b - a ) * ( 1 - Math.exp( - dt * rate ) );
const clamp = MathUtils.clamp;

export class Diver {

	constructor( { material = null, hue = 0.55 } = {} ) {

		this.material = material;
		this.hue = hue;
		const accent = _c.setHSL( hue, 0.75, 0.5 ).getHex();
		this.group = new Group();
		this.group.name = 'Diver';
		this.tilt = new Group();
		this.body = new Group();
		this.group.add( this.tilt );
		this.tilt.add( this.body );
		this.geos = [];
		const mesh = ( geo, name ) => {

			this.geos.push( geo );
			const m = new Mesh( geo, material );
			m.name = name;
			m.castShadow = true;
			return m;

		};

		// torso: hips, chest with the suit's stripes, weight belt
		this.torso = mesh( buildTorso( accent ), 'DiverTorso' );
		this.body.add( this.torso );
		// head on the neck: hood, face, mask, snorkel (hidden in first person)
		this.neck = new Group();
		this.neck.position.set( 0, NECK_Y, 0.01 );
		this.head = mesh( buildHead( accent ), 'DiverHead' );
		this.neck.add( this.head );
		this.body.add( this.neck );
		// arms: shoulder -> upper arm -> elbow -> forearm and hand
		this.arms = [];
		for ( const s of [ - 1, 1 ] ) {

			const shoulder = new Group();
			shoulder.position.set( s * SHOULDER.x, SHOULDER.y, 0 );
			const upper = mesh( buildUpperArm( s ), 'DiverUpperArm' );
			const elbow = new Group();
			elbow.position.set( 0, - UPPER_ARM, 0 );
			const lower = mesh( buildForearm( s ), 'DiverForearm' );
			elbow.add( lower );
			shoulder.add( upper, elbow );
			this.body.add( shoulder );
			this.arms.push( { s, shoulder, elbow, upper, lower } );

		}

		// legs: hip -> thigh -> knee -> shin and foot -> ankle -> fin
		this.legs = []; // the hip pivots (RemoteDivers' tests read their swing)
		this.fins = [];
		this.legJoints = [];
		for ( const s of [ - 1, 1 ] ) {

			const hip = new Group();
			hip.position.set( s * HIP.x, HIP.y, 0 );
			const thigh = mesh( buildThigh(), 'DiverThigh' );
			const knee = new Group();
			knee.position.set( 0, - THIGH, 0 );
			const shin = mesh( buildShin(), 'DiverShin' );
			const ankle = new Group();
			ankle.position.set( 0, - SHIN, 0.02 );
			const fin = mesh( buildFin( accent ), 'DiverFin' );
			ankle.add( fin );
			knee.add( shin, ankle );
			hip.add( thigh, knee );
			this.body.add( hip );
			this.legs.push( hip );
			this.fins.push( fin );
			this.legJoints.push( { s, hip, knee, ankle, fin } );

		}

		// what the diver is doing (setPose) and where the joints are now (eased in update)
		this.want = { mode: 'walk', floating: true, pitch: 0, speed: 0, blackout: false, gun: false, sprint: false };
		this.lie = 0; // 0 upright (feet at the origin) .. 1 hanging from the float point
		this.elev = Math.PI / 2; // the body axis (feet to head) above horizontal, radians
		this.neckBend = 0;
		this.kickPhase = 0;
		this.kickAmp = 0;
		this.arm = { out: 0, up: 0, fwd: 0, limp: 0, bend: 0.1 }; // the arm pose, blended
		this.headVisible = true;
		this.armsVisible = true;
		this.t = Math.random() * 10;

	}

	setPose( p ) {

		Object.assign( this.want, p );

	}

	// first person: the head would sit in the lens
	showHead( on ) {

		this.headVisible = on;
		this.head.visible = on;

	}

	showArms( on ) {

		this.armsVisible = on;
		for ( const a of this.arms ) a.upper.visible = a.lower.visible = on;

	}

	update( dt ) {

		const w = this.want;
		this.t += dt;
		const swim = w.mode === 'swim';
		const blackout = !! w.blackout;
		const pitch = clamp( w.pitch || 0, - 1.5, 1.5 );
		const speed = Math.max( 0, w.speed || 0 );
		const moving = clamp( speed / 1.0, 0, 1 );

		// ---- body: how it lies in the water
		this.lie = ease( this.lie, swim ? 1 : 0, dt, 5 );
		let elev;
		if ( ! swim ) elev = Math.PI / 2;
		else if ( blackout ) elev = 0.25;
		else {

			// swimming: the body a little above the view (the neck bends back to look ahead);
			// floating still at the surface: hanging, legs down, and piking forward a little as you
			// look down at them
			const along = clamp( pitch + 0.37, - 1.45, 1.25 );
			const hang = 1.4 + 0.4 * clamp( - pitch, 0, 1.2 );
			elev = w.floating ? MathUtils.lerp( hang, along, moving ) : along;

		}

		this.elev = ease( this.elev, elev, dt, 4 );
		// the figure's +Y after the tilt points at elevation ( pi/2 - tilt )
		this.tilt.rotation.x = ( Math.PI / 2 - this.elev ) * this.lie;
		this.body.position.y = - PIVOT * this.lie;
		// the head: upright standing (looking where the view pitches a little), in the water bent
		// back to look along the view; dropped in a blackout
		let neck;
		if ( ! swim ) neck = clamp( - pitch * 0.5, - 0.5, 0.4 );
		else if ( blackout ) neck = 0.5;
		else neck = clamp( this.elev - Math.PI / 2 - pitch, - 1.25, 0.7 );
		this.neckBend = ease( this.neckBend, neck, dt, 6 );
		this.neck.rotation.x = this.neckBend;

		// ---- legs: a flutter kick with the speed through the water, feet together in a glide
		const kicking = swim && ! blackout ? clamp( speed / 1.2, 0, 1 ) : 0;
		this.kickAmp = ease( this.kickAmp, kicking, dt, 4 );
		this.kickPhase += dt * ( 4 + 3 * this.kickAmp );
		const amp = ( 0.05 + 0.33 * this.kickAmp ) * this.lie;
		const stand = 1 - this.lie;
		for ( const L of this.legJoints ) {

			const ph = this.kickPhase + ( L.s < 0 ? 0 : Math.PI );
			// the hip swings, the knee bends on the recovery (the leg coming back up), the blade
			// bends against the water a beat behind the hip
			L.hip.rotation.x = Math.sin( ph ) * amp + stand * 0.02 + ( blackout ? 0.25 : 0 ) * this.lie;
			L.knee.rotation.x = ( 0.08 + Math.max( 0, Math.sin( ph + 1.0 ) ) * 0.45 * this.kickAmp ) * this.lie + stand * 0.03;
			L.ankle.rotation.x = - Math.cos( ph ) * amp * 1.3;
			L.fin.visible = this.lie > 0.5;
			L.hip.rotation.z = L.s * 0.03;

		}

		// ---- arms
		const A = this.arm;
		let out = 0, up = 0, fwd = 0, limp = 0, bend = 0.1;
		if ( ! swim ) { out = 0.08; bend = 0.15; } else if ( blackout ) { limp = 1; bend = 0.3; } else if ( w.gun ) { fwd = 1; bend = 0.35; } else if ( w.sprint && pitch < - 0.5 && speed > 1.5 ) { up = 1; bend = 0.05; } else if ( w.floating && moving < 0.5 ) { out = 0.75 * ( 1 - moving * 2 ); bend = 0.55; }

		A.out = ease( A.out, out, dt, 4 );
		A.up = ease( A.up, up, dt, 3 );
		A.fwd = ease( A.fwd, fwd, dt, 4 );
		A.limp = ease( A.limp, limp, dt, 2 );
		A.bend = ease( A.bend, bend, dt, 4 );
		for ( const a of this.arms ) {

			const sh = a.shoulder;
			// along the sides (0), raised out sideways (out), overhead (up: through the side, the
			// hands meeting over the head), forward (fwd), hanging limp
			const breathe = Math.sin( this.t * 1.3 ) * 0.03 * A.out;
			sh.rotation.set( 0, 0, 0 );
			sh.rotation.z = a.s * ( 0.06 + A.out * 1.1 + A.up * ( Math.PI + 0.24 ) + breathe ) * ( 1 - A.fwd ) + a.s * 0.1 * A.fwd;
			sh.rotation.x = A.fwd * ( - Math.PI / 2 + 0.15 ) - A.out * 0.35 - A.limp * 0.5 + A.up * 0.1;
			a.elbow.rotation.x = - A.bend * ( 1 - A.up ) * ( 1 - A.fwd ) - A.fwd * 0.2;

		}

	}

	// stand (feet) or hang (the float point) at `pos`, facing `yaw` (the view's yaw: it looks -Z)
	place( yaw, pos ) {

		this.group.position.copy( pos );
		this.group.rotation.order = 'YXZ';
		this.group.rotation.set( 0, yaw + Math.PI, 0 );

	}

	// put the eyes exactly at `eye` (the local player: the camera), facing `yaw`
	placeEye( yaw, eye ) {

		this.place( yaw, eye );
		this.eyeWorld( _v );
		_v2.copy( eye ).sub( _v );
		this.group.position.add( _v2 );
		this.group.updateMatrixWorld( true );

	}

	// the eyes in the world
	eyeWorld( out ) {

		this.group.updateMatrixWorld( true );
		return out.copy( EYE ).sub( this.neck.position ).applyMatrix4( this.neck.matrixWorld );

	}

	// the head's centre in the world, for a name tag
	headWorld( out ) {

		this.group.updateMatrixWorld( true );
		return out.set( 0, HEAD_Y - NECK_Y, 0 ).applyMatrix4( this.neck.matrixWorld );

	}

	dispose() {

		for ( const g of this.geos ) g.dispose();

	}

}

// ---- geometry, in the figure frame (facing +Z, feet at the origin)

function buildTorso( accent ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const ACC = { color: accent, rough: 0.5 };
	// hips, waist, chest and shoulders: the suit, a coloured stripe down each side and across the chest
	add( roundedBox( 0.32, 0.2, 0.21, 0.07, 2 ), { ...SUIT, matrix: mat4( 0, 0.95, 0 ) } );
	add( roundedBox( 0.3, 0.22, 0.19, 0.07, 2 ), { ...SUIT, matrix: mat4( 0, 1.12, 0 ) } );
	add( roundedBox( 0.38, 0.34, 0.23, 0.09, 3 ), { ...SUIT, matrix: mat4( 0, 1.32, 0 ) } );
	for ( const s of [ - 1, 1 ] ) add( box( 0.012, 0.5, 0.07 ), { ...ACC, matrix: mat4( s * 0.182, 1.2, 0.01 ) } );
	add( box( 0.22, 0.045, 0.012 ), { ...ACC, matrix: mat4( 0, 1.38, 0.118 ) } );
	// weight belt with its lead weights
	add( cylinder( 0.175, 0.175, 0.04, 16, 1, true ), { ...BLACK, matrix: mat4( 0, 1.03, 0, 0, 0, 0, 1, 1, 0.68 ) } );
	for ( const [ x, z ] of [ [ - 0.12, 0.08 ], [ 0.12, 0.08 ], [ - 0.14, - 0.07 ], [ 0.14, - 0.07 ] ] ) add( roundedBox( 0.07, 0.05, 0.035, 0.01, 1 ), { color: 0x4a4e52, rough: 0.5, metal: 0.4, matrix: mat4( x, 1.03, z ) } );
	// neck (the hood)
	add( cylinder( 0.06, 0.07, 0.08, 10 ), { ...SUIT, matrix: mat4( 0, 1.51, 0.01 ) } );
	return mergePrepared( P );

}

// the head in the neck's frame (the neck pivot at NECK_Y)
function buildHead( accent ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const y = HEAD_Y - NECK_Y;
	const ACC = { color: accent, rough: 0.5 };
	add( sphere( 0.11, 14, 10 ), { ...SUIT, matrix: mat4( 0, y, 0, 0, 0, 0, 1, 1.12, 1.04 ) } );
	// the face in the hood's opening
	add( sphere( 0.085, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6 ), { ...SKIN, matrix: mat4( 0, y - 0.03, 0.05, Math.PI / 2, 0, 0, 0.9, 1, 1.1 ) } );
	// low-volume mask: skirt, two lenses, strap; the snorkel on the left
	add( roundedBox( 0.17, 0.075, 0.05, 0.02, 2 ), { ...BLACK, rough: 0.35, matrix: mat4( 0, y + 0.03, 0.105 ) } );
	for ( const s of [ - 1, 1 ] ) add( box( 0.065, 0.05, 0.008 ), { color: 0x6f8f9c, rough: 0.05, metal: 0.2, matrix: mat4( s * 0.04, y + 0.03, 0.131 ) } );
	add( cylinder( 0.116, 0.116, 0.016, 16, 1, true ), { ...ACC, matrix: mat4( 0, y + 0.03, - 0.005 ) } );
	add( rod( V( 0.11, y - 0.07, 0.06 ), V( 0.12, y + 0.21, 0.0 ), 0.012, 6 ), ACC );
	return mergePrepared( P );

}

// an upper arm hanging from the shoulder pivot (the arm points -Y)
function buildUpperArm( s ) {

	const P = [];
	P.push( prepare( sphere( 0.058, 10, 8 ), { ...SUIT, matrix: mat4( s * 0.01, - 0.01, 0 ) } ) );
	P.push( prepare( rod( V( s * 0.02, - 0.02, 0 ), V( s * 0.03, - UPPER_ARM, 0 ), 0.05, 10, 0.042 ), SUIT ) );
	return mergePrepared( P );

}

// the forearm and the bare hand from the elbow pivot
function buildForearm( s ) {

	const P = [];
	P.push( prepare( rod( V( s * 0.03, 0.02, 0 ), V( s * 0.03, - FOREARM, 0.01 ), 0.042, 10, 0.034 ), SUIT ) );
	P.push( prepare( roundedBox( 0.075, 0.16, 0.03, 0.012, 2 ), { ...SKIN, matrix: mat4( s * 0.03, - FOREARM - 0.08, 0.012, 0.1, 0, 0 ) } ) );
	return mergePrepared( P );

}

function buildThigh() {

	const P = [];
	P.push( prepare( sphere( 0.075, 10, 8 ), { ...SUIT, matrix: mat4( 0, - 0.02, 0 ) } ) );
	P.push( prepare( rod( V( 0, - 0.02, 0 ), V( 0, - THIGH, 0.0 ), 0.074, 10, 0.058 ), SUIT ) );
	return mergePrepared( P );

}

// the shin and the bare foot from the knee pivot; the fin's pocket covers the foot in the water
function buildShin() {

	const P = [];
	P.push( prepare( sphere( 0.058, 10, 8 ), { ...SUIT, matrix: mat4( 0, - 0.01, 0 ) } ) );
	P.push( prepare( rod( V( 0, - 0.01, 0 ), V( 0, - SHIN, - 0.01 ), 0.056, 10, 0.045 ), SUIT ) );
	P.push( prepare( roundedBox( 0.085, 0.06, 0.22, 0.025, 2 ), { ...SKIN, matrix: mat4( 0, - SHIN - 0.02, 0.06 ) } ) );
	return mergePrepared( P );

}

// a long freediving fin from the ankle pivot: foot pocket, then the blade carrying on along the
// leg (the toes pointed), with its side rails
function buildFin( accent ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	add( roundedBox( 0.1, 0.11, 0.25, 0.035, 2 ), { ...BLACK, rough: 0.6, matrix: mat4( 0, - 0.04, 0.05 ) } );
	add( box( 0.19, 0.78, 0.01 ), { color: accent, rough: 0.3, matrix: mat4( 0, - 0.5, 0.0, - 0.08, 0, 0 ) } );
	for ( const s of [ - 1, 1 ] ) add( box( 0.012, 0.78, 0.028 ), { ...BLACK, matrix: mat4( s * 0.096, - 0.5, 0.0, - 0.08, 0, 0 ) } );
	return mergePrepared( P );

}
