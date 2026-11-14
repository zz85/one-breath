// Diving with friends, without the network: the pose codec, the playback buffer, the room's
// chat and name rules, and how a remote diver is drawn from a pose.
//   node test/net-pose.mjs
import { encodePose, decodePose, PoseBuffer, POSE_LEN, hueOf, makeDiveCode, cleanDiveCode, cleanName, cleanChat } from '../src/net/Pose.js';
import { DiveRoom } from '../src/net/DiveRoom.js';
import { RemoteDivers } from '../src/game/RemoteDivers.js';
import { Group, Vector3 } from '../src/engine/index.js';

let fails = 0;
const check = ( ok, what ) => {

	console.log( ( ok ? 'ok   ' : 'FAIL ' ) + what );
	if ( ! ok ) fails ++;

};
const near = ( a, b, e = 1e-3 ) => Math.abs( a - b ) < e;

// ---- codec
const pose = { t: 12.5, x: 101.25, y: - 6.5, z: - 42, yaw: 1.2, pitch: - 0.4, mode: 'swim', floating: false, gun: true, blackout: false, speed: 1.4, depth: 6.6 };
const buf = encodePose( pose );
check( buf.length === POSE_LEN && buf.byteLength === 40, 'a pose is 10 floats, 40 bytes' );
const back = decodePose( buf );
check( back && back.mode === 'swim' && back.gun && ! back.floating && near( back.x, 101.25 ) && near( back.pitch, - 0.4 ), 'a pose survives the round trip' );
check( decodePose( new Uint8Array( buf.buffer.slice( 0 ) ) ) !== null, 'it decodes from the bytes as they arrive' );
check( decodePose( new Float32Array( 3 ) ) === null, 'too short: not a pose' );
const bad = encodePose( pose ); bad[ 2 ] = NaN;
check( decodePose( bad ) === null, 'NaN: not a pose' );
const far = encodePose( pose ); far[ 1 ] = 1e9;
check( decodePose( far ) === null, 'a position off the map: not a pose' );
check( decodePose( { x: 1 } ) === null && decodePose( 'hi' ) === null, 'JSON or text: not a pose' );

// ---- playback: poses sent every 1/12 s arrive with jitter; drawn 0.12 s behind, smoothly
const pb = new PoseBuffer();
const sent = [];
let rnd = 1;
const jitter = () => ( ( rnd = ( rnd * 16807 ) % 2147483647 ) / 2147483647 ) * 0.04;
for ( let i = 0; i < 24; i ++ ) {

	const t = 100 + i / 12; // their clock
	sent.push( { ...pose, t, x: i, yaw: Math.PI - 0.05 + i * 0.01 } ); // the yaw crosses +-PI

}

const LAT = 1000; // our clock is 1000 s ahead of theirs, plus 30-70 ms on the way
for ( const p of sent ) pb.push( p, p.t + LAT + 0.03 + jitter() );
const s = pb.sample( 100 + 1 + LAT + 0.03 );
check( s && s.x > 10.5 && s.x < 11.5, `drawn about 0.12 s behind the newest: x ${ s && s.x.toFixed( 2 ) } (sent 11 at that time)` );
const s2 = pb.sample( 100 + 1 + 1 / 24 + LAT + 0.03 );
check( s2.x > s.x && s2.x - s.x < 0.6, 'half a packet later it has moved half a step' );
const yaws = [];
for ( let k = 0; k < 20; k ++ ) yaws.push( pb.sample( 100 + 0.5 + k * 0.01 + LAT + 0.03 ).yaw );
check( yaws.every( ( y, i ) => i === 0 || Math.abs( Math.atan2( Math.sin( y - yaws[ i - 1 ] ), Math.cos( y - yaws[ i - 1 ] ) ) ) < 0.05 ), 'the heading turns smoothly across +-180 degrees' );
const late = pb.sample( 100 + 23 / 12 + 0.12 + 0.2 + LAT + 0.03 );
check( late.x > 23 && late.x < 26, `a late packet: it glides on a little (${ late.x.toFixed( 2 ) }) instead of stopping` );
const later = pb.sample( 100 + 23 / 12 + 5 + LAT );
check( later.x < 26.5, 'and not forever' );
check( pb.push( { ...sent[ 3 ] }, 0 ) === false, 'an old packet that arrives late is dropped' );
check( pb.age( sent[ 23 ].t + LAT + 4 ) > 3.5, 'its age says how long since the last pose' );
const restarted = new PoseBuffer();
restarted.push( { ...pose, t: 500 }, 1500 );
restarted.push( { ...pose, t: 2, x: 77 }, 1501 ); // they reloaded the page: their clock starts again
check( restarted.sample( 1502 ).x === 77, 'a diver who reloads shows up again where they are' );
check( new PoseBuffer().sample( 5 ) === null, 'nothing to draw before the first pose' );

