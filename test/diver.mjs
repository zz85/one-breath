// The freediver figure (game/Diver.js), your own body in the water (game/PlayerDiver.js) and
// the chase camera while swimming (player/Player.js): posed on the CPU, no GPU.
//   node test/diver.mjs
import * as E from '../src/engine/index.js';
import { Diver, DUCK } from '../src/game/Diver.js';
import { PlayerDiver } from '../src/game/PlayerDiver.js';
import { Player } from '../src/player/Player.js';
import { TerrainData } from '../src/world/TerrainData.js';

let fails = 0;
const check = ( ok, msg ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + msg );
	if ( ! ok ) fails ++;

};
const near = ( a, b, e = 1e-3 ) => Math.abs( a - b ) < e;
const dt = 1 / 60;
const run = ( d, sec ) => { for ( let t = 0; t < sec; t += dt ) d.update( dt ); };

// ---- the figure on its own
const d = new Diver( { material: null, hue: 0.3 } );
check( d.group.children.length === 1 && d.fins.length === 2 && d.legs.length === 2 && d.arms.length === 2, 'a figure: two arms, two legs, two fins' );

// standing on land, facing where yaw 0 looks (-z): the head 1.63 m over the feet, eyes a touch ahead
d.setPose( { mode: 'walk', floating: false, pitch: 0, speed: 0 } );
run( d, 2 );
d.place( 0, new E.Vector3( 0, 0, 0 ) );
const head = d.headWorld( new E.Vector3() );
const eye = d.eyeWorld( new E.Vector3() );
check( near( head.y, 1.63, 0.02 ) && near( head.x, 0, 0.01 ), `standing: head ${ head.y.toFixed( 2 ) } m up` );
check( eye.y > head.y && eye.z < - 0.05, `standing: eyes in the face, looking -z (z ${ eye.z.toFixed( 2 ) })` );
check( ! d.fins[ 0 ].visible && d.legJoints[ 0 ].foot.visible && Math.abs( d.legs[ 0 ].rotation.x ) < 0.05 && Math.abs( d.legJoints[ 0 ].ankle.rotation.x ) < 0.05, 'standing: bare feet flat, no fins, legs still' );

// swimming level at 1.5 m/s: lying along the view, kicking, the fins flexing a beat behind the hips
d.setPose( { mode: 'swim', floating: false, pitch: 0, speed: 1.5 } );
run( d, 3 );
check( d.fins[ 0 ].visible, 'swimming: fins on' );
check( near( d.elev, 0.37, 0.03 ), `swimming level: the body lies ${ ( d.elev * 180 / Math.PI ).toFixed( 0 ) } deg above the view, the neck bent back ${ ( - d.neckBend * 180 / Math.PI ).toFixed( 0 ) } deg` );
let maxSwing = 0, opposite = true, maxBend = 0, bendAtTurn = 0, bendMid = 0, rootFirst = true;
for ( let t = 0; t < 2; t += dt ) {

	d.update( dt );
	maxSwing = Math.max( maxSwing, Math.abs( d.legs[ 0 ].rotation.x ) );

}

for ( let t = 0; t < 2; t += dt ) {

	d.update( dt );
	const a = d.legs[ 0 ].rotation.x, b = d.legs[ 1 ].rotation.x;
	if ( Math.abs( a ) > 0.1 && Math.sign( a ) === Math.sign( b ) ) opposite = false;
	const B = d.legJoints[ 0 ].blade;
	maxBend = Math.max( maxBend, Math.abs( B.bend ) );
	// the blade bends most mid-sweep (the foot moving fastest) and straightens at the turn
	if ( Math.abs( a ) > maxSwing * 0.97 ) bendAtTurn = Math.max( bendAtTurn, Math.abs( B.bend ) );
	if ( Math.abs( a ) < 0.03 ) bendMid = Math.max( bendMid, Math.abs( B.bend ) );
	if ( Math.abs( B.bend ) > 0.5 && Math.abs( B.angle[ 0 ] ) < Math.abs( B.angle[ 6 ] ) ) rootFirst = false;

}

