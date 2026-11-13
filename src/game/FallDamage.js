// Fall-damage system: cliff falls with gore screen effects, camera shake, and death → respawn.
//
// The player already has gravity in updateWalk() and a jump, but there is no damage. This module
// watches the player's vertical drop while airborne, and when they land after a dangerous height:
//   – a camera shake proportional to the impact
//   – a red flash and blood-spatter overlay on the HUD (higher falls → more opaque, longer)
//   – a bone-crack / thud sound (from SoundScape.fallImpact)
//   – the damage comes off a health bar (100). At 0 the death sequence runs — the view tumbles,
//     the screen fades to red, "You died", then respawn at the island start with half health
//   – health comes back very slowly by walking around (1 per 20 m), or by eating a fish from the
//     cooler (Game.eatFish)
//
// Damage: 10 per metre of drop past the first 3 m, so from full health
//   0–3 m   nothing (a normal jump is ~1 m)
//   5 m     20     a light red flash, short shake
//   10 m    70     heavy blood overlay, long shake, a limp
//   13 m+   100    dead (falls stack: two 8 m falls in a row kill you too)
//
// Hooked into Game.update() after Player.update().

import { WORLD } from '../world/WorldLayout.js';

const SAFE_HEIGHT = 3;     // m of free fall before damage starts
const DAMAGE_PER_M = 10;   // health lost per metre past SAFE_HEIGHT
const MAX_HEALTH = 100;
const LETHAL_HEIGHT = SAFE_HEIGHT + MAX_HEALTH / DAMAGE_PER_M; // kills from full health (13 m)
const REGEN_PER_M = 0.05;  // health per metre walked (1 per 20 m: really slow)
const RESPAWN_HEALTH = 50;
const LOW_HEALTH = 30;     // below this the screen edges stay red and you limp
const BAR_SHOW_S = 4;      // the bar stays up this long after a change at full health

// camera shake envelope
const SHAKE_DURATION = 0.6;  // seconds
const SHAKE_AMP = 0.04;      // radians at full severity
const DEATH_SHAKE_AMP = 0.12;

// gore overlay
const GORE_HOLD = 0.5;       // seconds at peak before fading
const GORE_FADE_OUT = 1.2;   // seconds to fade away

// death sequence
const DEATH_TUMBLE = 1.5;    // seconds of camera tumble
const DEATH_FADE = 1.0;      // seconds to full red / black
const DEATH_HOLD = 1.5;      // seconds on the death screen
const DEATH_RESPAWN = 0.8;   // seconds to fade back in

const CSS = /* css */`
.fd-gore { position: absolute; inset: 0; pointer-events: none; opacity: 0; z-index: 80; }
.fd-red { background: radial-gradient(ellipse at 50% 50%, rgba(120, 8, 8, 0) 30%, rgba(160, 0, 0, 0.7) 100%); }
.fd-splatter { background:
	radial-gradient(ellipse 45% 55% at 12% 18%, rgba(110, 0, 0, 0.85) 0%, transparent 70%),
	radial-gradient(ellipse 35% 42% at 88% 22%, rgba(90, 0, 0, 0.75) 0%, transparent 65%),
	radial-gradient(ellipse 50% 35% at 75% 82%, rgba(100, 0, 0, 0.70) 0%, transparent 60%),
	radial-gradient(ellipse 40% 50% at 20% 80%, rgba(130, 0, 0, 0.80) 0%, transparent 65%),
	radial-gradient(ellipse 30% 28% at 50% 10%, rgba(80, 0, 0, 0.65) 0%, transparent 55%),
	radial-gradient(ellipse 28% 35% at 45% 90%, rgba(100, 0, 0, 0.60) 0%, transparent 50%);
}
.fd-death { background: rgba(60, 0, 0, 1); display: flex; align-items: center; justify-content: center;
	font: 700 clamp(28px, 5vw, 64px) var(--tw-font, sans-serif); color: rgba(255, 180, 160, 0.9);
	letter-spacing: 0.04em; text-shadow: 0 0 40px rgba(180, 0, 0, 0.8); z-index: 90; }
.fd-death span { opacity: 0; transition: opacity 0.6s; }
.fd-low { background: radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 45%, rgba(110, 0, 0, 0.55) 100%); z-index: 79; }
.fd-hp { position: absolute; right: var(--tw-edge, 16px); top: calc(var(--tw-edge, 16px) + calc(56 * var(--tw-u, 1px)));
	display: flex; align-items: center; gap: var(--tw-2, 8px); padding: var(--tw-2, 8px) var(--tw-4, 16px); border-radius: 999px;
	font: 500 var(--tw-fs-md, 14px) var(--tw-font, sans-serif); color: var(--tw-ink, #fff); pointer-events: none;
	opacity: 0; transform: translateY(-6px); transition: opacity var(--tw-med, 300ms), transform var(--tw-med, 300ms); }
.fd-hp.is-on { opacity: 1; transform: none; }
.fd-hp-bar { width: calc(110 * var(--tw-u, 1px)); height: calc(7 * var(--tw-u, 1px)); border-radius: 99px; background: var(--tw-fill-2, rgba(255,255,255,0.15)); overflow: hidden; }
.fd-hp-bar > span { display: block; height: 100%; width: 100%; border-radius: inherit; background: #5fc46a; transition: width 250ms linear, background 400ms; }
.fd-hp.is-warn .fd-hp-bar > span { background: var(--tw-sun, #e8b04a); }
.fd-hp.is-bad .fd-hp-bar > span { background: #d23a2e; }
.fd-hp.is-bad { color: #ff9a8a; animation: fd-throb 1s ease-in-out infinite; }
.fd-hp b { font-family: var(--tw-mono, monospace); min-width: 2.2em; text-align: right; }
@keyframes fd-throb { 50% { transform: scale(1.04); } }
.fd-death.is-on span { opacity: 1; }
`;