// ---- names, codes, chat
check( hueOf( 'abc' ) === hueOf( 'abc' ) && hueOf( 'abc' ) !== hueOf( 'abd' ) && hueOf( 'x' ) >= 0 && hueOf( 'x' ) < 1, 'each diver has their own stable colour' );
const codes = new Set( Array.from( { length: 200 }, () => makeDiveCode() ) );
check( codes.size === 200 && [ ...codes ].every( ( c ) => /^[a-hjkmnp-z2-9]{6}$/.test( c ) ), 'dive codes: 6 letters and digits without 0, 1, i, l, o' );
check( cleanDiveCode( ' AbC-123 ' ) === 'abc123' && cleanDiveCode( 'ab' ) === null && cleanDiveCode( null ) === null, 'a code from the URL is cleaned up, a short one refused' );
check( cleanName( '  Maya\u0007 ' ) === 'Maya' && cleanName( 'x'.repeat( 50 ) ).length === 20, 'names: no control characters, 20 at most' );
check( cleanChat( 'hi\nthere' ) === 'hi there' && cleanChat( 'y'.repeat( 500 ) ).length === 200 && cleanChat( '   ' ) === '', 'chat: one line, 200 at most, blank refused' );

// ---- the room, with a stand-in for Trystero
function fakeJoin() {

	const actions = {}, users = {}, profiles = {};
	let profileCb = null, leaveCb = null, joinCb = null;
	const room = {
		cfg: null,
		onError() {},
		getSelf: async () => ( { userId: 'me', peerId: 'p0' } ),
		getUsers: () => users,
		makeUserState( ns, init ) {

			return {
				getAll: () => profiles,
				set: async ( v ) => {

					profiles.me = v;
					if ( profileCb ) profileCb( v, { userId: 'me', self: true } );

				},
				onChange: ( cb ) => { profileCb = cb; },
			};

		},
		makeState( ns ) {

			let val = null, meta = null, cb = null;
			room.state = { set: ( v, userId ) => { val = v; meta = { userId }; cb && cb( v, meta ); } };
			return { get: () => val, getMeta: () => meta, set: async ( v ) => { room.state.set( v, 'me' ); room.stateSent = v; }, onChange: ( h ) => { cb = h; } };

		},
		makeAction( ns ) {

			const a = actions[ ns ] = { sent: [], handler: null, onReceive() {}, onMessage( h ) { a.handler = h; }, send: async ( d ) => { a.sent.push( d ); } };
			return a;

		},
		onUserJoin( cb ) { joinCb = cb; },
		onUserLeave( cb ) { leaveCb = cb; },
		leave: async () => {},
		// test hooks
		_arrive( id, name, host = false ) { users[ id ] = { peerIds: [ id ] }; profiles[ id ] = host ? { name, host: true } : { name }; joinCb && joinCb( { userId: id } ); profileCb && profileCb( profiles[ id ], { userId: id } ); },
		_go( id ) { delete users[ id ]; leaveCb && leaveCb( { userId: id } ); },
		actions,
	};
	const join = ( cfg, id ) => {

		room.cfg = { ...cfg, roomId: id };
		return room;

	};

	return { join, room };

}