check( maxSwing > 0.25 && maxSwing < 0.5, `kick: hips swing ${ ( maxSwing * 180 / Math.PI ).toFixed( 0 ) } deg` );
check( opposite, 'kick: the legs alternate' );
const point = d.legJoints[ 0 ].ankle.rotation.x;
check( point > 0.9 && point < 1.3, `kick: the feet are pointed, toes trailing (${ ( point * 180 / Math.PI ).toFixed( 0 ) } deg past flat)` );
check( maxBend > 0.5 && maxBend < 1.3, `kick: the blades bend up to ${ ( maxBend * 180 / Math.PI ).toFixed( 0 ) } deg tip to root` );
check( bendMid > bendAtTurn * 1.3, `kick: bent most mid-sweep (${ ( bendMid * 180 / Math.PI ).toFixed( 0 ) } deg), straighter at the turn (${ ( bendAtTurn * 180 / Math.PI ).toFixed( 0 ) } deg)` );
check( rootFirst, 'kick: the blade bends from the root, the tip follows' );
check( d.legJoints[ 0 ].blade.joints.length === 7 && d.fins[ 0 ].visible && ! d.legJoints[ 0 ].foot.visible, 'swimming: feet in the pockets, 7 blade slices' );
check( d.arm.out < 0.05 && d.arm.up < 0.05 && d.arm.fwd < 0.05, 'swimming: arms along the sides' );

// a glide: no speed, the kick dies away
d.setPose( { speed: 0 } );
run( d, 3 );
check( d.kickAmp < 0.05, `glide: the kick fades (amp ${ d.kickAmp.toFixed( 3 ) })` );
check( Math.abs( d.legJoints[ 0 ].blade.bend ) < 0.08, `glide: the blades hang straight (${ ( d.legJoints[ 0 ].blade.bend * 180 / Math.PI ).toFixed( 1 ) } deg)` );

// looking down and sprinting: head first, arms overhead in a streamline
d.setPose( { mode: 'swim', floating: false, pitch: - 1.3, speed: 2.4, sprint: true } );
run( d, 3 );
d.place( 0, new E.Vector3( 0, - 5, 0 ) );
const h2 = d.headWorld( new E.Vector3() );
const hip = new E.Vector3().setFromMatrixPosition( d.legs[ 0 ].matrixWorld );
check( hip.y - h2.y > 0.4, `diving: head first, hips ${ ( hip.y - h2.y ).toFixed( 2 ) } m above the head` );
check( d.arm.up > 0.9, `streamline: arms overhead (${ d.arm.up.toFixed( 2 ) })` );
const hand = new E.Vector3().setFromMatrixPosition( d.arms[ 0 ].elbow.matrixWorld );
check( hand.y < h2.y, `streamline: the elbows below the head, ahead of it (${ hand.y.toFixed( 2 ) } vs ${ h2.y.toFixed( 2 ) })` );

// hanging still at the surface: legs down, arms out
d.setPose( { mode: 'swim', floating: true, pitch: 0, speed: 0, sprint: false } );
run( d, 3 );
check( near( d.elev, 1.4, 0.03 ), `surface: hanging, legs ${ ( d.elev * 180 / Math.PI ).toFixed( 0 ) } deg below the horizontal` );
check( d.arm.out > 0.3 && d.arm.up < 0.05, `surface: arms out (${ d.arm.out.toFixed( 2 ) })` );
// the face still looks ahead
d.place( 0, new E.Vector3( 0, 0, 0 ) );
const e2 = d.eyeWorld( new E.Vector3() ), h3 = d.headWorld( new E.Vector3() );
check( e2.z < h3.z - 0.03 && Math.abs( e2.y - h3.y ) < 0.08, `surface: the face looks ahead (eye z ${ e2.z.toFixed( 2 ) } vs head ${ h3.z.toFixed( 2 ) })` );

// a blackout: limp
d.setPose( { mode: 'swim', floating: false, pitch: 0, speed: 0.5, blackout: true } );
run( d, 4 );
check( d.arm.limp > 0.9 && d.kickAmp < 0.05 && d.neckBend > 0.4, 'blackout: arms limp, no kick, head dropped' );
check( d.fins[ 0 ].visible && d.head.visible, 'the head and fins show by default' );
d.showHead( false );
check( ! d.head.visible, 'first person hides the head' );

// placeEye puts the eyes exactly where asked, whatever the pose
d.setPose( { mode: 'swim', floating: false, pitch: - 0.6, speed: 1, blackout: false } );
run( d, 2 );
const target = new E.Vector3( 12.5, - 3.2, - 40 );
d.placeEye( 1.1, target );
const e3 = d.eyeWorld( new E.Vector3() );
check( e3.distanceTo( target ) < 1e-6, `placeEye: eyes at the target (off by ${ e3.distanceTo( target ).toExponential( 1 ) })` );
check( d.group.position.distanceTo( target ) > 0.1, 'placeEye: the float point is elsewhere' );

