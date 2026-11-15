// Two players dive together through the real relays: Ana makes a room with "Dive with friends",
// Ben opens her link, each sees the other in the panel and as a name tag, and Ben's chat line
// typed with Enter reaches Ana. Screenshots: /tmp/netplay-ana.png, /tmp/netplay-ben.png.
// Needs the dev server (npm run dev) and internet access.
//   node test/netplay-two.mjs [playwright-core dir]
import { createRequire } from 'node:module';
const require = createRequire( import.meta.url );
// playwright-core: the argument, $PLAYWRIGHT, or a copy installed in one of the usual places
import { existsSync, readdirSync } from 'node:fs';
const pwDir = process.argv[ 2 ] || process.env.PLAYWRIGHT || [ 'node_modules/playwright-core', ...readdirSync( '/tmp' ).map( ( d ) => `/tmp/${ d }/node_modules/playwright-core` ) ].find( ( d ) => existsSync( d ) );
if ( ! pwDir ) throw new Error( 'playwright-core not found: npm i -D playwright-core, or pass its directory' );
const pw = require( pwDir.startsWith( '/' ) ? pwDir : process.cwd() + '/' + pwDir );
const base = process.env.BASE || 'http://127.0.0.1:5189';
const browser = await pw.chromium.launch( { args: [ '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required' ], executablePath: process.env.CHROME || ( process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome' ) } );
let fails = 0;
const check = ( ok, what ) => { console.log( ( ok ? 'ok   ' : 'FAIL ' ) + what ); if ( ! ok ) fails ++; };
const wait = async ( page, fn, ms = 30000 ) => { try { await page.waitForFunction( fn, null, { timeout: ms } ); return true; } catch { return false; } };
const open = async ( url, name ) => {

	const ctx = await browser.newContext( { viewport: { width: 1280, height: 720 }, permissions: [ 'clipboard-read', 'clipboard-write', 'microphone' ] } );
	await ctx.addInitScript( ( n ) => localStorage.setItem( 'onebreath.name', n ), name );
	const page = await ctx.newPage();
	page.on( 'pageerror', ( e ) => console.log( name, 'error:', e.message ) );
	await page.goto( url );
	return page;

};

const ana = await open( `${ base }/test/netplay.html?x=0&z=0`, 'Ana' );
await ana.getByRole( 'button', { name: 'Dive with friends' } ).click();
check( await wait( ana, () => window.__np.room ), 'Ana: "Dive with friends" makes a room' );
const link = await ana.evaluate( () => location.href );
check( /[?&]dive=[a-z2-9]{6}/.test( link ), `the address bar holds the invite link: ${ link }` );
const clip = await ana.evaluate( () => navigator.clipboard.readText() ).catch( () => '' );
check( clip === link, 'and so does the clipboard' );
const ben = await open( link.replace( 'x=0&z=0', 'x=0&z=-12' ), 'Ben' );
check( await wait( ana, () => document.querySelector( '.nu-count b' )?.textContent === '2' ), 'Ana sees 2 in the water' );
check( await wait( ben, () => document.querySelector( '.nu-count b' )?.textContent === '2' ), 'so does Ben' );
check( await ana.evaluate( () => [ ...document.querySelectorAll( '.nu-people span' ) ].map( ( s ) => s.textContent ).join( ', ' ) ) === 'Ana (you), Ben', 'Ana\'s list: Ana (you), Ben' );
check( await wait( ana, () => { const t = document.querySelector( '.nt' ); return t && t.textContent === 'Ben' && t.style.display !== 'none'; }, 15000 ), 'Ana sees Ben\'s name tag, 12 m ahead of her' );
const tagAt = await ana.evaluate( () => document.querySelector( '.nt' ).getBoundingClientRect().toJSON() );
check( Math.abs( tagAt.x + tagAt.width / 2 - 640 ) < 30 && tagAt.y < 360, `in the middle of her view, above the horizon (${ Math.round( tagAt.x + tagAt.width / 2 ) }, ${ Math.round( tagAt.y ) })` );
// the host: Ana made the dive, so she has World and Ben is told she sets it
check( await ana.isVisible( 'text=World' ) && ! await ben.isVisible( '.nu-bar >> text=World' ), 'Ana (the host) has a World button, Ben doesn\'t' );
check( await wait( ben, () => document.querySelector( '.nu-world' )?.textContent === 'Time and weather: Ana (host)', 10000 ), 'Ben: "Time and weather: Ana (host)"' );
await ana.getByRole( 'button', { name: 'World' } ).click();
await ana.$eval( '.nu-time input[type=range]', ( r ) => { r.value = '6.5'; r.dispatchEvent( new Event( 'input' ) ); } );
check( await ana.textContent( '.nu-time b' ) === '06:30', 'Ana drags the time to 06:30' );
check( await wait( ben, () => Math.abs( window.__game.app.settings.timeOfDay - 6.5 ) < 0.01, 10000 ), 'Ben\'s sun follows: 06:30' );
await ana.getByRole( 'button', { name: 'Storm' } ).click();
check( await wait( ben, () => window.__game.app.ui.weather === 'Storm', 10000 ), 'Ana picks Storm: Ben gets the storm' );
await ana.screenshot( { path: '/tmp/netplay-world.png', clip: { x: 0, y: 0, width: 640, height: 400 } } );
await ana.click( '.nu-check input' );
check( await wait( ben, () => window.__game.app.settings.timeSpeed > 0, 10000 ), 'Ana lets the time run: Ben\'s runs too' );
await ben.evaluate( () => { window.__game.app.settings.timeOfDay = 22; window.__game.app.ui.setWeather( 'Calm' ); } );
// Ben can't set it: his own change stands only until the host sends again
check( await wait( ben, () => window.__game.app.ui.weather === 'Storm', 12000 ), 'Ben changes his own weather: the host\'s comes back' );

// the host's animals: Ana's fish and whale reach Ben, a few times a second; Ben sends none
check( await wait( ben, () => window.__life.fishIn.length >= 5 && window.__life.whaleIn.length >= 1, 8000 ), 'Ana (host) sends her big animals and whale: Ben\'s game takes them' );
const lifeIn = await ben.evaluate( () => ( { last: window.__life.fishIn.at( - 1 ), whale: window.__life.whaleIn.at( - 1 ) } ) );
check( lifeIn.last.a[ 0 ] === 7 && lifeIn.last.a.length === 12 && lifeIn.last.age >= 0 && lifeIn.last.age < 1.5, `the fish arrive as sent, ${ ( lifeIn.last.age * 1000 ).toFixed( 0 ) } ms old` );
check( lifeIn.whale.s.u > 100 && lifeIn.whale.s.state === 'cruise', 'and her whale' );
check( await ana.evaluate( () => window.__life.fishIn.length === 0 ), 'Ana takes nobody\'s animals: she runs them' );
check( await ben.evaluate( () => Array.isArray( window.__life.others ) ) && await wait( ana, () => window.__life.others && window.__life.others.length === 1 ), 'each game knows where the other diver is (the fish flee from them too)' );
// Ben spears Ana's whale: hers sounds
await ben.evaluate( () => window.__game.spear.onWhaleStartle( - 1 ) );
check( await wait( ana, () => window.__life.startled[ 0 ] === - 1, 8000 ), 'Ben hits the whale: on Ana\'s side it startles and sounds' );

// push-to-talk: Ben holds B; his (fake: a tone) mic reaches Ana, loud while he holds it, silent after
const level = ( page ) => page.evaluate( async () => {

	const a = document.querySelector( 'audio[data-voice]' );
	if ( ! a || ! a.srcObject ) return null;
	const ctx = window.__vctx || ( window.__vctx = new AudioContext() );
	if ( ! window.__van ) {

		window.__van = ctx.createAnalyser();
		ctx.createMediaStreamSource( a.srcObject ).connect( window.__van );

	}

	await ctx.resume();
	const buf = new Float32Array( 2048 );
	let peak = 0;
	for ( let k = 0; k < 10; k ++ ) {

		await new Promise( ( r ) => setTimeout( r, 50 ) );
		window.__van.getFloatTimeDomainData( buf );
		for ( const x of buf ) peak = Math.max( peak, Math.abs( x ) );

	}

	return peak;

} );
await ben.mouse.click( 900, 600 ); // focus the page (not a text box)
await ben.keyboard.down( 'b' );
check( await wait( ben, () => window.__np.voice.mic === 'on' && window.__np.voice.talking, 8000 ), 'Ben holds B: his mic comes on and he talks' );
check( await ben.evaluate( () => document.querySelector( '.nu-btn.is-talk' ).classList.contains( 'is-on' ) ), 'his Talk button shows it' );
check( await wait( ana, () => { const a = document.querySelector( 'audio[data-voice]' ); return a && a.srcObject && a.srcObject.getAudioTracks().length > 0; }, 15000 ), 'Ana gets his voice' );
check( await wait( ana, () => document.querySelector( '.nt' )?.classList.contains( 'is-talking' ) && document.querySelector( '.nu-people span:not(.is-me).is-talking' ), 5000 ), 'his name tag and his name in the list show he\'s talking' );
let loud = 0;
for ( let k = 0; k < 10 && loud < 0.02; k ++ ) loud = await level( ana );
check( loud > 0.02, `she hears him (peak ${ loud.toFixed( 3 ) })` );
await ana.screenshot( { path: '/tmp/netplay-talk.png', clip: { x: 0, y: 0, width: 720, height: 420 } } );
await ben.keyboard.up( 'b' );
check( await wait( ben, () => ! window.__np.voice.talking && window.__np.voice.stream.getAudioTracks()[ 0 ].enabled === false, 3000 ), 'he lets go: his mic is silent' );
check( await wait( ana, () => ! document.querySelector( '.nt' )?.classList.contains( 'is-talking' ), 5000 ), 'and his mark goes' );
let quiet = 1;
for ( let k = 0; k < 10 && quiet > 0.005; k ++ ) quiet = await level( ana );
check( quiet < 0.005, `Ana hears nothing from him now (peak ${ quiet.toFixed( 4 ) })` );
// Ana talks with the button (a phone has no B); Ben mutes the voices
await ben.getByRole( 'button', { name: 'Voices' } ).click();
const tb = await ana.$( '.nu-btn.is-talk' );
const box = await tb.boundingBox();
await ana.mouse.move( box.x + box.width / 2, box.y + box.height / 2 );
await ana.mouse.down();
check( await wait( ana, () => window.__np.voice.talking, 8000 ), 'Ana holds the Talk button: she talks' );
check( await wait( ben, () => { const a = document.querySelector( 'audio[data-voice]' ); return a && a.muted; }, 15000 ), 'Ben has muted the voices: hers plays muted' );
await ana.mouse.up();
check( await wait( ana, () => ! window.__np.voice.talking, 3000 ), 'she lets go: silent' );
await ben.getByRole( 'button', { name: 'Voices' } ).click();
check( await ben.evaluate( () => ! document.querySelector( 'audio[data-voice]' ).muted ), 'Ben turns the voices back on' );
// a B typed in the chat box isn't push-to-talk
await ben.keyboard.press( 'Enter' );
await ben.keyboard.type( 'bob' );
check( await ben.evaluate( () => ! window.__np.voice.talking ), 'typing a b in the chat doesn\'t talk' );
await ben.keyboard.press( 'Escape' );

// Ben's suit: Suit opens the picker, a swatch changes it for him and for Ana
await ben.getByRole( 'button', { name: 'Suit' } ).click();
await ben.click( '[aria-label="Suit Ocean"]' );
await ben.click( '[aria-label="Trim Yellow"]' );
await ben.click( '[aria-label="Fins Blue"]' );
check( await ben.evaluate( () => JSON.stringify( window.__game.me.diver.look ) ) === JSON.stringify( { suit: 0x1f4f7a, accent: 0xffd21f, fins: 0x1f6fd1 } ), 'Ben wears it at once' );
check( await ben.evaluate( () => JSON.parse( localStorage.getItem( 'onebreath.look' ) ).fins ) === 0x1f6fd1, 'and it\'s kept for next time' );
check( await wait( ana, () => { const d = [ ...window.__np.divers.divers.values() ][ 0 ]; return d && d.diver.look.suit === 0x1f4f7a && d.diver.look.accent === 0xffd21f && d.diver.look.fins === 0x1f6fd1; }, 10000 ), 'Ana sees Ben in the ocean-blue suit, yellow trim and blue fins' );
check( await wait( ana, () => getComputedStyle( document.querySelector( '.nt' ) ).getPropertyValue( '--nt-c' ).trim() === '#ffd21f', 5000 ), 'his name tag\'s dot is his trim colour' );
await ben.screenshot( { path: '/tmp/netplay-suit.png', clip: { x: 0, y: 0, width: 640, height: 400 } } );
await ben.keyboard.press( 'Escape' );
check( await ben.evaluate( () => document.querySelector( '.nu-pop' ).hidden ), 'Esc closes the picker' );

// Ben takes out his speargun, loads both bands and aims: Ana sees it in his hand
await ben.evaluate( () => Object.assign( window.__game.spear, { equipped: true, aiming: true } ) && ( window.__game.spear.gun.bandsLoaded = 2 ) );
check( await wait( ana, () => { const d = [ ...window.__np.divers.divers.values() ][ 0 ]; return d && d.gun.group.visible && d.pose.aim && d.gun.bands[ 1 ].loaded.visible && d.gun.shaft.visible; }, 10000 ), 'Ben draws his gun and aims: Ana sees it raised, both bands loaded' );
check( await ana.evaluate( () => JSON.stringify( [ ...window.__np.divers.divers.values() ][ 0 ].gun.gear ) ) === '{"gunM":0.9,"bands":2,"gunKind":"teak"}', 'his own gun: 90 cm, teak, two bands' );
await ben.evaluate( () => { const s = window.__game.spear; s.gun.bandsLoaded = 0; s.gun.shaftHome = false; s.onShot( { x: 0, y: - 0.1, z: - 12.9 }, { x: 0, y: 0, z: 1 }, 18 ); } );
check( await wait( ana, () => window.__np.divers.shots.length === 1 && window.__np.divers.shots[ 0 ].shaft.mesh.position.z > - 11 ), 'he shoots towards her: his shaft flies her way' );
check( await wait( ana, () => { const d = [ ...window.__np.divers.divers.values() ][ 0 ]; return ! d.gun.shaft.visible && d.gun.bands[ 0 ].slack.visible; }, 5000 ), 'his rail is empty, the bands hang slack' );
await ben.evaluate( () => { const s = window.__game.spear; s.gun.shaftHome = true; s.equipped = false; s.aiming = false; } );
check( await wait( ana, () => window.__np.divers.shots.length === 0 && ! [ ...window.__np.divers.divers.values() ][ 0 ].gun.group.visible, 8000 ), 'he reels in and puts it away: shaft and gun gone' );

// Ben chats: Enter opens the box, he types, Enter sends
await ben.keyboard.press( 'Enter' );
check( await wait( ben, () => document.activeElement?.classList.contains( 'nu-input' ), 3000 ), 'Ben: Enter opens the chat box' );
await ben.keyboard.type( 'Going down to the wall, follow me' );
await ben.keyboard.press( 'Enter' );
check( await ben.evaluate( () => ! document.querySelector( '.nu' ).classList.contains( 'is-typing' ) ), 'Enter sends and closes it' );
check( await wait( ana, () => [ ...document.querySelectorAll( '.nu-line' ) ].some( ( l ) => l.textContent === 'BenGoing down to the wall, follow me' ), 10000 ), 'Ana gets Ben\'s line' );
await ben.keyboard.press( 'Enter' );
await ben.keyboard.type( '/name Benny' );
await ben.keyboard.press( 'Enter' );
check( await wait( ana, () => document.querySelector( '.nt' )?.textContent === 'Benny', 10000 ), '/name Benny: Ana\'s tag for him changes' );
await ana.getByRole( 'button', { name: 'World' } ).click();
// Ana clicks her own name in the list, types a new one, Enter
await ana.click( '.nu-people .is-me' );
check( await ana.evaluate( () => document.activeElement?.classList.contains( 'nu-rename' ) && document.activeElement.value === 'Ana' ), 'Ana: a click on her name turns it into a box' );
await ana.keyboard.type( 'Anita' );
await ana.keyboard.press( 'Enter' );
check( await ana.evaluate( () => document.querySelector( '.nu-people .is-me' )?.textContent === 'Anita (you)' && ! document.querySelector( '.nu' ).classList.contains( 'is-typing' ) ), 'Enter keeps it, and doesn\'t open the chat' );
check( await wait( ben, () => document.querySelector( '.nt' )?.textContent === 'Anita', 10000 ), 'Ben\'s tag for her says Anita' );
check( await ana.evaluate( () => localStorage.getItem( 'onebreath.name' ) ) === 'Anita', 'and it\'s kept for next time' );
await ana.click( '.nu-people .is-me' );
await ana.keyboard.type( 'Zed' );
await ana.keyboard.press( 'Escape' );
check( await ana.evaluate( () => document.querySelector( '.nu-people .is-me' )?.textContent === 'Anita (you)' ), 'Esc leaves the name as it was' );
await ana.screenshot( { path: '/tmp/netplay-ana.png' } );
await ben.screenshot( { path: '/tmp/netplay-ben.png' } );
await ben.getByRole( 'button', { name: 'Leave' } ).click();
check( await ben.evaluate( () => window.__np.voice.stream === null && window.__np.voice.mic === 'off' ), 'Ben leaves: his mic is off' );
check( await wait( ana, () => document.querySelector( '.nu-count b' )?.textContent === '1' && ! document.querySelector( '.nt' ), 15000 ), 'Ben leaves: Ana is alone again and his diver is gone' );
check( await ben.evaluate( () => ! /dive=/.test( location.href ) && ! document.querySelector( '.nu-btn.is-main' ).hidden ), 'Ben\'s link is gone and he can make a new dive' );
await browser.close();
console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
