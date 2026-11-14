import { Vector3 } from '../engine/index.js';
import { SpearGun } from './SpearGun.js';
import { SpearAudio } from '../audio/SpearAudio.js';
import { SpearHUD } from './SpearHUD.js';
import { hitTest, zoneOf, ZONES, penetration, stepShaft, SpearFight, Apnea, judge, weightKg, swimmerInfo, maxRadius, whaleShaft, PPO2_BLACKOUT } from './Spear.js';

const CATCH_CARD_MS = 9000;
const RESPAWN_S = 300; // a taken fish's place in its school is filled again after this (game seconds)
const BAND_LOAD_S = 1.35; // pulling one band back to its fin under water
const SECURE_M = 1.05; // line left when the fish is in reach
const WHALE_HOLD_S = 0.45; // a 30 t whale on a tight line: this long before the shaft rips out
const REACH_M = 1.3; // a hand on a fish in a hole, a gun, a float
// fish that bolt into the reef when speared: the chance of it, where there's a coral head near
const HOLERS = { grouper: 0.85, yellowtail: 0.4, pierSnapper: 0.4 };

const _a = new Vector3(), _b = new Vector3(), _v = new Vector3(), _p = new Vector3(), _h = new Vector3(), _t = new Vector3();
const _pull = { x: 0, y: 0, z: 0 };

// Spearfishing on top of the world (in place of the rod):
//   G          take out / put away the speargun
//   hold R     load a band (pull it back to the shaft's fin); a two-band gun takes two pulls
//   hold RMB   aim: the gun comes up under your eye, steadier, the shaft lined up with the view
//   LMB        shoot (only with the muzzle under water)
//   hold LMB   haul the shooting line in hand over hand: the shaft after a miss, or the fish
//   E          grab a fish that's in reach and dispatch it; it goes on the stringer. Also: reach into
//              the reef for a fish holed up there, take your gun back, grab the float line
//   G          (a fish on) let go of the gun: the fish tows it, and on a float line the float, which
//              tires it at the surface; hold LMB on the float line to pull it in from the top
// Every dive is a breath-hold (Spear.js Apnea): the urge to breathe, contractions, tunnel vision,
// and a blackout if you push it, most likely on the way up.
// a left click with the gun down: how long the gun takes to come up to the eye before it shoots (s)
const AIM_UP_S = 0.25;

export class Spearfishing {

	constructor( game ) {

		this.game = game;
		this.app = game.app;
		const app = this.app;
		this.gun = new SpearGun( { scene: app.scene, camera: app.camera } );
		this.sfx = new SpearAudio( app.audio );
		this.apnea = new Apnea();
		this.apnea.onContraction = ( u ) => {

			this.contraction = 1;
			this.sfx.heartbeat( Math.min( 1, u ) );

		};

		this.hud = null;
		this.phase = 'home'; // home | flying | out | fight | loose | whale | blackout
		// let go of the gun: { gun: { p, v } (its muzzle), float: null | { p, v, lineOut, lineM, held, hauling } }
		this.loose = null;
		this._resume = 'home'; // the phase a blackout returns to
		this.rng = Math.random;
		this.whaleHit = null; // the shaft lodged in the whale: { k, tip, dir (frame k's rest space), t, reelOut, tightT }
		this.shaftVel = new Vector3();
		this.shaftStuck = false;
		this.fight = null; // SpearFight
		this.target = null; // { i, behaviour, info, L, kg, zone, rule, local: { pos, dir } }
		this.card = null;
		this.gone = []; // { i, t } fish taken out of their school, waiting to be replaced
		this.contraction = 0;
		this.blackT = 0;
		this.loading = false;
		this.aiming = false;
		this.aimLatched = false;
		this._aimTold = false;
		this.waterY = 0;
		this._beatT = 0;
		this._lastUnder = false;
		this._fishHooked = false;
		this.stats = null;
		// practice mode (?hunt, game/Practice.js): { calm, air } fish that let you close, endless breath
		this.practice = null;
		// false in the freediving modes (game/Mode.js): no speargun
		this.allowGun = true;
		// Easy (game/Mode.js): no blackout, calmer fish, a steadier aim, warnings instead of fines
		this.easy = false;
		this._assist = false;

	}

	get fish() {

		const r = this.app.reef;
		return r && r.fish ? r.fish : null;

	}

	get equipped() {

		return this.gun.equipped;

	}

	// a line out or a fish on: the boat / ashore prompts give way
	get busy() {

		return this.phase !== 'home' || this.loading;

	}

	// the fish on the line, in the guide's and the HUD's terms (null while none is on)
	get fightView() {

		const f = this.fight;
		if ( ! f || ( this.phase !== 'fight' && this.phase !== 'loose' && ! ( this.phase === 'blackout' && this.loose ) ) ) return null;
		return {
			big: f.big, quick: f.quick, stoned: f.stoned, holed: f.wedged, going: f.holeState === 'going', wedge: f.wedge,
			tension: f.tension / f.holdN, tear: f.tear, surge: f.surge, distance: f.lineOut, loose: !! this.loose,
		};

	}

	// where the diver's hand is (the gun's line clip when it's in hand)
	hand( out ) {

		if ( ! this.loose ) return out.copy( this.gun.lineClip );
		const c = this.app.camera;
		c.getWorldDirection( out );
		return out.multiplyScalar( 0.45 ).add( c.position ).setY( c.position.y - 0.2 );

	}

	// distance from the diver's free hand (by the face) to the fish on the line: reaching into a hole
	reachDistance() {

		const F = this.fight, c = this.app.camera;
		if ( ! F ) return Infinity;
		c.getWorldDirection( _t ).multiplyScalar( 0.45 ).add( c.position );
		_t.y -= 0.2;
		return Math.hypot( F.p.x - _t.x, F.p.y - _t.y, F.p.z - _t.z );

	}

	// distance from the hand to the fish on the line
	fishDistance() {

		const F = this.fight;
		if ( ! F ) return Infinity;
		this.hand( _t );
		return Math.hypot( F.p.x - _t.x, F.p.y - _t.y, F.p.z - _t.z );

	}

	applyGear( s ) {

		this.stats = s;
		this.gun.setGear( { gunM: s.gunM, bands: s.bands, gunKind: s.gunKind } );
		this.apnea.holdS = s.holdS;
		if ( this.app.player ) this.app.player.swimMul = s.swimMul;

	}

	get lineMax() {

		const s = this.stats;
		return s.lineWraps * 2 * s.gunM + 0.6;

	}

	equip( on ) {

		const g = this.gun;
		if ( on === g.equipped ) return;
		g.equipped = on;
		g.state = 'idle';
		if ( ! on ) this.loading = false;
		if ( on && this.app.audio && this.app.audio.rodReady ) this.app.audio.rodReady();

	}

	toast( text, ms ) {

		this.game.toast( text, ms );

	}

	floorAt( x, z ) {

		const app = this.app;
		let y = app.terrainData.heightAt( x, z );
		if ( app.reef && app.reef.floorHeightAt ) y = Math.max( y, app.reef.floorHeightAt( x, z ) );
		return y;

	}