// ---- the player's own body and the chase camera
const terrain = new TerrainData();
const query = { n: 0, cpu: new Float32Array( 64 ), cpuValid: true, allocate( n, k ) { const s = this.n; this.n += k; return s; }, setPoint() {} };
const colliders = { boxes: [], groundHeightAt: () => - Infinity, resolveCapsule: () => false };
class InputStub {

	constructor() { this.keys = new Set(); this.pressed = new Set(); this.look = { x: 0, y: 0 }; this.wheel = 0; this.enabled = true; }
	down( c ) { return this.keys.has( c ); }
	hit( c ) { return this.pressed.has( c ); }
	press( c ) { this.pressed.add( c ); }
	move( out ) { out.x = ( this.down( 'KeyD' ) ? 1 : 0 ) - ( this.down( 'KeyA' ) ? 1 : 0 ); out.y = ( this.down( 'KeyW' ) ? 1 : 0 ) - ( this.down( 'KeyS' ) ? 1 : 0 ); return out; }
	consumeLook() { const l = { ...this.look }; this.look.x = this.look.y = 0; return l; }
	consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
	endFrame() { this.pressed.clear(); }

}

const input = new InputStub();
const camera = new E.PerspectiveCamera( 60, 2, 0.1, 5000 );
const player = new Player( { camera, input, terrain, colliders, query, boat: null } );
const scene = new E.Group();
const me = new PlayerDiver( { scene, material: null, player } );
// deep water off the beach, flat sea at y 0
let sx = 20, sz = 80;
while ( terrain.heightAt( sx, sz ) > - 8 && sz < 400 ) sz += 5;
player.position.set( sx, - 0.1, sz );
player.mode = 'swim';
const step = ( sec, gun = false ) => {

	for ( let t = 0; t < sec; t += dt ) {

		player.update( dt );
		me.update( dt, { gun, blackout: false } );
		input.endFrame();

	}

};

step( 2 );
check( me.diver.group.visible && ! me.diver.head.visible, 'swimming in first person: your body shows, your head does not' );
const camEye = me.diver.eyeWorld( new E.Vector3() );
check( camEye.distanceTo( camera.position ) < 1e-4, `first person: the figure's eyes sit in the camera (${ camEye.distanceTo( camera.position ).toExponential( 1 ) } m)` );
check( me.diver.fins[ 0 ].visible, 'first person: fins on' );
const fin = new E.Vector3().setFromMatrixPosition( me.diver.legJoints[ 0 ].ankle.matrixWorld );
check( fin.y < camera.position.y - 0.5, `first person, floating: the fins hang ${ ( camera.position.y - fin.y ).toFixed( 2 ) } m below the eyes` );

