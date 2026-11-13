// Fall-damage system: cliff falls with gore screen effects, camera shake, and death → respawn.
//
// The player already has gravity in updateWalk() and a jump, but there is no damage. This module
// watches the player's vertical drop while airborne, and when they land after a dangerous height:
//   – a camera shake proportional to the impact
//   – a red flash and blood-spatter overlay on the HUD (higher falls → more opaque, longer)
//   – a bone-crack / thud sound (from SoundScape.fallImpact)
//   – above the lethal threshold: a death sequence — the view tumbles, the screen fades to red,
//     a "You died" message, then respawn at the nearest safe point
//
// Heights (metres):
//   0–3    no damage (a normal jump is ~1 m)
//   3–6    minor damage: a light red flash, short shake
//   6–10   serious: heavy overlay, longer shake, a limp
//   10+    lethal: the player dies and respawns
//
// Hooked into Game.update() after Player.update().

import { WORLD } from '../world/WorldLayout.js';

const SAFE_HEIGHT = 3;     // m of free fall before damage starts
const LETHAL_HEIGHT = 10;  // m fall that kills you
const DAMAGE_RANGE = LETHAL_HEIGHT - SAFE_HEIGHT; // used to normalise

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
		root.append( this.redEl, this.splatterEl, this.deathEl );

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

		// severity: 0 at SAFE_HEIGHT, 1 at LETHAL_HEIGHT, >1 above (clamped for effects)
		const raw = ( drop - SAFE_HEIGHT ) / DAMAGE_RANGE;
		this.severity = Math.min( raw, 1 );

		if ( raw >= 1 ) {

			this.die( player, audio );

		} else {

			this.impact( player, audio );

		}

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

	}

	// ---- per-frame update (called from Game.update, after Player.update)

	update( dt, player, audio ) {

		this.updateGore( dt );
		this.updateShake( dt, player );

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

}