	// ---------------------------------------------------------------- per frame
	update( dt, { can, lDown, lHeld, rHeld, panelOpen } ) {

		const app = this.app, p = app.player, inp = app.input, gun = this.gun;
		if ( ! this.hud && this.game.hud ) this.hud = new SpearHUD( this.game.hud.ui.hud || this.game.hud.ui.root );
		if ( this.fish && ! this.fish.onStep ) this.fish.onStep = ( h ) => this.moveFish( h );
		this.waterY = Number.isFinite( p.waterH ) ? p.waterH : 0;
		inp.lookScale = 1;
		const camUnder = app.camera.position.y < this.waterY - 0.12;
		const swimming = p.mode === 'swim';

		// ---- breath-hold
		const speed = p.velocity.length();
		let effort = 1 + 0.32 * speed;
		if ( this.loading ) effort += 1.1;
		if ( this.phase === 'fight' && this.fight ) effort += ( this.fight.big ? 0.5 : 0.2 ) + Math.min( 1.5, this.fight.tension / 160 );
		if ( this.loose && this.loose.float && this.loose.float.held && this.fight ) effort += Math.min( 1, ( this.fight.handTension || 0 ) / 200 );
		if ( this.aiming && speed < 0.4 ) effort -= 0.15; // still, waiting for the fish to come in
		const under = swimming && camUnder && ! app.freeCam && this.phase !== 'blackout';
		const depth = Math.max( 0, this.waterY - app.camera.position.y );
		const wasUnder = this.apnea.under;
		this.apnea.update( dt, { under, depth, effort } );
		// diving again before resting twice as long as the last dive: this breath-hold runs short
		if ( under && ! wasUnder && this.apnea._penalty > 0.08 ) this.toast( `Down again after ${ Math.round( this.apnea.surfaceTimeBefore || 0 ) } s · rest 2:1 or this dive runs short`, 3500 );
		if ( this.practice && this.practice.air ) {

			this.apnea.o2 = 0.21;
			this.apnea.co2 = 0;

		}

		// Easy: the oxygen never falls to where the way up would black you out (the surface's
		// pressure is the lowest, so a floor above the blackout there holds all the way up). As it
		// gets close, your buddy takes you up; a fish on the line stays on.
		if ( this.easy ) {

			const floor = PPO2_BLACKOUT * 1.2;
			this.apnea.o2 = Math.max( this.apnea.o2, floor );
			this.apnea.blackout = false;
			if ( under && this.apnea.o2 < floor * 1.15 ) {

				if ( ! this._assist ) this.toast( 'Out of breath · your buddy is taking you up', 2600 );
				this._assist = true;

			} else if ( ! under ) this._assist = false;

		} else this._assist = false;

		if ( ! under && this._lastUnder && this.apnea.lastDive && this.apnea.lastDive.time > 25 ) this.sfx.gasp( Math.min( 1, this.apnea.lastDive.time / 60 ) );
		this._lastUnder = under;
		if ( this.apnea.blackout && this.phase !== 'blackout' ) this.startBlackout();
		if ( this.phase === 'blackout' ) {

			this.updateBlackout( dt );
			if ( this.loose ) this.updateLoose( dt, false );
			this.updateHUD( dt, depth, under );
			gun.update( dt, { visible: false } );
			return;

		}

		// the fish are warier of a diver finning hard than of one gliding still; at the surface the
		// splashing scares them from farther
		if ( this.fish ) this.fish.wary = Math.max( 0.5, Math.min( 1.7, ( camUnder ? 0.55 : 0.9 ) + 0.4 * speed + ( this.loading ? 0.25 : 0 ) ) );
		if ( this.fish && this.easy ) this.fish.wary = Math.min( this.fish.wary, 0.4 ); // they let you within about 2 m
		if ( this.fish && this.practice && this.practice.calm ) this.fish.wary = 0.25;
		if ( this.fish ) this.fish.curious = camUnder && speed < 0.35 && this.phase === 'home' && ! this.loading;

		// ---- equip
		if ( inp.hit( 'KeyG' ) && can && ( this.allowGun || gun.equipped ) ) {

			if ( this.phase === 'fight' ) this.letGo();
			else if ( this.loose ) this.toast( this.loose.float ? 'Your gun is out on the float line · grab the float (E)' : 'Your gun is out on the fish\'s line · swim to it and grab it (E)', 2400 );
			else {

				this.equip( ! gun.equipped );
				this.toast( gun.equipped ? ( gun.bandsLoaded ? 'Speargun out · hold the left button to aim, let go to shoot' : 'Speargun out · hold R to load the bands' ) : 'Speargun away', 1800 );

			}

		}

		if ( ! can && gun.equipped ) {

			// at the helm, the free camera: a fish in hand goes out on the line; a float line in hand slips
			if ( this.phase === 'fight' ) this.letGo( true );
			if ( this.loose ) {

				if ( this.loose.float ) this.loose.float.held = false;

			} else {

				if ( this.phase !== 'home' ) this.shaftHomeNow();
				this.equip( false );

			}

		}

		// ---- the catch card (dismiss: click, E, Esc, or it times out)
		if ( this.card ) {

			this.card.t += dt;
			if ( ( lDown && this.card.t > 0.3 ) || inp.hit( 'KeyE' ) || inp.hit( 'Escape' ) || this.card.t > CATCH_CARD_MS / 1000 ) this.endCard();

		}

		// ---- input
		const act = gun.equipped && ! panelOpen && ! this.card;
		// aim: hold the right button, or Q (a trackpad, the touch Aim button) to raise / lower the gun
		if ( act && inp.hit( 'KeyQ' ) ) {

			this.aimLatched = ! this.aimLatched;
			if ( this.aimLatched && ! this._aimTold ) {

				this._aimTold = true;
				this.toast( 'Aiming · Q again to lower the gun', 1600 );

			}

		}

		if ( ! gun.equipped ) this.aimLatched = false;
		// the left button alone also works (a trackpad, one-button players): press raises the gun to
		// the eye, release shoots; a quick click shoots once the gun is up (AIM_UP_S). With the gun
		// already up (right button or Q) a press shoots at once, as before.
		const raised = act && ( ( inp.rightDown && inp.enabled ) || this.aimLatched ) && this.phase === 'home';
		if ( act && lDown && this.phase === 'home' ) {

			const ready = gun.bandsLoaded > 0 && gun.muzzle.y <= this.waterY - 0.08;
			if ( raised || ! ready ) this.fire(); // fire() says why it can't shoot
			else this._press = { t: 0, released: false };

		}

		if ( this._press && ( ! act || this.phase !== 'home' ) ) this._press = null;
		if ( this._press ) {

			this._press.t += dt;
			if ( ! lHeld ) this._press.released = true;

		}

		this.aiming = raised || !! this._press;
		// down the shaft the view turns slower: fine aim with a mouse, a trackpad or a finger
		inp.lookScale = this.aiming ? 0.45 : 1;
		this.loading = act && rHeld && this.phase === 'home' && gun.bandsLoaded < this.stats.bands;
		if ( this.loading ) {

			if ( gun.loadT === 0 ) this.sfx.stretch( gun.bandsLoaded );
			gun.loadT += dt / ( BAND_LOAD_S * ( this.stats.gunKind === 'carbon' ? 1.2 : 1 ) * ( camUnder ? 1 : 0.8 ) );
			if ( gun.loadT >= 1 ) {

				gun.loadT = 0;
				gun.bandsLoaded ++;
				this.sfx.hook();
				if ( gun.bandsLoaded === this.stats.bands ) this.toast( this.stats.bands > 1 ? 'Both bands loaded' : 'Loaded', 1200 );

			}

		} else gun.loadT = Math.max( 0, gun.loadT - dt * 2 ); // let go half way: the band slips back

		if ( this._press && this._press.released && this._press.t >= AIM_UP_S ) {

			this._press = null;
			this.fire();

		}

		const holdingFloat = !! ( this.loose && this.loose.float && this.loose.float.held );
		const hauling = act && lHeld && ( this.phase === 'out' || this.phase === 'fight' || holdingFloat );
		gun.state = this.loading ? 'loading' : this.aiming ? 'aim' : hauling || this.phase === 'fight' ? 'haul' : 'idle';
		if ( act && inp.hit( 'KeyE' ) ) this.use();

		// ---- the shaft and the fish
		if ( this.phase === 'flying' ) this.updateFlight( dt );
		else if ( this.phase === 'out' ) this.updateOut( dt, hauling );
		else if ( this.phase === 'fight' ) this.updateFight( dt, hauling );
		else if ( this.phase === 'loose' ) this.updateLoose( dt, hauling );
		else if ( this.phase === 'whale' ) this.updateWhale( dt );
		if ( this.phase !== 'fight' && this.phase !== 'whale' && ! ( this.phase === 'loose' && holdingFloat ) ) p.tug.set( 0, 0, 0 );
		// Easy, out of breath: drawn steadily up to the surface
		if ( this._assist ) p.tug.y = Math.max( p.tug.y, 1.2 );

		// ---- the hand: a slow wobble, steadier when aiming, shaky when hypoxic or in a contraction
		this.contraction = Math.max( 0, this.contraction - dt * 2.5 );
		const t = performance.now() / 1000;
		const amp = ( ( this.aiming ? 0.006 : 0.02 ) * ( 1 + 2.5 * this.apnea.hypoxia ) + this.contraction * 0.03 ) * ( this.easy ? 0.5 : 1 );
		const sway = { x: Math.sin( t * 0.9 ) * amp + Math.sin( t * 2.3 ) * amp * 0.3, y: Math.sin( t * 1.3 + 1 ) * amp * 0.8 - this.contraction * 0.02 };
		gun.update( dt, { visible: can && p.mode !== 'boat', sway } );

		// ---- fish taken from a school come back once you're away from it
		for ( let k = this.gone.length - 1; k >= 0; k -- ) {

			const g = this.gone[ k ];
			g.t -= dt;
			if ( g.t > 0 || ! this.fish ) continue;
			const i3 = g.i * 3, P = this.fish.pos;
			if ( Math.hypot( P[ i3 ] - p.position.x, P[ i3 + 2 ] - p.position.z ) < 50 ) continue;
			this.fish.restore( g.i );
			this.gone.splice( k, 1 );

		}

		this.updateHUD( dt, depth, under );

	}

