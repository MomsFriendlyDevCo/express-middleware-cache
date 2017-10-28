var _ = require('lodash');
var cache = require('@momsfriendlydevco/cache');
var events = require('events');
var timestring = require('timestring');

/**
* Factory function which returns a caching object which returns an the Expres function
* @param {string} [duration] timestring compatible duration to cache for (sets options.duration)
* @param {Object} [options] Additional options to use, overrides emc.defaults
* @see emc.defaults
*/
var emc = function(duration, options) {
	// Argument mangling (sets `settings`) {{{
	var settings = _.clone(emc.defaults);
	if (_.isObject(duration)) { // Given object
		_.merge(settings, duration);
	} else if (_.isString(duration) && _.isObject(options)) { // Given string + object, assume duration + settings
		settings.duration = duration;
		_.merge(settings, options);
	} else if (_.isString(duration) && _.isUndefined(options)) { // Given string - assume its a duration
		settings.duration = duration;
	} else {
		throw new Error(`Unknown invokation method: ${typeof duration} ${typeof options}`);
	}
	// }}}

	// Settings parsing {{{
	settings.durationMS = timestring(settings.duration) * 1000;
	// }}}

	// Make our caching object {{{
	settings.cache = new cache(settings.cache);
	// }}}

	// Store the settings object in emc.tagStore if it has a valid tag/tags {{{
	var tag = settings.tag || settings.tags;
	if (tag) {
		settings.hashes = []; // Make storage for hashes (used to remember/forget future cache storage on .invalidate() calls)
		_.castArray(tag).forEach(tag => {
			if (! emc.tagStore[tag]) emc.tagStore[tag] = [];
			emc.tagStore[tag].push(settings);
		});
	}
	// }}}

	return function(req, res, next) {
		// Emit: routeCacheHit(req) {{{
		emc.events.emit('routeCacheHit', req);
		// }}}

		var hash = settings.cache.hash(settings.hashObject(req));

		settings.cache.get(hash, settings.cacheFallback, (err, cacheRes) => {
			if (err) {
				console.log('Error while computing hash', err);
				emc.events.emit('routeCacheHashError', err, req);
				return res.sendStatus(500);
			} else if (cacheRes !== settings.cacheFallback) { // Got a hit
				emc.events.emit('routeCacheExisting', req);
				res.send(cacheRes);
			} else { // No cache object - allow request to pass though
				// Replace res.json() with our own handler {{{
				var oldJSONHandler = res.json;
				var servedJSON;
				res.json = function() {
					// Are we storing hashes against tags? In which case we need to stash the hash we're about to set so we can forget it on demand {{{
					if (settings.hashes) settings.hashes.push(hash);
					// }}}

					settings.cache.set(hash, arguments[0], new Date(Date.now() + settings.durationMS), err => {
						emc.events.emit('routeCacheFresh', req);
						oldJSONHandler.apply(this, arguments); // Let the downstream serve the data as needed
					});
				};
				// }}}

				return next();
			}
		});
	};
};


/**
* Default options to use when initalizing new EMC factories
* @var {Object}
* @param {string} [options.duration] Timestring compatible duration to cache the response for
* @param {Object} [options.cache] Options passed to @momsfriendlydevco/cache to initalize a cache object
* @param {function} [options.hashObject] Method which returns the hashable object to use as the key in the cache. Defaults to hashing `req.{method,path,query,body}`
*/
emc.defaults = {
	duration: '1h', // Human parsable duration
	durationMS: 1000 * 60 * 60, // Parsed version of duration in MS
	cache: {}, // Options passed to @momsfriendlydevco/cache
	hashObject: req => ({ // How to extract the request keys to hash
		method: req.method,
		path: req.path,
		query: req.query,
		body: req.body,
	}),
	cacheFallback: '!!NOCACHE!!', // Dummy value used via @momsfriendlydevco/cache that ensures the return has no value (as the undefined is a valid return for a cache result)
};


/**
* Invalidate all matching tags - effectively clearing the internal cache for anything matching the query
* @param {array|string} ...tags The tag or tag strings to match against
* @return {number} The number of cache hashes cleared (this does not necessarily equal the number of items removed from memory as some of the cleared items may already have expired depending on the individual cache modules used)
*/
emc.invalidate = (...tags) => {
	var cleared = 0;

	tags.forEach(tag => {
		if (!emc.tagStore[tag]) return; // Tag doesn't exist anyway
		emc.tagStore[tag].forEach(store => {
			if (!store.hashes) return;
			store.hashes.forEach(hash => {
				store.cache.unset(hash);
				cleared++;
			});
		});
	});

	return cleared;
};


/**
* Storage for EMC objects against tags
* Each key is the tag which contains an array of matching EMC objects against that tag
* @var {Object}
*/
emc.tagStore = {};


/**
* Bindable EventEmitter which can receive EMC events
* @var {EventEmitter}
*/
emc.events = new events.EventEmitter();

module.exports = emc;