const h = ( tag, cls, html ) => {

	const e = document.createElement( tag );
	if ( cls ) e.className = cls;
	if ( html !== undefined ) e.innerHTML = html;
	return e;

};

export class FallDamage {

	constructor() {

		// fall tracking (set by Player, read here)
		this.tracking = false;  // whether the player is airborne after leaving a high edge
		this.fallStart = 0;     // y at the moment they left the ground
		this.highestY = 0;      // peak y during the fall (in case they jump up first)

		// health
		this.health = MAX_HEALTH;
		this._barT = 0;         // keeps the bar on after a change
		this._lastPos = null;   // for walking regen

		// damage state
		this.severity = 0;      // 0–1, how bad the last impact was (0 = none, 1 = lethal)
		this.dead = false;
		this.deathT = 0;        // time into the death sequence
		this.respawning = false;
		this.respawnT = 0;

		// screen effects
		this.shakeT = 0;        // time remaining on camera shake
		this.shakeAmp = 0;      // current shake amplitude (radians)
		this.goreT = 0;         // time into the gore overlay animation
		this.goreAlpha = 0;     // current overlay opacity (0–1)
		this.gorePeak = 0;      // peak opacity for this impact

		// DOM elements (created in attach())
		this.redEl = null;
		this.splatterEl = null;
		this.deathEl = null;
		this.lowEl = null;
		this.hpEl = null;
		this.onDeath = null;    // callbacks (Game: toasts)
		this.onHurt = null;
		this._cssAdded = false;

	}

	// called once when the HUD root is available (from Game)
	attach( root ) {

		if ( ! this._cssAdded && typeof document !== 'undefined' ) {

			const style = h( 'style' );
			style.textContent = CSS;
			document.head.append( style );
			this._cssAdded = true;

		}

		this.redEl = h( 'div', 'fd-gore fd-red' );
		this.splatterEl = h( 'div', 'fd-gore fd-splatter' );
		this.deathEl = h( 'div', 'fd-gore fd-death', '<span>YOU DIED</span>' );
		this.lowEl = h( 'div', 'fd-gore fd-low' );
		this.hpEl = h( 'div', 'fd-hp tw-glass', '<span>Health</span><span class="fd-hp-bar"><span></span></span><b>100</b>' );
		this.hpBar = this.hpEl.querySelector( '.fd-hp-bar > span' );
		this.hpNum = this.hpEl.querySelector( 'b' );
		root.append( this.lowEl, this.redEl, this.splatterEl, this.deathEl, this.hpEl );

	}

	// ---- called by Player.updateWalk() each frame

	// the player just left the ground (or jumped)
	beginFall( y ) {

		if ( this.dead ) return;
		this.tracking = true;
		this.fallStart = y;
		this.highestY = y;

	}

	// still airborne
	airborne( y ) {

		if ( ! this.tracking ) return;
		if ( y > this.highestY ) this.highestY = y;

	}

	// the player just landed
	land( y, player, audio ) {

		if ( ! this.tracking || this.dead ) return;
		this.tracking = false;
		const drop = this.highestY - y;
		if ( drop < SAFE_HEIGHT ) return;
		this.damage( ( drop - SAFE_HEIGHT ) * DAMAGE_PER_M, player, audio );

	}