	updateHUD( dt, depth, under ) {

		if ( ! this.hud ) return;
		const gun = this.gun, s = this.stats;
		this.hud.update( dt, {
			apnea: this.apnea, depth, under,
			gun: gun.equipped ? { bands: s.bands, loaded: gun.bandsLoaded, loadT: gun.loadT, shaftOut: this.phase !== 'home' } : null,
			contraction: this.contraction,
			cue: this.cue(),
			blackout: this.phase === 'blackout' ? Math.min( 1, this.blackT / 1.2 ) * ( this.blackT < 3.2 ? 1 : Math.max( 0, 1 - ( this.blackT - 3.2 ) / 1.5 ) ) : 0,
		} );

	}

	// ---------------------------------------------------------------- the shot
	fire() {

		const gun = this.gun, s = this.stats;
		if ( gun.bandsLoaded <= 0 ) {

			this.toast( 'Not loaded · hold R to pull a band back', 1600 );
			return;

		}

		if ( gun.muzzle.y > this.waterY - 0.08 ) {

			this.toast( 'Only shoot under water: a shaft out of the water flies dangerously far', 2200 );
			return;

		}

		const v0 = s.v0 * Math.sqrt( gun.bandsLoaded / s.bands );
		// a hip shot wanders; aimed down the shaft it goes where the shaft points
		const spread = ( this.aiming ? 0.004 : 0.022 ) * ( this.easy ? 0.5 : 1 );
		_v.copy( gun.forward );
		_v.x += ( Math.random() - 0.5 ) * spread * 2;
		_v.y += ( Math.random() - 0.5 ) * spread * 2;
		_v.z += ( Math.random() - 0.5 ) * spread * 2;
		_v.normalize();
		gun.gunToWorld( 0, gun.shaftHomeY, 0.026, gun.shaftPos );
		gun.shaftDir.copy( _v );
		this.shaftVel.copy( _v ).multiplyScalar( v0 );
		gun.shaftHome = false;
		gun.bandsLoaded = 0;
		gun.recoil = 1;
		gun.lineSlack = 1;
		this.phase = 'flying';
		this.shaftStuck = false;
		this.flightT = 0;
		this.sfx.shot( v0 / 18, true );
		// the snap of the bands through the water: fish nearby flinch
		if ( this.fish ) this.fish.scare( gun.muzzle, 3.5, 0.5 );

	}

	updateFlight( dt ) {

		const gun = this.gun, fish = this.fish;
		this.flightT += dt;
		const speed = this.shaftVel.length();
		const n = Math.min( 24, Math.max( 1, Math.ceil( speed * dt / 0.04 ) ) );
		const h = dt / n;
		// candidate fish: around the shaft's path this frame
		const cand = [];
		if ( fish ) {

			gun.tip( _a );
			fish.forEachNear( _a, speed * dt + 3, ( i ) => {

				if ( fish.pinned[ i ] ) return;
				cand.push( i );

			} );

		}

		// the whale, where it is near enough to be in the shaft's path this frame
		const whale = this.app.whale && this.app.whale.ready && this.app.whale.hitTest ? this.app.whale : null;
		const whaleNear = whale && gun.shaftPos.distanceTo( whale.brain.position ) < 12 + speed * dt;

		for ( let k = 0; k < n; k ++ ) {

			gun.tip( _a );
			stepShaft( gun.shaftPos, this.shaftVel, h );
			const v = this.shaftVel.length();
			if ( v > 0.3 ) gun.shaftDir.copy( this.shaftVel ).multiplyScalar( 1 / v );
			gun.tip( _b );
			// fish: the nearest hit along this step
			let best = null;
			for ( const i of cand ) {

				const i3 = i * 3;
				_p.set( fish.pos[ i3 ], fish.pos[ i3 + 1 ], fish.pos[ i3 + 2 ] );
				_h.set( fish.head[ i3 ], fish.head[ i3 + 1 ], fish.head[ i3 + 2 ] ).normalize();
				const sp = fish.speciesOf( i ), L = fish.size[ i ];
				const r = hitTest( _a, _b, _p, _h, L, sp.model );
				if ( r && ( ! best || r.t < best.hit.t ) ) best = { i, hit: r, sp, L, pos: _p.clone(), head: _h.clone(), a: _a.clone(), b: _b.clone() };

			}

			if ( best ) {

				// the whole run through the body (this step may end inside it), for the zone and
				// the thickness the shaft has to cross
				const far = best.a.clone().addScaledVector( gun.shaftDir, 2.2 * maxRadius( best.sp.model ) * best.L + 0.06 );
				const full = hitTest( best.a, far, best.pos, best.head, best.L, best.sp.model );
				if ( full ) {

					best.hit = full;
					best.b = far;

				}

				this.onHit( best, v );
				return;

			}

			if ( whaleNear ) {

				const wh = whale.hitTest( _b );
				if ( wh ) {

					this.onWhaleHit( whale, wh, v );
					return;

				}

			}

			// the bottom (a reef head rings, sand thuds), the surface
			const floor = this.floorAt( _b.x, _b.z );
			if ( _b.y < floor + 0.01 ) {

				const rock = this.app.reef && this.app.reef.floorHeightAt && this.app.reef.floorHeightAt( _b.x, _b.z ) > this.app.terrainData.heightAt( _b.x, _b.z ) + 0.05;
				this.sfx.clank( rock );
				gun.shaftPos.addScaledVector( gun.shaftDir, ( floor + 0.01 - _b.y ) / Math.min( - 0.05, gun.shaftDir.y ) );
				this.shaftVel.set( 0, 0, 0 );
				this.shaftStuck = true;
				this.phase = 'out';
				this.toast( rock ? 'Clang · into the reef' : 'Into the sand', 1200 );
				return;

			}

			if ( _b.y > this.waterY ) this.shaftVel.multiplyScalar( 0.5 );
			// the line: once its wraps are out it stops the shaft dead
			const reach = gun.shaftPos.distanceTo( gun.lineClip );
			if ( reach > this.lineMax ) {

				gun.shaftPos.sub( gun.lineClip ).setLength( this.lineMax ).add( gun.lineClip );
				this.shaftVel.multiplyScalar( - 0.08 );
				this.sfx.twang( 1 );
				this.phase = 'out';
				return;

			}

			if ( v < 1.2 ) {

				this.phase = 'out';
				return;

			}

		}

		gun.lineSlack = Math.max( 0.15, 1 - this.flightT * 3 );

	}

