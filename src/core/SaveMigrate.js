// One Breath was forked from Tidewater: carry the old 'tidewater.*' saves over to 'onebreath.*'
// once, so a renamed build keeps your gear, money, guide progress and settings tab.
// The old keys are left in place (the original game on the same origin still reads them).

const OLD = 'tidewater.', NEW = 'onebreath.';

export function migrateSaves( storage = globalThis.localStorage ) {

	if ( ! storage ) return 0;
	let moved = 0;
	try {

		for ( let i = 0; i < storage.length; i ++ ) {

			const key = storage.key( i );
			if ( ! key || ! key.startsWith( OLD ) ) continue;
			const to = NEW + key.slice( OLD.length );
			if ( storage.getItem( to ) !== null ) continue;
			storage.setItem( to, storage.getItem( key ) );
			moved ++;

		}

	} catch ( e ) { /* storage blocked: start fresh */ }
	return moved;

}