const profiles_u9_host = ( r ) => r._arrive( 'u9', 'Hana', true );
const { join, room } = fakeJoin();
const net = await DiveRoom.join( 'abc234', { name: 'Ana', joinRoom: join } );
check( room.cfg.roomId === 'dive-abc234' && room.cfg.password === 'abc234' && room.cfg.maxUsers === 8 && room.cfg.appId === 'zz85/one-breath', 'the room: dive-<code>, the code as its password, 8 divers at most' );
check( room.cfg.identity === 'none', 'a fresh id per tab, so two tabs are two divers' );
let people = null;
net.onPeople( ( p ) => { people = p; } );
room._arrive( 'u1', 'Ben\u0000' );
check( people && people.me.self && people.me.name === 'Ana' && people.u1.name === 'Ben' && ! people.u1.self, 'who is in the water: you and Ben, names cleaned' );
const heard = [];
net.onChat( ( id, t ) => heard.push( t ) );
for ( let i = 0; i < 14; i ++ ) room.actions.chat.handler( { text: 'spam ' + i }, { userId: 'u1' } );
check( heard.length === 10, `a flood of chat from one diver is cut at 10 in 10 s (${ heard.length })` );
room.actions.chat.handler( { nope: 1 }, { userId: 'u2' } );
room.actions.chat.handler( 'plain text', { userId: 'u2' } );
check( heard.length === 10, 'chat that isn\'t { text } is ignored' );
const poses = [];
net.onPose( ( id, p ) => poses.push( p ) );
room.actions.pose.handler( encodePose( pose ), { userId: 'u1' } );
room.actions.pose.handler( { x: 1 }, { userId: 'u1' } );
check( poses.length === 1 && poses[ 0 ].mode === 'swim', 'poses: the good one arrives, junk doesn\'t' );
check( net.say( '  hello  ' ) === 'hello' && room.actions.chat.sent[ 0 ].text === 'hello' && net.say( '  ' ) === null, 'saying something sends it trimmed; nothing sends nothing' );
// the host's time and weather: taken from the host alone
const worlds = [];
net.onWorld( ( c ) => worlds.push( c ) );
room.state.set( { time: 3 }, 'u1' );
check( worlds.length === 0, 'time and weather from a player who isn\'t the host: ignored' );
room._arrive( 'u9', 'Hana' );
profiles_u9_host( room );
check( net.hostId === 'u9' && people.u9.host, 'Hana\'s profile says she hosts' );
room.state.set( { time: 7 }, 'u9' );
check( worlds.length === 1 && worlds[ 0 ].time === 7, 'her time and weather come through' );
net.setWorld( { time: 9 } );
check( room.stateSent === undefined, 'a guest can\'t send time and weather' );
net.setLook( { suit: 0x1b2a44, accent: 0xff7a1a, fins: 0x1f6fd1, junk: 5 } );
room._arrive( 'u1', 'Ben' );
check( people.me.look && people.me.look.suit === 0x1b2a44 && ! ( 'junk' in people.me.look ), 'your suit goes in your profile, colours only' );
room._go( 'u9' );
check( net.hostId === null, 'the host leaves: nobody hosts' );
room._go( 'u1' );
check( people && ! people.u1 && people.me, 'Ben leaves: only you are left' );

const h = fakeJoin();
const hostNet = await DiveRoom.join( 'qq77zz', { name: 'Hana', host: true, look: { accent: 0xffd21f }, joinRoom: h.join } );
await new Promise( ( r ) => setTimeout( r, 0 ) );
check( hostNet.isHost && hostNet.people().me.host && hostNet.people().me.look.accent === 0xffd21f, 'the maker of the dive hosts it, in a yellow trim' );
hostNet.setWorld( { time: 9 } );
check( h.room.stateSent && h.room.stateSent.time === 9, 'the host sends time and weather' );

