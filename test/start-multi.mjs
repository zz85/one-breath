// The start screen's Multiplayer button and panel (ui/UI.js setMultiplayer), on test/start.html:
// it opens and closes, Host and Join start the game with the pick, typing doesn't start it, and
// an invite link opens the panel with its code. Screenshots /tmp/start-mp-desk.png, -phone.png.
// Needs the dev server (npm run dev).   node test/start-multi.mjs [playwright-core dir]
import { createRequire } from 'node:module';
const require = createRequire( import.meta.url );
const pw = require( process.argv[ 2 ] || '/tmp/pw2/node_modules/playwright-core' );
const base = ( process.env.BASE || 'http://127.0.0.1:5189' ) + '/test/start.html';
const browser = await pw.chromium.launch( { args: [ '--no-sandbox' ], executablePath: process.env.CHROME || ( process.env.HOME + '/.cache/ms-playwright/chromium-1194/chrome-linux/chrome' ) } );
let fails = 0;
const check = ( ok, what ) => { console.log( ( ok ? 'ok   ' : 'FAIL ' ) + what ); if ( ! ok ) fails ++; };
const page = await browser.newPage( { viewport: { width: 1280, height: 760 } } );
page.on( 'pageerror', ( e ) => console.log( 'error:', e.message ) );
const started = () => page.evaluate( () => window.__started || null );
const panelHidden = () => page.evaluate( () => document.querySelector( '.tw-start-mp' ).hidden );

await page.goto( base + '?mode=spear' );
await page.waitForSelector( '.tw-start-cta.is-multi' );
const labels = await page.evaluate( () => [ ...document.querySelectorAll( '.tw-start-modes .tw-start-cta' ) ].map( ( b ) => b.textContent.trim() ) );
check( labels[ labels.length - 1 ] === 'Multiplayer', `a Multiplayer button after the modes (${ labels.join( ' | ' ) })` );
check( await panelHidden(), 'its panel starts closed' );
await page.getByRole( 'button', { name: 'Multiplayer' } ).click();
check( ! await panelHidden() && ! await started(), 'a click opens the panel and doesn\'t start the game' );
check( await page.evaluate( () => document.activeElement.className ) === 'tw-mp-code', 'the code box has the focus (a name is filled in already)' );
check( /Spearfishing/.test( await page.textContent( '.tw-mp-note' ) ), 'the note says which mode you dive in: the last played' );
check( await page.isDisabled( '[data-multi="join"]' ), 'Join is off with no code' );
await page.keyboard.type( 'ab 12' ); // a space, typed in the box: not a start
check( ! await started(), 'typing a space in the box doesn\'t start the game' );
await page.fill( '.tw-mp-code', '' );
await page.fill( '.tw-mp-name', 'Maya' );
await page.getByRole( 'button', { name: 'Host a new dive' } ).click();
let s = await started();
check( s && s.mode === 'spear' && s.multi && s.multi.host && s.multi.name === 'Maya', `Host starts it: ${ JSON.stringify( s ) }` );

// pasting a friend's link and pressing Enter joins
await page.goto( base );
await page.waitForSelector( '.tw-start-cta.is-multi' );
await page.getByRole( 'button', { name: 'Multiplayer' } ).click();
await page.fill( '.tw-mp-code', 'https://zz85.github.io/one-breath/?dive=Kq7mZ2' );
check( ! await page.isDisabled( '[data-multi="join"]' ), 'a pasted invite link turns Join on' );
await page.press( '.tw-mp-code', 'Enter' );
s = await started();
check( s && s.mode === 'leisure' && s.multi && s.multi.code === 'kq7mz2' && ! s.multi.host, `Enter in the box joins its code: ${ JSON.stringify( s ) }` );

// a plain mode button: single player
await page.goto( base );
await page.waitForSelector( '.tw-start-cta.is-multi' );
await page.getByRole( 'button', { name: 'Multiplayer' } ).click();
await page.getByRole( 'button', { name: 'Multiplayer' } ).click();
check( await panelHidden(), 'a second click closes the panel' );
await page.getByRole( 'button', { name: 'Leisure Freediving' } ).click();
s = await started();
check( s && s.mode === 'leisure' && s.multi === null, 'a mode button starts alone' );

// opened from an invite link
await page.goto( base + '?dive=wb3d7b' );
await page.waitForSelector( '.tw-start-cta.is-multi' );
check( ! await panelHidden() && await page.inputValue( '.tw-mp-code' ) === 'wb3d7b', 'an invite link opens the panel with its code' );
await page.screenshot( { path: '/tmp/start-mp-desk.png' } );
await page.keyboard.press( 'Enter' );
s = await started();
check( s && s.multi && s.multi.code === 'wb3d7b', 'and Enter joins that dive' );

const phone = await browser.newPage( { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } );
await phone.goto( base + '?dive=wb3d7b' );
await phone.screenshot( { path: '/tmp/start-mp-phone.png' } );
await browser.close();
console.log( fails ? `${ fails } failed` : 'all passed' );
process.exit( fails ? 1 : 0 );
