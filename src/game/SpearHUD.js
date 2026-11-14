// DOM for spearfishing, in the look of the rest of the HUD (ui/ui.css tokens, .tw-glass):
//   bottom left   the freediving computer on your wrist: depth, dive time, max depth of the dive,
//                 the surface interval, and the urge to breathe as you feel it (not your oxygen:
//                 no diver can read that, and the danger is that it doesn't hurt)
//   beside it     the gun: one pip per band (loaded / loading / slack) and whether the shaft is home
//   bottom centre one line about the fish on the line, in place of a tension gauge: what it does
//                 ("Pulling hard", "Holed up in the reef") and the warnings that matter (the shaft
//                 tearing out); and where your gun or float is while you've let go
//   full screen   tunnel vision as the oxygen runs low, a pulse at each contraction, and the fade to
//                 black of a blackout
const CSS = /* css */`
.sp-watch { position: absolute; left: var(--tw-edge); bottom: var(--tw-edge); display: flex; gap: var(--tw-4); align-items: center;
	padding: var(--tw-3) var(--tw-4); border-radius: var(--tw-r-lg, 14px); font: 500 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink);
	opacity: 0; transform: translateY(8px); transition: opacity var(--tw-med) var(--tw-ease), transform var(--tw-med) var(--tw-ease); pointer-events: none; }
.sp-watch.is-on { opacity: 1; transform: none; }
.sp-depth { font: 600 calc(30 * var(--tw-u)) var(--tw-mono); letter-spacing: -0.02em; min-width: calc(92 * var(--tw-u)); text-align: right; }
.sp-depth small { font-size: 0.45em; color: var(--tw-ink-3); margin-left: 2px; }
.sp-col { display: flex; flex-direction: column; gap: 3px; font-family: var(--tw-mono); font-size: var(--tw-fs-sm); color: var(--tw-ink-2); }
.sp-col b { color: var(--tw-ink); font-weight: 600; }
.sp-urge { display: flex; flex-direction: column; gap: 4px; width: calc(120 * var(--tw-u)); font-size: var(--tw-fs-sm); color: var(--tw-ink-3); }
.sp-urge-bar { height: calc(5 * var(--tw-u)); border-radius: 99px; background: var(--tw-fill-2); overflow: hidden; }
.sp-urge-bar > span { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--tw-aqua); transition: width 200ms linear, background 400ms; }
.sp-urge.is-warn .sp-urge-bar > span { background: var(--tw-sun); }
.sp-urge.is-bad .sp-urge-bar > span { background: var(--tw-coral); }
.sp-urge.is-bad { color: var(--tw-coral); }
.sp-gun { display: flex; gap: 6px; align-items: center; padding-left: var(--tw-3); border-left: 1px solid var(--tw-line); font-size: var(--tw-fs-sm); color: var(--tw-ink-3); }
.sp-gun.is-off { display: none; }
.sp-pip { width: calc(9 * var(--tw-u)); height: calc(22 * var(--tw-u)); border-radius: 4px; background: var(--tw-fill-2); position: relative; overflow: hidden; }
.sp-pip > span { position: absolute; left: 0; right: 0; bottom: 0; height: 0; background: #d0802c; }
.sp-pip.is-loaded > span { height: 100%; }
.sp-shaft { margin-left: 4px; }
.sp-shaft.is-out { color: var(--tw-sun); }
.sp-cue { position: absolute; left: 50%; bottom: calc(max(calc(72 * var(--tw-u)), 13vh) + calc(58 * var(--tw-u))); transform: translate(-50%, 6px);
	padding: var(--tw-2) var(--tw-4); border-radius: 999px; font: 600 var(--tw-fs-md) var(--tw-font); color: var(--tw-ink); white-space: nowrap;
	opacity: 0; transition: opacity var(--tw-fast), transform var(--tw-med) var(--tw-ease); pointer-events: none; }
.sp-cue.is-on { opacity: 1; transform: translate(-50%, 0); }
.sp-cue.is-warn { color: var(--tw-sun); }
.sp-cue.is-bad { color: var(--tw-coral); animation: sp-throb 0.6s ease-in-out infinite; }
.sp-cue.is-good { color: var(--tw-aqua); }
@keyframes sp-throb { 50% { transform: translate(-50%, 0) scale(1.05); } }
.sp-tunnel { position: absolute; inset: 0; pointer-events: none; opacity: 0;
	background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) calc(var(--r, 70) * 1%), rgba(4,8,12,0.94) calc(var(--r, 70) * 1% + 22%)); }
.sp-pulse { position: absolute; inset: 0; pointer-events: none; opacity: 0; box-shadow: inset 0 0 calc(160 * var(--tw-u)) rgba(120, 10, 20, 0.55); }
.sp-black { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: #000; }
`;

const h = ( tag, cls, html ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html !== undefined ) e.innerHTML = html;
	return e;

};

const mmss = ( s ) => `${ Math.floor( s / 60 ) }:${ String( Math.floor( s % 60 ) ).padStart( 2, '0' ) }`;

export class SpearHUD {

