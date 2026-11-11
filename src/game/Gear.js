// Gear and upgrade data. The upgrade shop (a vendor by the boathouse) is not built yet; everything
// the game reads goes through gearStats( state.upgrades ), so buying a level is just
// state.upgrades[ key ]++ and the stats follow.
//
// Each track: levels[ 0 ] is what you start with; cost is the price of that level (0 for the first).
export const UPGRADES = {
	// spearfishing: the gun (barrel length, bands, shaft speed), the shaft (its hold in a fish), a
	// reel on the gun (lets a big fish run instead of tearing the shaft out), fins (finning speed)
	// and freediving training (breath-hold)
	gun: { name: 'Speargun', levels: [
		{ cost: 0, label: '75 cm wooden gun, one 16 mm band', gunM: 0.75, bands: 1, v0: 15, shaftMass: 0.22, lineWraps: 2, gunKind: 'wood' },
		{ cost: 160, label: '90 cm teak railgun, two 16 mm bands', gunM: 0.9, bands: 2, v0: 18, shaftMass: 0.29, lineWraps: 2, gunKind: 'teak' },
		{ cost: 480, label: '110 cm carbon gun, two 17.5 mm bands', gunM: 1.1, bands: 2, v0: 21, shaftMass: 0.34, lineWraps: 2.5, gunKind: 'carbon' },
	] },
	shaft: { name: 'Shaft', levels: [
		{ cost: 0, label: '6.25 mm shaft, single flopper', shaftHold: 1 },
		{ cost: 90, label: '6.5 mm spring-steel shaft, double flopper', shaftHold: 1.35 },
		{ cost: 260, label: '7 mm Tahitian shaft, slip tip', shaftHold: 1.8 },
	] },
	reel: { name: 'Gun reel', levels: [
		{ cost: 0, label: 'No reel (shooting line only)', reelM: 0, reelDrag: 0 },
		{ cost: 220, label: '30 m reel with drag', reelM: 30, reelDrag: 70 },
	] },
	// a float line from the gun's butt to a float at the surface: let go of the gun on a big fish and
	// the float tires it; pull it in from the top, where you can breathe
	float: { name: 'Float line', levels: [
		{ cost: 0, label: 'No float line', floatM: 0 },
		{ cost: 140, label: '20 m float line and torpedo float', floatM: 20 },
	] },
	fins: { name: 'Fins', levels: [
		{ cost: 0, label: 'Snorkelling fins', swimMul: 1 },
		{ cost: 110, label: 'Long-blade freediving fins', swimMul: 1.25 },
		{ cost: 340, label: 'Carbon fins', swimMul: 1.45 },
	] },
	apnea: { name: 'Freediving', levels: [
		{ cost: 0, label: 'Untrained: about 70 s breath-hold', holdS: 70 },
		{ cost: 150, label: 'Freediving course: about 95 s', holdS: 95 },
		{ cost: 420, label: 'Advanced course: about 125 s', holdS: 125 },
	] },
	// boat
	hold: { name: 'Fish hold', levels: [
		{ cost: 0, label: 'Cooler', holdKg: 30 },
		{ cost: 120, label: 'Ice chest', holdKg: 70 },
		{ cost: 400, label: 'Insulated fish hold', holdKg: 160 },
	] },
	fuel: { name: 'Fuel tank', levels: [
		{ cost: 0, label: '40 L tank', fuelL: 40 },
		{ cost: 150, label: '80 L tank', fuelL: 80 },
		{ cost: 380, label: '150 L tank', fuelL: 150 },
	] },
	engine: { name: 'Engine', levels: [
		{ cost: 0, label: 'Tired diesel', speedMul: 1 },
		{ cost: 300, label: 'Rebuilt diesel', speedMul: 1.15 },
		{ cost: 700, label: 'Turbo diesel', speedMul: 1.3 },
	] },
	fishFinder: { name: 'Fish finder', levels: [
		{ cost: 0, label: 'None', finder: false },
		{ cost: 250, label: 'Fish finder (depth and fish on the HUD)', finder: true },
	] },
	lights: { name: 'Boat lights', levels: [
		{ cost: 0, label: 'Nav lights only', deckLights: false },
		{ cost: 140, label: 'Deck floodlights for night dives', deckLights: true },
	] },
};

export const FUEL_PRICE = 1.5; // $ per litre of diesel at the chandlery
// litres per second at the helm: idle plus a lot more at full rpm (40 L lasts ~25 min flat out)
export function fuelBurn( rpm ) {

	return 0.0025 + 0.024 * rpm * rpm;

}

// next level of a track, or null when maxed
export function nextLevel( upgrades, key ) {

	const lv = UPGRADES[ key ].levels;
	const i = ( upgrades[ key ] | 0 ) + 1;
	return i < lv.length ? { index: i, ...lv[ i ] } : null;

}

export function defaultUpgrades() {

	const u = {};
	for ( const k in UPGRADES ) u[ k ] = 0;
	return u;

}

// merged stats of the current levels
export function gearStats( upgrades ) {

	const s = {};
	for ( const k in UPGRADES ) {

		const lv = UPGRADES[ k ].levels;
		const i = Math.max( 0, Math.min( lv.length - 1, upgrades[ k ] | 0 ) );
		for ( const [ key, v ] of Object.entries( lv[ i ] ) ) if ( key !== 'cost' && key !== 'label' ) s[ key ] = v;

	}

	return s;

}