	onHit( best, v ) {

		const gun = this.gun, s = this.stats, fish = this.fish;
		const { i, hit, sp, L } = best;
		const model = sp.model;
		const pen = penetration( v, s.shaftMass, L, hit, model );
		const info = swimmerInfo( sp.name );
		this.sfx.hit( Math.min( 1, pen.E / 15 ) );
		if ( pen.result === 'bounce' ) {

			// glanced off: the shaft skids away, the fish bolts
			gun.shaftPos.addScaledVector( gun.shaftDir, hit.t * 0.04 );
			this.shaftVel.multiplyScalar( - 0.15 ).add( _v.set( Math.random() - 0.5, - 0.5, Math.random() - 0.5 ) );
			this.phase = 'out';
			fish.panic[ i ] = 1;
			fish.scare( best.pos, 8, 1 );
			this.toast( `The shaft glanced off the ${ info.name.toLowerCase() } · too far, or not enough gun`, 2400 );
			return;

		}

		const zone = zoneOf( model, hit );
		const through = pen.result === 'through';
		const kg = info.id ? weightKg( info.id, L ) : Math.max( 1, 12 * L * L * L );
		const rule = judge( sp.name, L );
		// where the shaft sits in the fish (its frame, in metres): the tip past the far flank when it
		// went through, part way in when it lodged
		const fx = best.head, ux = new Vector3( 0, 1, 0 ).addScaledVector( fx, - fx.y ).normalize(), rx = new Vector3().crossVectors( fx, ux );
		const entry = best.a.clone().lerp( best.b, hit.t );
		const depthIn = through ? hit.inside * L + 0.11 : Math.max( 0.03, hit.inside * L * 0.55 );
		const tipW = entry.clone().addScaledVector( gun.shaftDir, depthIn );
		const rel = tipW.sub( best.pos );
		this.target = {
			i, behaviour: sp.name, info, L, kg, zone, rule, through,
			local: {
				tip: new Vector3( rel.dot( rx ), rel.dot( ux ), rel.dot( fx ) ),
				dir: new Vector3( gun.shaftDir.dot( rx ), gun.shaftDir.dot( ux ), gun.shaftDir.dot( fx ) ),
			},
		};
		const reel = s.reelM > 0 ? { drag: s.reelDrag, lineM: s.reelM } : null;
		this.fight = new SpearFight( { kg, id: info.id, zone, through, lineMax: this.lineMax, reel, shaftHold: s.shaftHold } );
		// the hit knocks the fish along a little
		_v.copy( gun.shaftDir ).multiplyScalar( Math.min( 1.5, s.shaftMass * v / ( kg * 1.6 + s.shaftMass ) ) );
		this.fight.start( best.pos, gun.lineClip, _v );
		fish.pin( i, true );
		fish.panic[ i ] = 1;
		fish.scare( best.pos, 9, 1 );
		this.shaftVel.set( 0, 0, 0 );
		this.phase = 'fight';
		this._holedTold = false;
		const Z = ZONES[ zone ];
		// a grouper or a snapper over the reef may bolt into a hole in it
		const hole = ! this.fight.stoned && this.rng() < ( HOLERS[ sp.name ] || 0 ) ? this.findHole( best.pos, gun.lineClip, this.fight.lineOut ) : null;
		if ( hole ) this.fight.goHole( hole );
		const how = this.fight.stoned ? '' : hole ? ' · it bolted for the reef' : this.fight.big ? ' · it\'s running' : '';
		this.toast( `${ info.name } · ${ Z.label }${ through ? '' : ' (the shaft only lodged)' }${ how }`, 2600 );
		this.placeShaftOnFish();

	}

	// The shaft meets the humpback. Shooting at a whale is harassing a protected animal: the fine
	// comes whether the shaft goes in or not. Square on and fast from a strong gun, it lodges in
	// the blubber; otherwise it skips off the skin. Either way the whale flinches and sounds.
	onWhaleHit( whale, wh, v ) {

		const gun = this.gun, s = this.stats, st = this.game.state;
		const E = 0.5 * s.shaftMass * v * v;
		const cos = Math.max( 0, - gun.shaftDir.dot( wh.normal ) );
		const result = whaleShaft( E, cos );
		const rule = judge( 'humpback', 14 );
		this.sfx.hit( Math.min( 1, E / 40 ) * 0.7 );
		whale.brain.startle( wh.local.x >= 0 ? 1 : - 1 );
		if ( this.fish ) this.fish.scare( gun.shaftPos, 10, 1 );
		const paid = this.easy ? 0 : st.fine( rule.fine );
		const fineText = this.easy ? `${ rule.why }. Leave whales alone: it's a $${ rule.fine.toLocaleString( 'en-US' ) } fine on Standard`
			: `${ rule.why }. Fined $${ rule.fine.toLocaleString( 'en-US' ) }${ paid < rule.fine ? ` (you could pay $${ paid })` : '' }`;
		if ( result === 'bounce' ) {

			// skips off the skin, the way it came, and sinks
			_v.copy( wh.normal ).multiplyScalar( - 2 * gun.shaftDir.dot( wh.normal ) );
			this.shaftVel.copy( gun.shaftDir ).add( _v ).multiplyScalar( v * 0.12 );
			gun.shaftPos.addScaledVector( gun.shaftDir, - 0.05 );
			this.phase = 'out';
			this.toast( `The shaft skipped off the humpback's skin and it dived. ${ fineText }`, 6000 );
			return;

		}

		// lodged: the tip sits a hand's width into the blubber, carried with the whale
		_t.copy( gun.shaftDir ).multiplyScalar( 0.12 );
		const tipW = _a.copy( _b ).add( _t );
		const inside = whale.hitTest( tipW );
		const local = inside ? inside.local : wh.local;
		this.whaleHit = {
			k: wh.k, tip: local, dir: whale.frameDirLocal( wh.k, gun.shaftDir, new Vector3() ),
			t: 0, reelOut: 0, tightT: 0, part: wh.part,
		};
		this.shaftVel.set( 0, 0, 0 );
		this.phase = 'whale';
		this.placeShaftOnWhale();
		this.toast( `The shaft stuck in the humpback's ${ wh.part }. It flinched and dived. ${ fineText }`, 6500 );

	}