	constructor( root ) {

		const style = h( 'style' );
		style.textContent = CSS;
		document.head.append( style );
		this.tunnel = h( 'div', 'sp-tunnel' );
		this.pulse = h( 'div', 'sp-pulse' );
		this.black = h( 'div', 'sp-black' );
		this.cueEl = h( 'div', 'sp-cue tw-glass' );
		this._cue = '';
		this.watch = h( 'div', 'sp-watch tw-glass', `
			<div class="sp-depth">0.0<small>m</small></div>
			<div class="sp-col"><span>DIVE <b class="sp-time">0:00</b></span><span>MAX <b class="sp-max">0.0 m</b></span><span>SURF <b class="sp-si">0:00</b></span></div>
			<div class="sp-urge"><span class="sp-urge-label">Breath</span><span class="sp-urge-bar"><span></span></span></div>
			<div class="sp-gun"><span class="sp-pips"></span><span class="sp-shaft">shaft in</span></div>` );
		this.depthEl = this.watch.querySelector( '.sp-depth' );
		this.timeEl = this.watch.querySelector( '.sp-time' );
		this.maxEl = this.watch.querySelector( '.sp-max' );
		this.siEl = this.watch.querySelector( '.sp-si' );
		this.urgeEl = this.watch.querySelector( '.sp-urge' );
		this.urgeLabel = this.watch.querySelector( '.sp-urge-label' );
		this.urgeBar = this.watch.querySelector( '.sp-urge-bar > span' );
		this.gunEl = this.watch.querySelector( '.sp-gun' );
		this.pipsEl = this.watch.querySelector( '.sp-pips' );
		this.shaftEl = this.watch.querySelector( '.sp-shaft' );
		this._pips = - 1;
		this._show = 0;
		root.append( this.tunnel, this.pulse, this.black, this.watch, this.cueEl );

	}

	update( dt, { apnea, depth, under, gun, contraction, blackout, cue = null } ) {

		const key = cue ? `${ cue.level }|${ cue.text }` : '';
		if ( key !== this._cue ) {

			this._cue = key;
			if ( cue ) {

				this.cueEl.textContent = cue.text;
				this.cueEl.className = `sp-cue tw-glass is-on${ cue.level ? ' is-' + cue.level : '' }`;

			} else this.cueEl.classList.remove( 'is-on' );

		}


		// the watch: under water, or for a while after surfacing (the surface interval)
		this._show = under ? 8 : Math.max( 0, this._show - dt );
		this.watch.classList.toggle( 'is-on', this._show > 0 || !! gun );
		this.depthEl.firstChild.textContent = ( under ? depth : 0 ).toFixed( 1 );
		this.timeEl.textContent = mmss( under ? apnea.diveTime : apnea.lastDive ? apnea.lastDive.time : 0 );
		this.maxEl.textContent = `${ ( under ? apnea.maxDepth : apnea.lastDive ? apnea.lastDive.depth : 0 ).toFixed( 1 ) } m`;
		this.siEl.textContent = mmss( under ? 0 : apnea.surfaceTime );
		const u = apnea.urge;
		// at the top the bar refills as you rest: full only after twice as long as you were down
		const fill = under ? 1 - u : Math.min( 1 - u, apnea.restProgress );
		const recovering = ! under && fill < 0.98;
		this.urgeBar.style.width = `${ Math.max( 0, fill ) * 100 }%`;
		this.urgeEl.classList.toggle( 'is-warn', u > 0.45 && u <= 0.7 );
		this.urgeEl.classList.toggle( 'is-bad', u > 0.7 );
		this.urgeLabel.textContent = ! under ? ( recovering ? 'Breathe up…' : 'Breath' ) : u > 0.7 ? 'Contractions · go up' : u > 0.45 ? 'The urge to breathe' : 'Breath';

		this.gunEl.classList.toggle( 'is-off', ! gun );
		if ( gun ) {

			if ( this._pips !== gun.bands ) {

				this._pips = gun.bands;
				this.pipsEl.innerHTML = '<span class="sp-pip"><span></span></span>'.repeat( gun.bands );

			}

			const pips = this.pipsEl.children;
			for ( let k = 0; k < pips.length; k ++ ) {

				pips[ k ].classList.toggle( 'is-loaded', k < gun.loaded );
				pips[ k ].firstChild.style.height = k < gun.loaded ? '' : k === gun.loaded ? `${ gun.loadT * 100 }%` : '0';

			}

			this.shaftEl.textContent = gun.shaftOut ? 'shaft out' : 'shaft in';
			this.shaftEl.classList.toggle( 'is-out', gun.shaftOut );

		}

		// hypoxia: the field of view closes in; contractions: a dark red pulse at the edges
		const hx = apnea.hypoxia;
		this.tunnel.style.opacity = Math.min( 1, hx * 1.4 ).toFixed( 3 );
		this.tunnel.style.setProperty( '--r', ( 62 - hx * 52 ).toFixed( 1 ) );
		this.pulse.style.opacity = ( contraction * Math.min( 1, u ) ).toFixed( 3 );
		this.black.style.opacity = blackout.toFixed( 3 );

	}

}
