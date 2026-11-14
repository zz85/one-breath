import { Diver } from './Diver.js';

// Your own body in the water: the freediver figure (game/Diver.js) hung from your eyes, so you
// see your arms along your sides and your fins when you look down, and the whole of you from the
// chase camera (V while swimming). On land and aboard it is hidden: there the view is the walker's.
//   const me = new PlayerDiver( { scene, material, player } );  me.update( dt, { gun, blackout } )
export class PlayerDiver {

	constructor( { scene, material, player, hue = 0.08 } ) {

		this.player = player;
		this.diver = new Diver( { material, hue } );
		this.diver.group.name = 'PlayerDiver';
		this.diver.group.visible = false;
		scene.add( this.diver.group );
		this.shown = false;

	}

	update( dt, { gun = false, blackout = false } = {} ) {

		const p = this.player, d = this.diver;
		const swim = p.mode === 'swim';
		// hidden until you're swimming, and faded in through the pose easing from a standing figure
		if ( ! swim ) {

			if ( this.shown ) {

				d.group.visible = false;
				this.shown = false;

			}

			d.setPose( { mode: 'walk', floating: true, pitch: p.pitch, speed: 0, blackout: false, gun: false, sprint: false } );
			d.update( dt );
			return;

		}

		const inp = p.input;
		const sprint = !! ( inp && ( inp.down( 'ShiftLeft' ) || inp.down( 'ShiftRight' ) ) );
		const speed = Math.hypot( p.velocity.x, p.velocity.y, p.velocity.z );
		const third = p.thirdPerson;
		d.setPose( { mode: 'swim', floating: p.floating, pitch: p.pitch, speed, blackout, gun, sprint } );
		d.update( dt );
		// first person: the head would be in the lens, and the speargun's own view stands in for the arms
		d.showHead( third );
		d.showArms( third || ! gun );
		d.placeEye( p.yaw, p.eye );
		if ( ! this.shown ) {

			d.group.visible = true;
			this.shown = true;

		}

	}

}
