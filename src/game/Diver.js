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
//   duck dive  d.duckDive() (or setPose( { duck: seconds } ) to drive its clock): the sequence in DUCK

const PIVOT = 1.45; // swimming, the body hangs from the float point here (the chest)
const EYE = new Vector3( 0, 1.66, 0.09 ); // the eyes, in the figure frame (head upright)
const HEAD_Y = 1.63;
const NECK_Y = 1.50;
const SHOULDER = { x: 0.2, y: 1.45 };
const UPPER_ARM = 0.3, FOREARM = 0.27;
const HIP = { x: 0.1, y: 0.9 };
const THIGH = 0.44, SHIN = 0.42;
const FOOT_L = 0.24; // heel to toes
const POINT = Math.PI / 2 - 0.45; // the pointed foot: toes trailing the heel, radians past flat
const BLADE_L = 0.8, BLADE_N = 7; // the fin blade past the pocket, in slices
// The duck dive, in seconds from its start (DUCK.end is its length): a flat glide with the arms
// ahead and two gentle kicks, the jackknife (arms point down, a right angle at the hips), the legs
// lifted straight up (their weight drives the body down), one long breaststroke pull of both arms
// to the thighs, one hand to the nose to equalize, then finning.
export const DUCK = { glide: 0.7, knife: 1.4, legs: 2.1, pull: 3.0, equalize: 3.6, end: 4.0 };
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

		// legs: hip -> thigh -> knee -> shin -> ankle -> foot (bare, or in the fin's pocket) -> the blade,
		// a chain of slices that bends under the water (see Blade)
		this.legs = []; // the hip pivots (RemoteDivers' tests read their swing)
		this.fins = []; // the foot pockets: visible means fins on
		this.legJoints = [];
		for ( const s of [ - 1, 1 ] ) {

			const hip = new Group();
			hip.position.set( s * HIP.x, HIP.y, 0 );
			const thigh = mesh( buildThigh(), 'DiverThigh' );
			const knee = new Group();
			knee.position.set( 0, - THIGH, 0 );
			const shin = mesh( buildShin(), 'DiverShin' );
			const ankle = new Group();
			ankle.position.set( 0, - SHIN, - 0.01 );
			const foot = mesh( buildFoot(), 'DiverFoot' );
			const fin = mesh( buildPocket(), 'DiverFinPocket' );
			const blade = new Blade( accent, mesh );
			blade.root.position.set( 0, - 0.03, FOOT_L );
			ankle.add( foot, fin, blade.root );
			knee.add( shin, ankle );
			hip.add( thigh, knee );
			this.body.add( hip );
			this.legs.push( hip );
			this.fins.push( fin );
			this.legJoints.push( { s, hip, knee, ankle, foot, fin, blade, angle: 0, omega: 0 } );

		}

		// what the diver is doing (setPose) and where the joints are now (eased in update)
		this.want = { mode: 'walk', floating: true, pitch: 0, speed: 0, blackout: false, gun: false, sprint: false };
		this.lie = 0; // 0 upright (feet at the origin) .. 1 hanging from the float point
		this.elev = Math.PI / 2; // the body axis (feet to head) above horizontal, radians
		this.neckBend = 0;
		this.kickPhase = 0;
		this.kickAmp = 0;
		this.arm = { out: 0, up: 0, fwd: 0, limp: 0, bend: 0.1, nose: 0 }; // the arm pose, blended
		this.hinge = 0; // the jackknife: the legs' angle at the hips toward the belly, eased
		this.duck = null; // seconds into a duck dive, or null
		this._duckOwn = false; // the figure keeps the clock itself (a remote diver)
		this.headVisible = true;
		this.armsVisible = true;
		this.t = Math.random() * 10;

	}

	setPose( p ) {

		Object.assign( this.want, p );
		if ( 'duck' in p ) {

			this.duck = p.duck;
			this._duckOwn = false;

		}

	}

	// start a duck dive from the surface; the figure runs the sequence on its own clock
	duckDive() {

		this.duck = 0;
		this._duckOwn = true;

	}

	get ducking() {

		return this.duck !== null && this.duck < DUCK.end;

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

		// ---- the duck dive's clock
		if ( this.duck !== null ) {

			if ( this._duckOwn ) this.duck += dt;
			if ( this.duck >= DUCK.end || ! swim || blackout ) this.duck = null;

		}

		const D = this.duck, ducking = D !== null;
		// where the sequence stands: 0 glide, 1 jackknife, 2 legs up, 3 pull, 4 equalize, with the
		// fraction through the stage
		let stage = - 1, f = 0;
		if ( ducking ) {

			const marks = [ 0, DUCK.glide, DUCK.knife, DUCK.legs, DUCK.pull, DUCK.equalize, DUCK.end ];
			for ( let i = 1; i < marks.length; i ++ ) if ( D < marks[ i ] ) { stage = i - 1; f = ( D - marks[ i - 1 ] ) / ( marks[ i ] - marks[ i - 1 ] ); break; }

		}

		// ---- body: how it lies in the water
		this.lie = ease( this.lie, swim ? 1 : 0, dt, 5 );
		let elev;
		if ( ! swim ) elev = Math.PI / 2;
		else if ( blackout ) elev = 0.25;
		else if ( ducking ) {

			// flat on the surface; the jackknife folds the torso straight down and it stays vertical
			// until the finning starts, where the view takes over again
			if ( stage === 0 ) elev = 0.05;
			else if ( stage <= 3 ) elev = - Math.PI / 2 + 0.05;
			else elev = MathUtils.lerp( - Math.PI / 2 + 0.05, clamp( pitch + 0.37, - 1.45, 1.25 ), stage === 5 ? f : 0 );

		} else {

			// swimming: the body a little above the view (the neck bends back to look ahead);
			// floating still at the surface: hanging, legs down, and piking forward a little as you
			// look down at them
			const along = clamp( pitch + 0.37, - 1.45, 1.25 );
			const hang = 1.4 + 0.4 * clamp( - pitch, 0, 1.2 );
			elev = w.floating ? MathUtils.lerp( hang, along, moving ) : along;

		}

		this.elev = ease( this.elev, elev, dt, ducking ? 7 : 4 );
		// the figure's +Y after the tilt points at elevation ( pi/2 - tilt )
		this.tilt.rotation.x = ( Math.PI / 2 - this.elev ) * this.lie;
		this.body.position.y = - PIVOT * this.lie;
		// the head: upright standing (looking where the view pitches a little), in the water bent
		// back to look along the view; dropped in a blackout
		let neck;
		if ( ! swim ) neck = clamp( - pitch * 0.5, - 0.5, 0.4 );
		else if ( blackout ) neck = 0.5;
		else if ( ducking && stage >= 1 && stage <= 3 ) neck = 0.25; // chin tucked: the head follows the hands
		else neck = clamp( this.elev - Math.PI / 2 - pitch, - 1.25, 0.7 );
		this.neckBend = ease( this.neckBend, neck, dt, 6 );
		this.neck.rotation.x = this.neckBend;

		// ---- legs: a flutter kick with the speed through the water, feet together in a glide. The
		// hip leads, the knee gives a little on the recovery, the ankle is pointed (the toes trail
		// the heel, the blade carries on from them) and the blade bends under the water (Blade).
		let kicking = swim && ! blackout ? clamp( speed / 1.2, 0, 1 ) : 0;
		// the duck dive: two gentle kicks in the glide, then the legs are still until the blades
		// are under
		if ( ducking ) kicking = stage === 0 ? 0.45 : stage <= 3 ? 0 : kicking;
		this.kickAmp = ease( this.kickAmp, kicking, dt, ducking ? 8 : 4 );
		// the jackknife: the legs fold toward the belly (a right angle at the hips) and come back
		// in line as they lift straight up
		let hinge = 0;
		if ( ducking ) hinge = stage === 1 ? Math.PI / 2 : stage === 2 ? ( Math.PI / 2 ) * ( 1 - f ) : 0;
		this.hinge = ease( this.hinge, hinge, dt, 9 );
		this.kickPhase += dt * ( 3.2 + 3.3 * this.kickAmp );
		const amp = ( 0.04 + 0.3 * this.kickAmp ) * this.lie;
		const stand = 1 - this.lie;
		const finsOn = this.lie > 0.5;
		for ( const L of this.legJoints ) {

			const ph = this.kickPhase + ( L.s < 0 ? 0 : Math.PI );
			L.hip.rotation.x = Math.sin( ph ) * amp + stand * 0.02 + ( blackout ? 0.25 : 0 ) * this.lie - this.hinge;
			L.knee.rotation.x = ( 0.06 + Math.max( 0, Math.sin( ph + 1.2 ) ) * 0.35 * this.kickAmp ) * this.lie + stand * 0.03;
			// the pointed foot: in the water the toes trail the heel (plantar flexion ~ 65 deg); on
			// land the foot is flat
			L.ankle.rotation.x = MathUtils.lerp( 0, POINT, this.lie ) + Math.sin( ph - 0.6 ) * 0.08 * this.kickAmp * this.lie;
			L.hip.rotation.z = L.s * 0.03;
			L.foot.visible = ! finsOn;
			L.fin.visible = finsOn;
			// the blade: how fast the foot sweeps through the water
			const angle = L.hip.rotation.x + L.knee.rotation.x + L.ankle.rotation.x;
			const omega = dt > 0 ? ( angle - L.angle ) / dt : 0;
			L.angle = angle;
			L.omega = ease( L.omega, omega, dt, 30 );
			L.blade.update( dt, finsOn ? L.omega : 0, finsOn );

		}

		// ---- arms
		const A = this.arm;
		let out = 0, up = 0, fwd = 0, limp = 0, bend = 0.1, nose = 0;
		if ( ! swim ) { out = 0.08; bend = 0.15; } else if ( blackout ) { limp = 1; bend = 0.3; } else if ( ducking ) {

			// arms straight ahead through the glide and the jackknife (pointing down once the torso
			// is), one breaststroke pull out and down to the thighs, then a hand to the nose
			if ( stage <= 2 ) { up = 1; bend = 0.02; } else if ( stage === 3 ) { up = 1 - f; out = Math.sin( f * Math.PI ) * 0.9; bend = 0.05; } else { nose = stage === 4 ? 1 : 1 - f; bend = 0.15; }

		} else if ( w.gun ) { fwd = 1; bend = 0.35; } else if ( w.sprint && pitch < - 0.5 && speed > 1.5 ) { up = 1; bend = 0.05; } else if ( w.floating && moving < 0.5 ) { out = 0.38 * ( 1 - moving * 2 ); bend = 0.7; }

		const ar = ducking ? 8 : 4;
		A.out = ease( A.out, out, dt, ar );
		A.up = ease( A.up, up, dt, ducking ? 8 : 3 );
		A.fwd = ease( A.fwd, fwd, dt, ar );
		A.limp = ease( A.limp, limp, dt, 2 );
		A.bend = ease( A.bend, bend, dt, ar );
		A.nose = ease( A.nose, nose, dt, 8 );
		for ( const a of this.arms ) {

			const sh = a.shoulder;
			// along the sides (0), raised out sideways (out), overhead (up: through the side, the
			// hands meeting over the head), forward (fwd), hanging limp
			const breathe = Math.sin( this.t * 1.3 ) * 0.03 * A.out;
			sh.rotation.set( 0, 0, 0 );
			sh.rotation.z = a.s * ( 0.06 + A.out * 1.1 + A.up * ( Math.PI + 0.24 ) + breathe ) * ( 1 - A.fwd ) + a.s * 0.1 * A.fwd;
			sh.rotation.x = A.fwd * ( - Math.PI / 2 + 0.15 ) - A.out * 0.35 - A.limp * 0.5 + A.up * 0.1;
			a.elbow.rotation.x = - A.bend * ( 1 - A.up ) * ( 1 - A.fwd ) - A.fwd * 0.2;
			// the right hand to the nose: the upper arm forward and up, the elbow folded
			if ( a.s > 0 && A.nose > 0.001 ) {

				sh.rotation.x = MathUtils.lerp( sh.rotation.x, - 2.3, A.nose );
				sh.rotation.z = MathUtils.lerp( sh.rotation.z, 0.35, A.nose );
				a.elbow.rotation.x = MathUtils.lerp( a.elbow.rotation.x, - 2.45, A.nose );

			}

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

// ---- the fin blade: a chain of slices from the toes, bent by the water
//
// Freediving blades are long and soft: the foot sweeps, the blade lags and bends against the water,
// then whips straight as the foot slows and the tip trails a beat behind. Each slice hangs on the
// one before as a damped hinge (stiffness falls toward the tip) and the foot's angular speed loads
// the hinges as water drag: the root bends first, and the bend travels out along the blade.
class Blade {

	constructor( accent, mesh ) {

		this.root = new Group();
		this.joints = [];
		this.angle = new Float32Array( BLADE_N );
		this.vel = new Float32Array( BLADE_N );
		const dz = BLADE_L / BLADE_N;
		let parent = this.root;
		for ( let i = 0; i < BLADE_N; i ++ ) {

			const j = new Group();
			if ( i > 0 ) j.position.set( 0, 0, dz );
			const t0 = i / BLADE_N, t1 = ( i + 1 ) / BLADE_N;
			j.add( mesh( buildBladeSlice( accent, dz, t0, t1 ), 'DiverBlade' ) );
			parent.add( j );
			this.joints.push( j );
			parent = j;

		}

	}

	// omega: the foot's angular speed about the ankle's axis (rad/s); `on` false lets it hang straight
	update( dt, omega, on ) {

		const A = this.angle, Vv = this.vel;
		const h = Math.min( dt, 1 / 30 );
		for ( let i = 0; i < BLADE_N; i ++ ) {

			const t = ( i + 0.5 ) / BLADE_N;
			// stiffness and damping fall along the blade; the water's load on each hinge is the
			// sweep speed of the blade past it (the root's omega, lagging further out)
			const k = 420 * ( 1 - 0.6 * t ), c = 1.1 * Math.sqrt( k );
			const load = on ? - omega * 0.035 * ( 1.0 - 0.5 * t ) : 0;
			Vv[ i ] += ( - k * A[ i ] + k * load - c * Vv[ i ] ) * h;
			A[ i ] += Vv[ i ] * h;
			A[ i ] = clamp( A[ i ], - 0.42, 0.42 );
			this.joints[ i ].rotation.x = A[ i ];

		}

	}

	// the whole blade's bend: the tip's angle from the root's line, radians
	get bend() {

		let a = 0;
		for ( let i = 0; i < BLADE_N; i ++ ) a += this.angle[ i ];
		return a;

	}

}

// ---- geometry, in the figure frame (facing +Z, feet at the origin)

function buildTorso( accent ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const ACC = { color: accent, rough: 0.5 };
	// a lean swimmer's torso: hips, waist, chest, shoulders in one smooth suit; a stripe down each side
	add( roundedBox( 0.3, 0.18, 0.19, 0.075, 2 ), { ...SUIT, matrix: mat4( 0, 0.95, 0 ) } );
	add( roundedBox( 0.26, 0.2, 0.165, 0.07, 2 ), { ...SUIT, matrix: mat4( 0, 1.12, 0 ) } );
	add( roundedBox( 0.33, 0.3, 0.19, 0.085, 3 ), { ...SUIT, matrix: mat4( 0, 1.32, 0 ) } );
	for ( const s of [ - 1, 1 ] ) add( box( 0.01, 0.52, 0.05 ), { ...ACC, matrix: mat4( s * 0.155, 1.2, 0.01 ) } );
	// a thin rubber weight belt, two small weights at the hips
	add( cylinder( 0.15, 0.15, 0.028, 16, 1, true ), { ...BLACK, matrix: mat4( 0, 1.02, 0, 0, 0, 0, 1, 1, 0.62 ) } );
	for ( const s of [ - 1, 1 ] ) add( roundedBox( 0.05, 0.035, 0.03, 0.008, 1 ), { color: 0x4a4e52, rough: 0.5, metal: 0.4, matrix: mat4( s * 0.13, 1.02, 0.03 ) } );
	// neck (the hood)
	add( cylinder( 0.052, 0.062, 0.08, 10 ), { ...SUIT, matrix: mat4( 0, 1.51, 0.01 ) } );
	return mergePrepared( P );

}

// the head in the neck's frame (the neck pivot at NECK_Y)
function buildHead( accent ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const y = HEAD_Y - NECK_Y;
	const ACC = { color: accent, rough: 0.5 };
	add( sphere( 0.098, 14, 10 ), { ...SUIT, matrix: mat4( 0, y, 0, 0, 0, 0, 1, 1.12, 1.04 ) } );
	// the face in the hood's opening
	add( sphere( 0.078, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.6 ), { ...SKIN, matrix: mat4( 0, y - 0.03, 0.04, Math.PI / 2, 0, 0, 0.9, 1, 1.1 ) } );
	// low-volume mask: a slim skirt, two lenses, strap; the snorkel on the left
	add( roundedBox( 0.15, 0.06, 0.035, 0.015, 2 ), { ...BLACK, rough: 0.35, matrix: mat4( 0, y + 0.03, 0.095 ) } );
	for ( const s of [ - 1, 1 ] ) add( box( 0.058, 0.042, 0.006 ), { color: 0x6f8f9c, rough: 0.05, metal: 0.2, matrix: mat4( s * 0.036, y + 0.03, 0.114 ) } );
	add( cylinder( 0.104, 0.104, 0.014, 16, 1, true ), { ...ACC, matrix: mat4( 0, y + 0.03, - 0.005 ) } );
	add( rod( V( 0.1, y - 0.07, 0.05 ), V( 0.11, y + 0.2, 0.0 ), 0.01, 6 ), ACC );
	return mergePrepared( P );

}

// an upper arm hanging from the shoulder pivot (the arm points -Y)
function buildUpperArm( s ) {

	const P = [];
	P.push( prepare( sphere( 0.05, 10, 8 ), { ...SUIT, matrix: mat4( s * 0.005, - 0.01, 0 ) } ) );
	P.push( prepare( rod( V( s * 0.01, - 0.02, 0 ), V( s * 0.015, - UPPER_ARM, 0 ), 0.042, 10, 0.035 ), SUIT ) );
	return mergePrepared( P );

}

// the forearm and the bare hand from the elbow pivot
function buildForearm( s ) {

	const P = [];
	P.push( prepare( rod( V( s * 0.015, 0.02, 0 ), V( s * 0.015, - FOREARM, 0.01 ), 0.035, 10, 0.028 ), SUIT ) );
	P.push( prepare( roundedBox( 0.07, 0.17, 0.022, 0.01, 2 ), { ...SKIN, matrix: mat4( s * 0.015, - FOREARM - 0.085, 0.012, 0.1, 0, 0 ) } ) );
	return mergePrepared( P );

}

function buildThigh() {

	const P = [];
	P.push( prepare( sphere( 0.066, 10, 8 ), { ...SUIT, matrix: mat4( 0, - 0.02, 0 ) } ) );
	P.push( prepare( rod( V( 0, - 0.02, 0 ), V( 0, - THIGH, 0.0 ), 0.064, 10, 0.05 ), SUIT ) );
	return mergePrepared( P );

}

// the shin from the knee pivot (the foot is its own part, on the ankle)
function buildShin() {

	const P = [];
	P.push( prepare( sphere( 0.05, 10, 8 ), { ...SUIT, matrix: mat4( 0, - 0.01, 0 ) } ) );
	P.push( prepare( rod( V( 0, - 0.01, 0 ), V( 0, - SHIN, - 0.01 ), 0.048, 10, 0.038 ), SUIT ) );
	return mergePrepared( P );

}

// the bare foot from the ankle pivot: heel at the pivot, toes toward +Z (on land)
function buildFoot() {

	return mergePrepared( [ prepare( roundedBox( 0.08, 0.055, FOOT_L, 0.022, 2 ), { ...SKIN, matrix: mat4( 0, - 0.03, FOOT_L / 2 - 0.03 ) } ) ] );

}

// the fin's foot pocket over the foot: rubber, open at the heel, the blade's root at the toes
function buildPocket() {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	add( roundedBox( 0.095, 0.075, FOOT_L + 0.02, 0.03, 2 ), { ...BLACK, rough: 0.6, matrix: mat4( 0, - 0.03, FOOT_L / 2 - 0.02 ) } );
	// the heel strap
	add( cylinder( 0.045, 0.045, 0.03, 10, 1, true ), { ...BLACK, matrix: mat4( 0, - 0.035, - 0.02, Math.PI / 2, 0, 0, 1, 1, 0.9 ) } );
	return mergePrepared( P );

}

// one slice of the blade, from its hinge (z 0) to the next (z dz): the blade tapers a little to
// the tip, its side rails taper more
function buildBladeSlice( accent, dz, t0, t1 ) {

	const P = [];
	const add = ( g, o ) => P.push( prepare( g, o ) );
	const w = ( t ) => 0.19 - 0.025 * t;
	const w0 = w( t0 ), w1 = w( t1 );
	add( box( ( w0 + w1 ) / 2, 0.006, dz + 0.004 ), { color: accent, rough: 0.3, matrix: mat4( 0, 0, dz / 2 ) } );
	const r = 0.028 * ( 1 - 0.7 * t0 ) + 0.004;
	for ( const s of [ - 1, 1 ] ) add( box( 0.01, r, dz + 0.004 ), { ...BLACK, matrix: mat4( s * ( w0 + w1 ) / 4 - s * 0.002, 0, dz / 2 ) } );
	return mergePrepared( P );

}
