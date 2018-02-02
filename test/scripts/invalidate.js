/**
* Simple script to connect to EMC and fire an invalidation request
* This script tests that invalidation works from seperate processes
* NOTE: Since this uses shared resources the module used by EMC cannot be 'memory'
*/

var _ = require('lodash');
var emc = require('../..');
var emcConfig = require('../config');
var emcTag = '1h';

_.merge(emc.defaults, emcConfig);

// Make a fake caching object so we connect to a cache service (needed to invalidate)
var fakeCacher = emc('10h', (req, res) => res.send('You should never see this'));

console.log(`Invalidating tag "${emcTag}"...`);

emc.invalidate(emcTag, (err, released) => {
	if (err) {
		console.log('ERROR:', err.toString());
		process.exit(1);
	} else {
		console.log(`Tag "${emcTag}" invalidated - released ${released} cache objects`);
		process.exit(0);
	}
});