// V: the chase camera, behind the view
input.press( 'KeyV' );
step( 1.5 );
check( player.swimCam === 'third' && player.thirdPerson, 'V: third person while swimming' );
check( me.diver.head.visible, 'third person: the head shows' );
const back = camera.position.distanceTo( player.eye );
check( back > 2.5 && back < 4.5, `chase camera ${ back.toFixed( 2 ) } m from the eyes` );
const view = new E.Vector3( 0, 0, - 1 ).applyQuaternion( camera.quaternion );
const toEye = new E.Vector3().subVectors( player.eye, camera.position ).normalize();
check( view.dot( toEye ) > 0.9, `chase camera looks at the diver (cos ${ view.dot( toEye ).toFixed( 3 ) })` );
check( camera.position.y > player.eye.y, 'chase camera a little above' );
// the wheel zooms, within bounds
input.wheel = 20;
step( 1 );
check( player.swimDist <= 8 && player.swimDist > 3.4, `wheel back: ${ player.swimDist.toFixed( 2 ) } m` );
// looking down + W at the surface is an ordinary dive, no sequence
input.keys.add( 'KeyW' );
player.pitch = - 1.0;
step( 0.5 );
check( player.duck === null && ! player.floating && player.position.y < - 0.3, `looking down + W dives plainly (y ${ player.position.y.toFixed( 2 ) })` );
input.keys.delete( 'KeyW' );
input.keys.add( 'Space' );
step( 4 );
input.keys.delete( 'Space' );
step( 1 );
check( player.floating && player.prompt && player.prompt.key === 'X', `back at the surface the prompt offers X: ${ player.prompt && player.prompt.text }` );
// X at the surface is a duck dive: the body takes over for DUCK.end seconds, a glide ahead, then
// down with the legs lifted, no kick
player.pitch = 0;
const y0 = player.position.y, x0 = player.position.x, z0 = player.position.z;
input.press( 'KeyX' );
step( 0.2 );
check( player.duck !== null && player.duck < 0.3, `X at the surface starts a duck dive (${ player.duck?.toFixed( 2 ) } s in)` );
step( DUCK.glide - 0.2 );
const glided = Math.hypot( player.position.x - x0, player.position.z - z0 );
check( Math.abs( player.position.y - y0 ) < 0.25 && glided > 0.25, `glide: level, moving ahead ${ glided.toFixed( 2 ) } m` );
check( me.diver.arm.up > 0.8 && me.diver.kickAmp > 0.3, `glide: arms ahead, two gentle kicks (${ me.diver.kickAmp.toFixed( 2 ) })` );
step( DUCK.knife - DUCK.glide );
check( me.diver.hinge > 1.3 && me.diver.elev < - 1.3, `jackknife: a right angle at the hips (${ ( me.diver.hinge * 180 / Math.PI ).toFixed( 0 ) } deg), torso straight down` );
check( player.pitch < - 1.1, `the view follows the hands down (${ ( player.pitch * 180 / Math.PI ).toFixed( 0 ) } deg)` );
step( DUCK.legs - DUCK.knife );
const kneeW = new E.Vector3().setFromMatrixPosition( me.diver.legJoints[ 0 ].knee.matrixWorld );
check( me.diver.hinge < 0.3 && kneeW.y > player.position.y + 0.5 && me.diver.kickAmp < 0.05, `legs up: straight above the body (knees ${ ( kneeW.y - player.position.y ).toFixed( 2 ) } m over the float point, hinge ${ ( me.diver.hinge * 180 / Math.PI ).toFixed( 0 ) } deg), no kick (${ me.diver.kickAmp.toFixed( 2 ) })` );
const yLegs = player.position.y;
step( DUCK.pull - DUCK.legs );
check( yLegs - player.position.y > 0.6, `the arm pull takes you down ${ ( yLegs - player.position.y ).toFixed( 2 ) } m` );
check( me.diver.arm.up < 0.3 && me.diver.arm.out < 0.4, `pull done: arms to the thighs (up ${ me.diver.arm.up.toFixed( 2 ) }, out ${ me.diver.arm.out.toFixed( 2 ) })` );
step( DUCK.equalize - DUCK.pull );
check( me.diver.arm.nose > 0.8, `a hand to the nose to equalize (${ me.diver.arm.nose.toFixed( 2 ) })` );
step( DUCK.end - DUCK.equalize + 0.2 );
check( player.duck === null && ! player.floating, 'the duck dive ends under water, in your hands again' );
check( player.position.y < - 1.5, `you are ${ ( - player.position.y ).toFixed( 1 ) } m down` );
// then finning down in third person: the camera follows behind, above the seabed
input.keys.add( 'KeyW' );
step( 2 );
input.keys.delete( 'KeyW' );
const floor = terrain.heightAt( camera.position.x, camera.position.z );
check( camera.position.y > floor + 0.3, `diving: the camera follows (player y ${ player.position.y.toFixed( 1 ) }, camera ${ camera.position.y.toFixed( 1 ) } over the seabed at ${ floor.toFixed( 1 ) })` );
check( player.swimCam === 'third' && me.diver.kickAmp > 0.3, `diving: still third person, kicking (${ me.diver.kickAmp.toFixed( 2 ) })` );
// X under water does nothing; back at the surface, Space aborts a duck dive
input.press( 'KeyX' );
step( 0.1 );
check( player.duck === null, 'X under water does nothing' );
input.keys.add( 'Space' );
step( 6 );
input.keys.delete( 'Space' );
step( 0.5 );
check( player.floating && player.duck === null, 'back at the surface' );
input.press( 'KeyX' );
step( 0.5 );
check( player.duck !== null, 'X starts another duck dive' );
input.keys.add( 'Space' );
step( 0.1 );
check( player.duck === null, 'Space aborts it' );
input.keys.delete( 'Space' );
// with the gun out in first person the arms are hidden (the gun's own view has them)
input.press( 'KeyV' );
step( 0.5, true );
check( player.swimCam === 'first' && camera.position.distanceTo( player.eye ) < 1e-6, 'V again: first person, camera back in the eyes' );
check( ! me.diver.arms[ 0 ].upper.visible && ! me.diver.head.visible, 'first person with the gun: no arms, no head' );
step( 0.5, false );
check( me.diver.arms[ 0 ].upper.visible, 'gun away: the arms show' );
// out of the water: the body goes
player.position.set( 53.6, terrain.heightAt( 53.6, - 77 ), - 77 );
player.mode = 'walk';
step( 0.2 );
check( ! me.diver.group.visible, 'walking: the body is hidden' );

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
