import { GPU } from './gpu/GPU.js';
import { PerspectiveCamera } from './scene/Camera.js';
import { Scene } from './scene/Scene.js';
import { Timer } from './math/Timer.js';
import { MeshRenderer } from './render/MeshRenderer.js';
import { FrameUniforms } from './render/Frame.js';

// Canvas, device, main camera / scene and the frame loop.
export class Engine {

	constructor( container ) {

		this.container = container;
		this.renderScale = 1;
		this.clock = new Timer();
		this.frame = 0;
		this.onResize = [];

	}

	async init() {

		const canvas = document.createElement( 'canvas' );
		canvas.tabIndex = 0;
		this.container.appendChild( canvas );
		this.canvas = canvas;
		this.domElement = canvas;
		await GPU.init( { canvas } );
		this.meshRenderer = new MeshRenderer();
		this.meshRenderer.syncPipelines = false; // compile in the background (App.precompile waits for them)
		this.camera = new PerspectiveCamera( 62, window.innerWidth / window.innerHeight, 0.06, 60000 );
		this.scene = new Scene();
		window.addEventListener( 'resize', () => this.resize() );
		this.resize();

	}

	setRenderScale( s ) {

		this.renderScale = s;
		this.resize();

	}

	// output (canvas) size in pixels
	get width() {

		return this.canvas.width;

	}

	get height() {

		return this.canvas.height;

	}

	resize() {

		const w = window.innerWidth, h = window.innerHeight;
		const dpr = this.renderScale;
		this.canvas.width = Math.max( 1, Math.floor( w * dpr ) );
		this.canvas.height = Math.max( 1, Math.floor( h * dpr ) );
		this.canvas.style.width = w + 'px';
		this.canvas.style.height = h + 'px';
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		FrameUniforms.fields.outputResolution.value.set( this.canvas.width, this.canvas.height );
		for ( const f of this.onResize ) f( w, h );

	}

	// the canvas texture of this frame (render target of the final post pass)
	currentTexture() {

		return GPU.context.getCurrentTexture();

	}

	start( update ) {

		const loop = ( t ) => {

			this.clock.update( t );
			let dt = this.clock.getDelta();
			if ( dt > 0.1 ) dt = 0.1;
			this.frame ++;
			// the next frame is asked for first: an error in one frame's update is logged, and the
			// game goes on, where it would otherwise stop dead (no frame asked for after a throw)
			this._raf = requestAnimationFrame( loop );
			try {

				update( dt, this.clock.getElapsed() );

			} catch ( e ) {

				this.reportError( e );

			}

		};

		this._raf = requestAnimationFrame( loop );

	}

	// an error a frame threw: logged in full the first time, counted after (60 a second would bury
	// the console). frameErrors keeps the count, by message, for the debug overlay and tests.
	reportError( e ) {

		const key = String( e && e.stack || e ).split( '\n' ).slice( 0, 2 ).join( '\n' );
		const seen = this.frameErrors || ( this.frameErrors = new Map() );
		const n = ( seen.get( key ) || 0 ) + 1;
		seen.set( key, n );
		if ( n === 1 ) console.error( 'frame error (the game goes on):', e );
		else if ( n === 600 ) console.warn( `frame error repeated ${ n } times:`, key );

	}

	stop() {

		cancelAnimationFrame( this._raf );

	}

}
