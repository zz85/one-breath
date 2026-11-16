// Screenshot a page in headless Chromium once it sets window.__done, over the DevTools protocol
// (no puppeteer here): node test/shot.mjs <url> <out.png> [chrome binary]
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [ url, out ] = process.argv.slice( 2 );
const chrome = process.argv[ 4 ] || process.env.CHROME || `${ process.env.HOME }/.local/share/ms-playwright/chromium-1248/chrome-linux-arm64/chrome`;
const port = 9300 + Math.floor( Math.random() * 500 );
const proc = spawn( chrome, [ '--headless=new', '--no-sandbox', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
	'--window-size=1280,720', '--hide-scrollbars', `--remote-debugging-port=${ port }`, 'about:blank' ], { stdio: 'ignore' } );
const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );
let targets = null;
for ( let i = 0; i < 50 && ! targets; i ++ ) {

	await sleep( 200 );
	targets = await fetch( `http://127.0.0.1:${ port }/json` ).then( ( r ) => r.json() ).catch( () => null );

}

if ( ! targets ) { proc.kill(); throw new Error( 'chrome did not start' ); }
const ws = new WebSocket( targets.find( ( t ) => t.type === 'page' ).webSocketDebuggerUrl );
await new Promise( ( r ) => { ws.onopen = r; } );
let id = 0;
const pending = new Map();
ws.onmessage = ( e ) => {

	const m = JSON.parse( e.data );
	if ( m.id && pending.has( m.id ) ) { pending.get( m.id )( m ); pending.delete( m.id ); }
	// the page's console and errors, for shader compile messages
	if ( m.method === 'Runtime.consoleAPICalled' && m.params.type !== 'log' ) console.error( m.params.type, m.params.args.map( ( a ) => a.value ?? a.description ).join( ' ' ).slice( 0, 2000 ) );
	if ( m.method === 'Runtime.exceptionThrown' ) console.error( 'exception', m.params.exceptionDetails.text, m.params.exceptionDetails.exception?.description );

};
const send = ( method, params = {} ) => new Promise( ( r ) => { const i = ++ id; pending.set( i, r ); ws.send( JSON.stringify( { id: i, method, params } ) ); } );
const evalJs = async ( expression ) => ( await send( 'Runtime.evaluate', { expression, returnByValue: true } ) ).result?.result?.value;
await send( 'Page.enable' );
await send( 'Runtime.enable' );
await send( 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false } );
await send( 'Page.navigate', { url } );
let done = false;
if ( process.env.WAIT ) { await sleep( Number( process.env.WAIT ) ); done = true; }
for ( let i = 0; i < 600 && ! done; i ++ ) { await sleep( 250 ); done = await evalJs( 'window.__done === true' ); }
if ( ! done ) console.error( 'timed out waiting for window.__done' );
if ( process.env.CLICK ) { await evalJs( `document.querySelector( ${ JSON.stringify( process.env.CLICK ) } )?.click()` ); await sleep( 300 ); }
const shot = await send( 'Page.captureScreenshot', { format: 'png' } );
writeFileSync( out, Buffer.from( shot.result.data, 'base64' ) );
console.log( 'wrote', out, done ? '' : '(not done)' );
ws.close();
proc.kill();