	placeShaftOnWhale() {

		const W = this.whaleHit, whale = this.app.whale, gun = this.gun;
		whale.toWorld( W.tip, _b );
		whale.frameDir( W.k, W.dir, gun.shaftDir ).normalize();
		gun.shaftPos.copy( _b ).addScaledVector( gun.shaftDir, - gun.shaftL );

	}

	// The whale tows the shaft away. The line comes tight within a second; a reel pays out line
	// until it's empty. Then the diver is yanked toward the whale, and the shaft rips out of the
	// blubber: nothing on a speargun holds 30 tonnes.
	updateWhale( dt ) {

		const W = this.whaleHit, whale = this.app.whale, gun = this.gun, s = this.stats, p = this.app.player;
		if ( ! W || ! whale ) {

			this.phase = 'out';
			return;

		}

		W.t += dt;
		this.placeShaftOnWhale();
		const reach = gun.shaftPos.distanceTo( gun.lineClip );
		const max = this.lineMax + W.reelOut;
		const run = whale.brain.speed;
		if ( reach > max ) {

			if ( s.reelM > 0 && W.reelOut < s.reelM ) {

				// the reel screams: the line goes out as fast as the whale swims
				W.reelOut = Math.min( s.reelM, W.reelOut + ( reach - max ) );
				if ( this.app.audio && this.app.audio.rodLoop ) this.app.audio.rodLoop( 0, run, 0.8 );
				gun.lineSlack = 0;
				p.tug.set( 0, 0, 0 );
				return;

			}

			// tight: the whale drags the diver after it, until the shaft gives
			W.tightT += dt;
			gun.lineSlack = 0;
			_v.copy( gun.shaftPos ).sub( gun.lineClip ).normalize();
			p.tug.copy( _v ).multiplyScalar( Math.min( run, 4 ) * Math.min( 1, W.tightT / 0.15 ) );
			this.sfx.twang( 1 );
			if ( W.tightT > WHALE_HOLD_S ) this.whaleTearOut();
			return;

		}

		gun.lineSlack = Math.max( 0, 1 - W.t * 1.5 );
		p.tug.set( 0, 0, 0 );

	}

	whaleTearOut() {

		const gun = this.gun, whale = this.app.whale;
		this.whaleHit = null;
		this.phase = 'out';
		const b = whale && whale.brain;
		if ( b ) this.shaftVel.set( Math.sin( b.yaw ), 0, Math.cos( b.yaw ) ).multiplyScalar( b.speed * 0.2 );
		else this.shaftVel.set( 0, 0, 0 );
		this.shaftVel.y -= 0.3;
		gun.shaftPos.sub( gun.lineClip ).setLength( Math.min( this.lineMax, gun.shaftPos.distanceTo( gun.lineClip ) ) ).add( gun.lineClip );
		this.app.player.tug.set( 0, 0, 0 );
		if ( this.app.audio && this.app.audio.rodLoop ) this.app.audio.rodLoop( 0, 0, 0 );
		if ( this.app.audio && this.app.audio.lineSnap ) this.app.audio.lineSnap();
		this.toast( 'The line snapped tight and the shaft ripped out of the blubber. Haul it in', 3200 );

	}

	// the shaft through the fish, from the fish's pose (fish frame -> world)
	placeShaftOnFish() {

		const T = this.target, fish = this.fish, gun = this.gun;
		if ( ! T || ! fish ) return;
		const i3 = T.i * 3;
		const f = _h.set( fish.head[ i3 ], fish.head[ i3 + 1 ], fish.head[ i3 + 2 ] ).normalize();
		const u = _t.set( 0, 1, 0 ).addScaledVector( f, - f.y ).normalize();
		const r = _v.crossVectors( f, u );
		const lt = T.local.tip, ld = T.local.dir;
		_p.set( fish.pos[ i3 ], fish.pos[ i3 + 1 ], fish.pos[ i3 + 2 ] );
		const tipW = _a.copy( _p ).addScaledVector( r, lt.x ).addScaledVector( u, lt.y ).addScaledVector( f, lt.z );
		gun.shaftDir.set( 0, 0, 0 ).addScaledVector( r, ld.x ).addScaledVector( u, ld.y ).addScaledVector( f, ld.z ).normalize();
		gun.shaftPos.copy( tipW ).addScaledVector( gun.shaftDir, - gun.shaftL );

	}

	// called by the fish simulation after its step: the fish on the shaft goes where the fight says
	moveFish() {

		const T = this.target, fish = this.fish, F = this.fight;
		if ( ! T || ! F || ! ( this.phase === 'fight' || this.loose ) ) return;
		const i3 = T.i * 3;
		fish.pos[ i3 ] = F.p.x; fish.pos[ i3 + 1 ] = F.p.y; fish.pos[ i3 + 2 ] = F.p.z;
		// heading: along its swim (away from the pull) when alive; a limp fish trails along the line
		_v.set( F.v.x, F.v.y, F.v.z );
		const A = this.loose ? this.loose.gun.p : this.gun.lineClip;
		if ( F.wedged ) _v.set( fish.head[ i3 ], fish.head[ i3 + 1 ], fish.head[ i3 + 2 ] ).setLength( 0.02 ); // nose into the coral
		else if ( F.stoned || F.stamina < 0.05 || _v.lengthSq() < 0.01 ) _v.set( F.p.x - A.x, F.p.y - A.y, F.p.z - A.z ).setLength( 0.05 );
		fish.vel[ i3 ] = _v.x; fish.vel[ i3 + 1 ] = _v.y; fish.vel[ i3 + 2 ] = _v.z;
		fish.ampMul[ T.i ] = F.stoned ? 0.04 : F.wedged ? 0.15 + 0.5 * F.wedge : 0.6 + 1.6 * F.surge * ( 0.3 + 0.7 * F.stamina );
		fish.panic[ T.i ] = F.stoned ? 0 : Math.max( 0.4, F.stamina );

	}