	// take `amount` off the health bar, with the effects of a hit that size
	damage( amount, player, audio ) {

		if ( this.dead || amount <= 0 ) return;
		this.lastDamage = amount;
		this.health = Math.max( 0, this.health - amount );
		this._barT = BAR_SHOW_S;
		// effects scale with the hit: 70 (a 10 m fall) is the full splatter
		this.severity = Math.min( 1, amount / 70 );
		if ( this.health <= 0 ) this.die( player, audio );
		else {

			this.impact( player, audio );
			if ( this.onHurt ) this.onHurt( amount, this.health );

		}

	}

	// health back (eating, first aid); returns what it actually added
	heal( amount ) {

		if ( this.dead ) return 0;
		const before = this.health;
		this.health = Math.min( MAX_HEALTH, this.health + Math.max( 0, amount ) );
		if ( this.health !== before ) this._barT = BAR_SHOW_S;
		return this.health - before;

	}

	get full() {

		return this.health >= MAX_HEALTH;

	}

	// 1 healthy .. 0.55 at the edge of death: how fast you can walk
	get limp() {

		return this.health >= LOW_HEALTH ? 1 : 0.55 + 0.45 * this.health / LOW_HEALTH;

	}

	// ---- non-lethal impact

	impact( player, audio ) {

		// screen shake
		this.shakeT = SHAKE_DURATION * ( 0.4 + 0.6 * this.severity );
		this.shakeAmp = SHAKE_AMP * this.severity;

		// gore overlay: instant flash
		this.gorePeak = 0.3 + 0.7 * this.severity;
		this.goreT = 0;
		this.goreAlpha = this.gorePeak;

		// brief slowdown (the player limps for a moment)
		player.velocity.x *= 0.3;
		player.velocity.z *= 0.3;

		// sound
		if ( audio && audio.fallImpact ) audio.fallImpact( this.severity );

	}

	// ---- lethal fall

	die( player, audio ) {

		this.dead = true;
		this.deathT = 0;

		// stop the player
		player.frozen = true;
		player.velocity.set( 0, 0, 0 );

		// big shake
		this.shakeT = DEATH_TUMBLE;
		this.shakeAmp = DEATH_SHAKE_AMP;

		// full gore
		this.gorePeak = 1;
		this.goreT = 0;
		this.goreAlpha = 1;

		// sound
		if ( audio && audio.fallImpact ) audio.fallImpact( 1 );
		if ( this.onDeath ) this.onDeath();

	}

	// ---- per-frame update (called from Game.update, after Player.update)

	update( dt, player, audio ) {

		this.updateGore( dt );
		this.updateShake( dt, player );
		this.updateRegen( player );
		this.updateBar( dt );

		if ( this.dead ) {

			this.deathT += dt;

			// phase 1: tumble (camera shake handles it)
			// phase 2: fade to death screen
			if ( this.deathT > DEATH_TUMBLE ) {

				const fadeT = this.deathT - DEATH_TUMBLE;
				const fade = Math.min( 1, fadeT / DEATH_FADE );
				if ( this.deathEl ) {

					this.deathEl.style.opacity = fade.toFixed( 3 );
					if ( fade > 0.6 ) this.deathEl.classList.add( 'is-on' );

				}

			}

			// phase 3: hold the death screen, then respawn
			const totalDeath = DEATH_TUMBLE + DEATH_FADE + DEATH_HOLD;
			if ( this.deathT > totalDeath && ! this.respawning ) {

				this.respawning = true;
				this.respawnT = 0;
				this.respawn( player );

			}

			if ( this.respawning ) {

				this.respawnT += dt;
				const fade = 1 - Math.min( 1, this.respawnT / DEATH_RESPAWN );
				if ( this.deathEl ) this.deathEl.style.opacity = fade.toFixed( 3 );
				if ( this.redEl ) this.redEl.style.opacity = ( fade * 0.3 ).toFixed( 3 );
				if ( this.splatterEl ) this.splatterEl.style.opacity = ( fade * 0.4 ).toFixed( 3 );

				if ( this.respawnT > DEATH_RESPAWN ) {

					// fully alive again
					this.dead = false;
					this.respawning = false;
					this.severity = 0;
					this.health = RESPAWN_HEALTH;
					this._barT = BAR_SHOW_S;
					this.goreAlpha = 0;
					player.frozen = false;
					if ( this.deathEl ) {

						this.deathEl.style.opacity = '0';
						this.deathEl.classList.remove( 'is-on' );

					}

				}

			}

		}

	}

