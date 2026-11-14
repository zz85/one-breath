// Two browsers in one dive room over the public relays: each must see the other, its poses and
// its chat. Needs the dev server (npm run dev) and internet access.
//   node test/net-two.mjs [playwright-core dir]
import { createRequire } from 'node:module';
const require = createRequire( import.meta.url );
const pw = require( process.argv[ 2 ] || '/tmp/pw2/node_modules/playwright-core' );
const code = 'test' + Math.random().toString( 36 ).slice( 2, 8 );
const base = process.env.BASE || 'http://127.0.0.1:5189';
const browser = await pw.chromium.launch( { args: [ '--no-sandbox' ], executablePath: process.env.CHROME || ( process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome' ) } );
const pages = [];
for ( const name of [ 'Ana', 'Ben' ] ) {

	const ctx = await browser.newContext();
	const page = await ctx.newPage();
	page.on( 'console', ( m ) => { if ( m.type() === 'error' ) console.log( name, 'console:', m.text() ); } );
	await page.goto( `${ base }/test/net.html?dive=${ code }&name=${ name }` );
	pages.push( page );

}

const t0 = Date.now();
let ok = false;
while ( Date.now() - t0 < 60000 ) {

	const s = await Promise.all( pages.map( ( p ) => p.evaluate( () => window.__net && { poses: window.__net.poses, chat: window.__net.chat.length, people: Object.values( window.__net.people ).map( ( x ) => x.name ).sort().join( ',' ), errors: window.__net.errors } ) ) );
	if ( s.every( ( x ) => x && x.poses > 5 && x.chat > 0 && x.people === 'Ana,Ben' ) ) {

		console.log( `ok after ${ ( ( Date.now() - t0 ) / 1000 ).toFixed( 1 ) } s`, JSON.stringify( s ) );
		ok = true;
		break;

	}

	await new Promise( ( r ) => setTimeout( r, 1000 ) );
	if ( ( Date.now() - t0 ) % 10000 < 1000 ) console.log( JSON.stringify( s ) );

}

if ( ! ok ) console.log( 'FAILED: the two pages never saw each other' );
// one leaves: the other's list drops to one
if ( ok ) {

	await pages[ 1 ].evaluate( () => window.__room.leave() );
	const t1 = Date.now();
	let gone = false;
	while ( Date.now() - t1 < 20000 && ! gone ) {

		gone = await pages[ 0 ].evaluate( () => Object.keys( window.__net.people ).length === 1 );
		if ( ! gone ) await new Promise( ( r ) => setTimeout( r, 500 ) );

	}

	console.log( gone ? `leave seen after ${ ( ( Date.now() - t1 ) / 1000 ).toFixed( 1 ) } s` : 'FAILED: the leave was never seen' );
	ok = gone;

}

await browser.close();
process.exit( ok ? 0 : 1 );