	updateFight( dt, hauling ) {

		const F = this.fight, gun = this.gun, p = this.app.player;
		const floor = this.floorAt( F.p.x, F.p.z );
		F.update( dt, gun.lineClip, hauling, floor, this.waterY - 0.15, _pull );
		// the pull on the diver, toward the fish: a strong one tows you (about 90 kg of diver, gear and
		// the water you drag)
		p.tug.set( _pull.x, _pull.y, _pull.z ).multiplyScalar( 1 / 220 );
		if ( F.wedged && ! this._holedTold ) {

			this._holedTold = true;
			this.toast( 'It holed up in the reef. Pulling will only tear the shaft out', 3000 );

		}
		gun.lineSlack = F.tension > 15 ? 0 : 0.4;
		if ( F.tension > F.holdN * 0.9 && Math.random() < dt * 3 ) this.sfx.twang( Math.min( 1, F.tension / F.holdN ) );
		// the commotion draws attention: fish around keep away
		if ( ! F.stoned && Math.random() < dt * 0.5 && this.fish ) this.fish.scare( F.p, 6, 0.6 );
		this.placeShaftOnFish();
		if ( F.result === 'free' ) this.loseFish( F.zone === 'belly' || F.zone === 'tail' ? 'The shaft tore out of the soft flesh' : 'The shaft pulled free', true );

	}

	// the fish is gone (torn free or let go): the shaft drops away on the line
	loseFish( text, torn = false ) {

		const T = this.target, fish = this.fish;
		if ( T && fish ) {

			fish.pin( T.i, false );
			fish.panic[ T.i ] = 1;
			fish.vel[ T.i * 3 ] *= 3;
			fish.vel[ T.i * 3 + 2 ] *= 3;

		}

		this.target = null;
		this.fight = null;
		this.phase = 'out';
		this.shaftVel.set( 0, - 0.3, 0 );
		this.app.player.tug.set( 0, 0, 0 );
		this.toast( text, 2200 );
		if ( torn && this.app.audio && this.app.audio.lineSnap ) this.app.audio.lineSnap();

	}

	// in reach: a hand on the gill plate, the knife behind the eye (iki), onto the stringer
	secure( worked = false ) {

		const F = this.fight, T = this.target, fish = this.fish, st = this.game.state;
		if ( ! F || ! T ) return;
		// a small or limp fish is simply taken in hand; a big one still kicking may not let you
		if ( ! worked && F.big && F.stamina > 0.35 && this.rng() < 0.3 + 0.5 * F.stamina ) {

			// still lively: it thrashes as you reach for it
			F.tear += 0.35 * ( T.through ? 0.6 : 1.4 );
			F.surge = 1;
			this.toast( 'It thrashed out of your hand · tire it out first', 1800 );
			if ( F.tear >= 1 ) this.loseFish( 'It tore free as you grabbed it', true );
			return;

		}

		fish.remove( T.i );
		this.gone.push( { i: T.i, t: RESPAWN_S } );
		const rule = T.rule;
		if ( ! rule.ok ) {

			if ( rule.fine > 0 && this.easy ) {

				this.toast( `${ rule.why }. Let it go: it's a $${ rule.fine } fine on Standard`, 4200 );

			} else if ( rule.fine > 0 ) {

				st.fine( rule.fine );
				this.toast( `${ rule.why }. Fined $${ rule.fine }`, 4200 );

			} else this.toast( rule.why, 2600 );

		} else {

			const entry = st.addFish( T.info.id, T.kg, this.game.hour );
			const info = st.lastCatch;
			if ( this.game.hud ) {

				this.game.hud.showCatch( info, CATCH_CARD_MS );
				this.card = { t: 0 };

			} else if ( entry ) this.toast( `${ T.info.name } · ${ entry.kg.toFixed( 2 ) } kg · $${ entry.value }`, 3600 );
			if ( ! entry ) this.toast( `No room in the ${ st.upgrades.hold > 0 ? 'hold' : 'cooler' } for it`, 3000 );
			if ( this.app.audio && this.app.audio.fishFlop ) this.app.audio.fishFlop();

		}

		this.target = null;
		this.fight = null;
		this.app.player.tug.set( 0, 0, 0 );
		this.shaftHomeNow();

	}

	endCard() {

		this.card = null;
		this.game._cardDismissed = true;
		if ( this.game.hud && this.game.hud.catchOpen ) this.game.hud.hideCatch();

	}

	// a missed shot: the shaft sinks or lies where it stopped; haul the line to bring it back
	updateOut( dt, hauling ) {

		const gun = this.gun;
		if ( hauling ) {

			// pulled along the line toward the muzzle, tail first, sliding out of the sand
			_v.copy( gun.lineClip ).sub( gun.shaftPos );
			const d = _v.length();
			if ( d < 0.35 ) {

				this.shaftHomeNow();
				return;

			}

			_v.multiplyScalar( 1 / d );
			gun.shaftPos.addScaledVector( _v, Math.min( d, 1.1 * dt ) );
			gun.shaftDir.lerp( _a.copy( _v ).negate(), 1 - Math.exp( - dt * 4 ) ).normalize();
			this.shaftStuck = false;
			this.shaftVel.set( 0, 0, 0 );
			gun.lineSlack = 0;
			const floor = this.floorAt( gun.shaftPos.x, gun.shaftPos.z );
			if ( gun.shaftPos.y < floor + 0.02 ) gun.shaftPos.y = floor + 0.02;
			return;

		}

		gun.lineSlack = Math.min( 1, gun.lineSlack + dt );
		if ( this.shaftStuck ) return;
		// sinking: a slow glide, the shaft tilting tip-down as it slows
		stepShaft( gun.shaftPos, this.shaftVel, dt );
		this.shaftVel.multiplyScalar( Math.exp( - dt * 1.5 ) );
		this.shaftVel.y = Math.max( this.shaftVel.y, - 0.6 );
		gun.shaftDir.y += ( - 0.25 - gun.shaftDir.y ) * ( 1 - Math.exp( - dt * 0.6 ) );
		gun.shaftDir.normalize();
		const reach = gun.shaftPos.distanceTo( gun.lineClip );
		if ( reach > this.lineMax ) gun.shaftPos.sub( gun.lineClip ).setLength( this.lineMax ).add( gun.lineClip );
		gun.tip( _b );
		const floor = Math.min( this.floorAt( _b.x, _b.z ), this.floorAt( gun.shaftPos.x, gun.shaftPos.z ) );
		if ( Math.min( _b.y, gun.shaftPos.y ) < floor + 0.01 ) {

			this.shaftStuck = true;
			this.shaftVel.set( 0, 0, 0 );

		}

	}

	// a coral head near p, within the line's reach of the anchor: the hole the fish bolts into
	findHole( p, anchor, lineOut ) {

		const app = this.app;
		if ( ! app.reef || ! app.reef.floorHeightAt ) return null;
		let best = null, bestScore = 0;
		for ( let r = 0.6; r <= 3.01; r += 0.6 ) for ( let k = 0; k < 10; k ++ ) {

			const a = k / 10 * Math.PI * 2 + r;
			const x = p.x + Math.cos( a ) * r, z = p.z + Math.sin( a ) * r;
			const top = app.reef.floorHeightAt( x, z ), sand = app.terrainData.heightAt( x, z );
			const relief = top - sand;
			if ( relief < 0.4 ) continue;
			const y = top + 0.12;
			if ( Math.hypot( x - anchor.x, y - anchor.y, z - anchor.z ) > lineOut - 0.3 ) continue;
			const score = relief / ( 1 + r );
			if ( score > bestScore ) {

				bestScore = score;
				best = { x, y, z };

			}

		}

		return best;

	}