	updateGore( dt ) {

		if ( this.dead && ! this.respawning ) {

			// during death: keep at full
			if ( this.redEl ) this.redEl.style.opacity = '1';
			if ( this.splatterEl ) this.splatterEl.style.opacity = Math.min( 1, this.severity ).toFixed( 3 );
			return;

		}

		if ( this.goreAlpha <= 0 && ! this.respawning ) return;

		this.goreT += dt;

		if ( ! this.dead ) {

			// non-lethal: hold then fade out
			if ( this.goreT < GORE_HOLD * this.severity ) {

				this.goreAlpha = this.gorePeak;

			} else {

				const fadeT = this.goreT - GORE_HOLD * this.severity;
				this.goreAlpha = this.gorePeak * Math.max( 0, 1 - fadeT / ( GORE_FADE_OUT * ( 0.5 + 0.5 * this.severity ) ) );

			}

		}

		if ( this.redEl ) this.redEl.style.opacity = this.goreAlpha.toFixed( 3 );
		if ( this.splatterEl ) this.splatterEl.style.opacity = ( this.goreAlpha * this.severity * 0.8 ).toFixed( 3 );

	}

	// walking around slowly mends you: health for each metre walked on your feet
	updateRegen( player ) {

		const p = player.position;
		const walking = player.mode === 'walk' && player.grounded && ! this.dead;
		if ( walking && this._lastPos && this.health < MAX_HEALTH ) {

			const d = Math.hypot( p.x - this._lastPos.x, p.z - this._lastPos.z );
			// a respawn or teleport isn't a walk
			if ( d < 2 ) this.health = Math.min( MAX_HEALTH, this.health + d * REGEN_PER_M );

		}

		this._lastPos = walking ? { x: p.x, z: p.z } : null;

	}

	updateBar( dt ) {

		this._barT = Math.max( 0, this._barT - dt );
		if ( ! this.hpEl ) return;
		const hp = this.health;
		this.hpEl.classList.toggle( 'is-on', hp < MAX_HEALTH || this._barT > 0 );
		this.hpEl.classList.toggle( 'is-warn', hp < 60 && hp >= LOW_HEALTH );
		this.hpEl.classList.toggle( 'is-bad', hp < LOW_HEALTH );
		this.hpBar.style.width = `${ hp / MAX_HEALTH * 100 }%`;
		this.hpNum.textContent = String( Math.ceil( hp ) );
		// badly hurt: the screen edges stay red
		if ( this.lowEl ) this.lowEl.style.opacity = this.dead ? '0' : ( Math.max( 0, 1 - hp / LOW_HEALTH ) * 0.9 ).toFixed( 3 );

	}

	updateShake( dt, player ) {

		if ( this.shakeT <= 0 ) return;
		this.shakeT -= dt;
		if ( this.shakeT <= 0 ) {

			this.shakeT = 0;
			return;

		}

		// decaying sinusoidal shake
		const maxT = this.dead ? DEATH_TUMBLE : SHAKE_DURATION;
		const decay = this.shakeT / maxT;
		const freq = this.dead ? 4 : 18; // death is a slow tumble; impact is a fast jitter
		const t = maxT - this.shakeT;
		const amp = this.shakeAmp * decay;
		const sx = Math.sin( t * freq * 1.0 ) * amp;
		const sy = Math.sin( t * freq * 1.3 + 1.7 ) * amp * 0.7;
		// apply as pitch/yaw offsets (the Player sets the camera after its update, then we nudge it)
		player.pitch += sx;
		player.yaw += sy;

	}

	// ---- respawn: put the player back at a safe point

	respawn( player ) {

		const start = WORLD.start || WORLD.spawn;
		player.position.copy( start.position );
		// put them on the ground at the spawn
		const g = player.groundAt( player.position.x, player.position.z, player.position.y + 5 );
		player.position.y = Math.max( g, player.terrain.heightAt( player.position.x, player.position.z ) );
		player.velocity.set( 0, 0, 0 );
		player.grounded = true;
		player.mode = 'walk';
		// reset the camera offset so it doesn't ease from the cliff top
		player._camY = null;

	}

	// ---- for tests: the thresholds
	static get SAFE_HEIGHT() { return SAFE_HEIGHT; }
	static get LETHAL_HEIGHT() { return LETHAL_HEIGHT; }
	static get MAX_HEALTH() { return MAX_HEALTH; }
	static get RESPAWN_HEALTH() { return RESPAWN_HEALTH; }
	static get REGEN_PER_M() { return REGEN_PER_M; }

}