// ---- drawing a remote diver from a pose
const scene = new Group();
const divers = new RemoteDivers( { scene, material: null } );
divers.setPeople( { me: { name: 'Ana', hue: 0.2, self: true }, u1: { name: 'Ben', hue: 0.6, self: false } } );
divers.pose( 'me', { ...pose, t: 1 }, 1 );
check( divers.count === 0, 'you aren\'t drawn as one of the others' );
const walk = { ...pose, mode: 'walk', floating: false, pitch: 0, yaw: 0, x: 5, y: 2, z: 7, speed: 0 };
for ( let i = 0; i < 10; i ++ ) divers.pose( 'u1', { ...walk, t: i / 12 }, i / 12 );
for ( let i = 0; i < 60; i ++ ) divers.update( 1 / 60, 1 + i / 60, null );
const d = divers.divers.get( 'u1' );
const head = d.headWorld( new Vector3() );
check( scene.children.length === 1 && d.group.visible, 'Ben is in the scene' );
check( near( head.x, 5, 0.05 ) && head.y > 3.4 && head.y < 3.8 && near( head.z, 7, 0.1 ), `walking: standing up, head ~1.6 m over his feet (${ head.y.toFixed( 2 ) })` );
check( ! d.fins[ 0 ].visible, 'on land, no fins' );
// he dives, looking straight ahead and swimming at 1.5 m/s
const dive = { ...pose, mode: 'swim', floating: false, pitch: 0, yaw: 0, x: 5, y: - 4, z: 7, speed: 1.5 };
for ( let i = 0; i < 24; i ++ ) divers.pose( 'u1', { ...dive, t: 1 + i / 12 }, 1 + i / 12 );
for ( let i = 0; i < 120; i ++ ) divers.update( 1 / 60, 3 + i / 60, null );
const h2 = d.headWorld( new Vector3() );
check( Math.abs( h2.y - ( - 4 ) ) < 0.25, `swimming: lying flat, head level with his body (${ h2.y.toFixed( 2 ) })` );
check( h2.z < 7 - 0.05, `and ahead of it, the way he looks (yaw 0 looks -z): z ${ h2.z.toFixed( 2 ) }` );
check( d.fins[ 0 ].visible && Math.abs( d.legs[ 0 ].rotation.x ) + Math.abs( d.legs[ 1 ].rotation.x ) > 0, 'fins on and kicking' );
// looking down: head below the body
for ( let i = 0; i < 24; i ++ ) divers.pose( 'u1', { ...dive, pitch: - 1.2, t: 3 + i / 12 }, 5 + i / 12 );
for ( let i = 0; i < 120; i ++ ) divers.update( 1 / 60, 6.5 + i / 60, null );
const h3 = d.headWorld( new Vector3() );
const hip = new Vector3().setFromMatrixPosition( d.legs[ 0 ].matrixWorld );
check( hip.y - h3.y > 0.3, `diving down: head first, hips ${ ( hip.y - h3.y ).toFixed( 2 ) } m above the head` );
divers.setPeople( { me: { name: 'Ana', hue: 0.2, self: true }, u1: { name: 'Ben', hue: 0.6, self: false, look: { suit: 0x1f4f7a, accent: 0xffd21f, fins: 0x1f6fd1 } } } );
check( d.diver.look.suit === 0x1f4f7a && d.diver.look.fins === 0x1f6fd1, 'he picks a blue suit and blue fins: his diver wears them' );
const torsoColour = d.diver.torso.geometry.attributes.color.array.slice( 0, 3 );
check( torsoColour[ 2 ] > torsoColour[ 0 ], 'the torso is painted blue now' );
divers.setPeople( { me: { name: 'Ana', hue: 0.2, self: true } } );
check( divers.count === 0 && scene.children.length === 0, 'he leaves: his diver goes' );

console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