	// E: whatever is in reach (a fish in hand, a fish in its hole, the gun, the float line)
	use() {

		const F = this.fight, L = this.loose, cam = this.app.camera.position;
		if ( F && F.wedged && this.reachDistance() <= REACH_M ) return this.reachIn();
		if ( this.phase === 'fight' && F && this.fishDistance() <= SECURE_M + 0.15 ) return this.secure();
		if ( ! L ) return;
		if ( cam.distanceTo( L.gun.p ) <= REACH_M + 0.3 ) return this.takeGun();
		if ( L.float && ! L.float.held && Math.hypot( cam.x - L.float.p.x, cam.z - L.float.p.z ) <= REACH_M + 0.5 && Math.abs( cam.y - L.float.p.y ) < 1.5 ) {

			L.float.held = true;
			this.toast( 'Float line in hand · hold Fire to pull it in, let go when it runs', 2600 );

		}

	}

	// a hand into the hole: a fish that has calmed down comes out; one still braced doesn't (yet)
	reachIn() {

		const F = this.fight;
		if ( F.wedge < 0.45 ) {

			this.toast( 'You worked it out of the hole', 1600 );
			this.secure( true );
			return;

		}

		F.wedge = Math.max( 0, F.wedge - 0.12 );
		this.toast( 'It\'s wedged tight. Leave it a while, go up for air, and try again', 2600 );

	}

	// G with a fish on: the gun goes with the fish
	letGo( quiet = false ) {

		const gun = this.gun, s = this.stats, p = this.app.player;
		if ( this.phase !== 'fight' ) return;
		const G = { p: gun.lineClip.clone(), v: p.velocity.clone() };
		let float = null;
		if ( s.floatM > 0 ) {

			// the float is at the surface above where you dove; its line pays out to the gun
			const fp = new Vector3( p.position.x, this.waterY, p.position.z );
			float = { p: fp, v: new Vector3(), lineOut: s.floatM, lineM: s.floatM, held: false, hauling: false };

		}

		this.loose = { gun: G, float };
		gun.loose = { p: G.p, dir: gun.forward.clone() };
		gun.float = float ? { p: float.p, slack: 0 } : null;
		this.aimLatched = false;
		this.phase = 'loose';
		p.tug.set( 0, 0, 0 );
		if ( ! quiet ) this.toast( float ? 'You let go. The float will tire it: go up, breathe, grab the float (E) and pull it in from the top' : 'You let go of the gun. It\'s on the fish\'s line now: follow it and grab it (E)', 4200 );

	}

	// the rig out on its own: the fish (if still on) tows the gun, and the gun the float
	updateLoose( dt, hauling ) {

		const L = this.loose, gun = this.gun, F = this.fight, p = this.app.player;
		const fl = L.float;
		if ( fl && fl.held ) {

			// the float line in hand: the float rides at your hand
			this.hand( fl.p );
			fl.hauling = hauling;

		}

		L.gun.floorY = this.floorAt( L.gun.p.x, L.gun.p.z );
		if ( F ) {

			const floor = this.floorAt( F.p.x, F.p.z );
			F.tow( dt, L.gun, fl, floor, this.waterY - 0.15, this.waterY, _pull );
			// floating at the surface with the line in hand: the pull drags you along, not under
			if ( fl && fl.held ) p.tug.set( _pull.x, 0, _pull.z ).multiplyScalar( 1 / 220 );
			this.placeShaftOnFish();
			gun.loose.dir.set( F.p.x - L.gun.p.x, F.p.y - L.gun.p.y, F.p.z - L.gun.p.z );
			if ( gun.loose.dir.lengthSq() < 1e-6 ) gun.loose.dir.set( 0, 0, 1 );
			if ( F.result === 'free' ) this.freeFromLoose();

		} else {

			// nothing on the line: the gun sinks to the bottom (hanging under the float)
			const g = L.gun;
			g.v.multiplyScalar( Math.exp( - dt * 2.4 ) );
			g.v.y -= 0.8 * dt;
			g.p.addScaledVector( g.v, dt );
			if ( g.p.y < L.gun.floorY + 0.1 ) {

				g.p.y = L.gun.floorY + 0.1;
				g.v.set( 0, 0, 0 );

			}

			if ( fl ) {

				if ( fl.held && hauling ) {

					const d = fl.p.distanceTo( g.p );
					fl.lineOut = fl.lineOut > d + 0.1 ? Math.max( d, fl.lineOut - 3 * dt ) : Math.max( 0, fl.lineOut - 0.9 * dt );

				}
				_v.copy( g.p ).sub( fl.p );
				if ( _v.length() > fl.lineOut ) g.p.copy( fl.p ).addScaledVector( _v.normalize(), fl.lineOut );

			}

			gun.loose.dir.set( 1, - 0.2, 0 );
			gun.shaftDir.set( 1, 0, 0 );
			gun.shaftPos.copy( g.p ).addScaledVector( gun.shaftDir, 0.3 );

		}

		gun.loose.p.copy( L.gun.p );
		if ( fl ) {

			gun.float.p.copy( fl.p );
			gun.float.slack = Math.max( 0, fl.lineOut - fl.p.distanceTo( L.gun.p ) ) / Math.max( 1, fl.lineOut );
			if ( fl.held && fl.lineOut <= 0.4 ) this.takeGun();

		}

		gun.lineSlack = F && F.tension > 15 ? 0 : 0.5;

	}

	// the fish tore free while the gun was out on its own
	freeFromLoose() {

		const T = this.target, fish = this.fish;
		if ( T && fish ) {

			fish.pin( T.i, false );
			fish.panic[ T.i ] = 1;

		}

		this.target = null;
		this.fight = null;
		this.toast( 'The shaft tore out. It\'s gone', 2200 );

	}

	// the gun back in hand: with a fish still on, the fight goes on from here
	takeGun() {

		const gun = this.gun, F = this.fight;
		this.loose = null;
		gun.loose = null;
		gun.float = null;
		this.app.player.tug.set( 0, 0, 0 );
		if ( F ) {

			this.phase = 'fight';
			F.lineOut = Math.min( this.lineMax, Math.max( 0.6, this.fishDistance() ) );
			this.toast( 'Gun in hand', 1400 );

		} else {

			this.phase = 'out';
			this.toast( 'Gun in hand · haul the shaft in', 1600 );

		}

	}

	// one line about the fish on the line, for the HUD in place of a gauge: what it does and what
	// to do (null with nothing on)
	cue() {

		const F = this.fight, L = this.loose, cam = this.app.camera.position;
		const near = ( q ) => `${ Math.max( 0, cam.distanceTo( q ) ).toFixed( 0 ) } m`;
		if ( L ) {

			if ( L.float && L.float.held ) {

				if ( F && F.handTension > 70 ) return { text: 'It\'s running · the line slips through your fingers', level: 'warn' };
				return { text: `On the float line · ${ L.float.lineOut.toFixed( 0 ) } m out`, level: '' };

			}

			if ( F && F.wedged && this.reachDistance() < 6 ) return { text: F.wedge < 0.45 ? 'It\'s calmed down · reach in (E)' : 'Holed up in the reef', level: F.wedge < 0.45 ? 'good' : '' };
			if ( L.float ) return { text: `Float ${ near( L.float.p ) } · gun ${ near( L.gun.p ) }`, level: '' };
			return { text: `Your gun · ${ near( L.gun.p ) }`, level: 'warn' };

		}

		if ( ! F || this.phase !== 'fight' ) return null;
		const t = F.tension / F.holdN;
		if ( F.wedged ) return { text: F.wedge < 0.45 ? 'It\'s calmed down · reach in (E)' : t > 0.5 ? 'Wedged in the reef · pulling tears the shaft' : 'Holed up in the reef', level: t > 0.5 ? 'bad' : F.wedge < 0.45 ? 'good' : '' };
		if ( F.tear > 0.25 || t > 0.85 ) return { text: 'The shaft is tearing out', level: 'bad' };
		if ( F.holeState === 'going' ) return { text: 'It\'s bolting for the reef', level: 'warn' };
		if ( this.fishDistance() <= SECURE_M + 0.15 ) return { text: 'In reach', level: 'good' };
		if ( F.big && F.stamina > 0.05 ) return F.surge > 0.5 || t > 0.5 ? { text: 'Pulling hard', level: 'warn' } : { text: 'It\'s running', level: 'warn' };
		if ( F.big ) return { text: 'It\'s tiring · haul it in', level: 'good' };
		if ( F.stoned ) return { text: 'Stoned', level: 'good' };
		return null;

	}

