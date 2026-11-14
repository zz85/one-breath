// Two players dive together through the real relays: Ana makes a room with "Dive with friends",
// Ben opens her link, each sees the other in the panel and as a name tag, and Ben's chat line
// typed with Enter reaches Ana. Screenshots: /tmp/netplay-ana.png, /tmp/netplay-ben.png.
// Needs the dev server (npm run dev) and internet access.
//   node test/netplay-two.mjs [playwright-core dir]
import { createRequire } from 'node:module';
const require = createRequire( import.meta.url );
const pw = require( process.argv[ 2 ] || '/tmp/pw2/node_modules/playwright-core' );
const base = process.env.BASE || 'http://127.0.0.1:5189';
const browser = await pw.chromium.launch( { args: [ '--no-sandbox' ], executablePath: process.env.CHROME || ( process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome' ) } );
let fails = 0;
const check = ( ok, what ) => { console.log( ( ok ? 'ok   ' : 'FAIL ' ) + what ); if ( ! ok ) fails ++; };
const wait = async ( page, fn, ms = 30000 ) => { try { await page.waitForFunction( fn, null, { timeout: ms } ); return true; } catch { return false; } };
const open = async ( url, name ) => {

	const ctx = await browser.newContext( { viewport: { width: 1280, height: 720 }, permissions: [ 'clipboard-read', 'clipboard-write' ] } );
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
await ana.screenshot( { path: '/tmp/netplay-ana.png' } );
await ben.screenshot( { path: '/tmp/netplay-ben.png' } );
await ben.getByRole( 'button', { name: 'Leave' } ).click();
check( await wait( ana, () => document.querySelector( '.nu-count b' )?.textContent === '1' && ! document.querySelector( '.nt' ), 15000 ), 'Ben leaves: Ana is alone again and his diver is gone' );
check( await ben.evaluate( () => ! /dive=/.test( location.href ) && ! document.querySelector( '.nu-btn.is-main' ).hidden ), 'Ben\'s link is gone and he can make a new dive' );
await browser.close();
console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