	shaftHomeNow() {

		const gun = this.gun;
		gun.shaftHome = true;
		gun.bandsLoaded = 0;
		this.shaftVel.set( 0, 0, 0 );
		this.shaftStuck = false;
		this.phase = 'home';
		this.whaleHit = null;
		if ( this.target && this.fish ) this.fish.pin( this.target.i, false );
		this.target = null;
		this.fight = null;
		this.loose = null;
		gun.loose = null;
		gun.float = null;
		this._holedTold = false;

	}

	// ---------------------------------------------------------------- blackout
	startBlackout() {

		// the gun drops from your hand: with a fish on, it stays out on the line (and the float)
		if ( this.phase === 'fight' ) this.letGo( true );
		this._resume = this.loose ? 'loose' : 'home';
		if ( this.loose && this.loose.float ) this.loose.float.held = false;
		this.phase = 'blackout';
		this.blackT = 0;
		this.loading = false;
		this.app.player.tug.set( 0, 0, 0 );
		this.app.player.frozen = true;
		if ( this.loose ) return;
		if ( this.target && this.fish ) {

			this.fish.pin( this.target.i, false );
			this.target = null;

		}

		this.fight = null;
		this.whaleHit = null;
		this.gun.shaftHome = true;
		this.gun.bandsLoaded = 0;
		this.loading = false;
		this.app.player.tug.set( 0, 0, 0 );
		this.app.player.frozen = true;

	}

	updateBlackout( dt ) {

		const p = this.app.player;
		this.blackT += dt;
		// your buddy brings you up: face out of the water, a few breaths, the world comes back
		if ( this.blackT > 1.2 && this.blackT < 3.2 ) {

			p.position.y += ( this.waterY - 0.05 - p.position.y ) * ( 1 - Math.exp( - dt * 3 ) );
			p.velocity.set( 0, 0, 0 );

		}

		if ( this.blackT > 3.2 && ! this._recovered ) {

			this._recovered = true;
			p.position.y = this.waterY;
			p.floating = true;
			this.apnea.recover();
			this.sfx.gasp( 1 );
			this.toast( 'You blacked out. Your dive buddy got you to the surface. Breathe, and keep your dives shorter: never dive alone', 6500 );

		}

		if ( this.blackT > 4.7 ) {

			this.phase = this._resume;
			this._recovered = false;
			p.frozen = false;

		}

	}

	// ---------------------------------------------------------------- prompts
	prompt() {

		const gun = this.gun, p = this.app.player;
		if ( this.phase === 'blackout' ) return null;
		if ( ! gun.equipped ) {

			if ( ! this.allowGun ) return null;
			const wet = p.mode === 'swim' || ( p.mode === 'walk' && [ 'wetsand', 'water' ].includes( p.surface ) );
			return wet ? { key: 'G', text: 'Take out the speargun' } : null;

		}

		switch ( this.phase ) {

			case 'flying': return null;
			case 'out': return { key: 'Hold LMB', text: 'Haul the line in to get the shaft back' };
			case 'whale': return null;
			case 'fight': {

				const F = this.fight, d = this.fishDistance();
				if ( F.wedged ) {

					if ( this.reachDistance() <= REACH_M ) return { key: 'E', text: F.wedge < 0.45 ? 'Reach in and work it out' : 'Reach in (it\'s wedged tight)' };
					return { key: 'G', text: 'Let go of the gun, go up for air, come back for it   ·   pulling tears the shaft' };

				}

				if ( d <= SECURE_M + 0.15 ) return { key: 'E', text: ! F.big || F.stamina < 0.35 ? 'Grab it and dispatch it' : 'Grab it (it is still kicking)' };
				if ( ! F.big ) return { key: 'Hold LMB', text: 'Haul it in' };
				if ( F.tension > F.holdN * 0.85 ) return { key: 'LMB', text: 'Let go of the line · the shaft is tearing out!   ·   G  let go of the gun' };
				return { key: 'Hold LMB', text: 'Haul it in, ease off when it runs   ·   G  let go of the gun' };

			}

			case 'loose': {

				const L = this.loose, cam = this.app.camera.position, F = this.fight;
				if ( F && F.wedged && this.reachDistance() <= REACH_M ) return { key: 'E', text: F.wedge < 0.45 ? 'Reach in and work it out' : 'Reach in (it\'s wedged tight)' };
				if ( cam.distanceTo( L.gun.p ) <= REACH_M + 0.3 ) return { key: 'E', text: 'Take your gun' };
				if ( L.float && L.float.held ) return { key: 'Hold LMB', text: 'Pull the float line in, let go when it runs' };
				if ( L.float && Math.hypot( cam.x - L.float.p.x, cam.z - L.float.p.z ) <= REACH_M + 0.5 && Math.abs( cam.y - L.float.p.y ) < 1.5 ) return { key: 'E', text: 'Grab the float line' };
				return null;

			}

			default: {

				const s = this.stats;
				if ( gun.bandsLoaded < s.bands && ! this.loading ) {

					if ( gun.bandsLoaded === 0 ) return { key: 'Hold R', text: 'Load a band' };
					return { key: 'Hold R', text: 'Load the second band   ·   LMB  shoot' };

				}

				if ( this.loading ) return { key: 'R', text: 'Pulling the band back to its fin…' };
				if ( p.mode !== 'swim' ) return { key: 'G', text: 'Get in the water to hunt   ·   G  put the gun away' };
				if ( this.aiming ) return { key: 'LMB', text: 'Shoot   ·   Q  lower the gun' };
				return { key: 'Hold LMB', text: 'Aim, let go to shoot   ·   G  put the gun away' };

			}

		}

	}

	// the fish within the gun's useful range ahead (for the guide's first-hunt tip)
	fishAhead() {

		const fish = this.fish, gun = this.gun;
		if ( ! fish || ! gun.equipped ) return null;
		let best = null;
		fish.forEachNear( gun.muzzle, 4.5, ( i, sp, d ) => {

			const i3 = i * 3;
			_v.set( fish.pos[ i3 ] - gun.muzzle.x, fish.pos[ i3 + 1 ] - gun.muzzle.y, fish.pos[ i3 + 2 ] - gun.muzzle.z );
			if ( _v.normalize().dot( gun.forward ) < 0.9 ) return;
			if ( ! best || d < best.d ) best = { i, sp, d };

		} );
		return best;

	}

}

