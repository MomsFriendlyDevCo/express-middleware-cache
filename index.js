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
	settings.cache = new cache(settings.cache)
		.on('loadedMod', mod => emc.events.emit('routeCacheCacher', mod))
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
			} else if (settings.etag && req.headers.etag && cacheRes !== settings.cacheFallback && cacheRes.etag && cacheRes.etag == req.headers.etag) { // User is supplying an etag - compare it agasint the one we have cached
				emc.events.emit('routeCacheEtag', req, {
					isFresh: false,
					hash: hash,
				});
				return res.sendStatus(304);
			} else if (cacheRes !== settings.cacheFallback) { // Got a hit
				emc.events.emit('routeCacheExisting', req, {
					isFresh: false,
					hash: hash,
				});
				if (settings.etag) res.set('etag', cacheRes.etag);
				res.send(cacheRes.content);
			} else { // No cache object - allow request to pass though
				// Replace res.json() with our own handler {{{
				var oldJSONHandler = res.json;
				var servedJSON;
				res.json = function() {
					// Are we storing hashes against tags? In which case we need to stash the hash we're about to set so we can forget it on demand {{{
					if (settings.hashes) settings.hashes.push(hash);
					// }}}

					var etag = emc.generateEtag(hash, settings);
					settings.cache.set(
						hash,
						{
							content: arguments[0],
							etag: etag,
						},
						new Date(Date.now() + settings.durationMS),
						err => {
							emc.events.emit('routeCacheFresh', req, {
								isFresh: true,
								hash: hash,
							});
							if (settings.etag) res.set('etag', etag);
							oldJSONHandler.apply(this, arguments); // Let the downstream serve the data as needed
						}
					);
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
* @param {string} [defaults.duration] Timestring compatible duration to cache the response for
* @param {Object} [defaults.cache] Options passed to @momsfriendlydevco/cache to initalize a cache object
* @param {function} [defaults.hashObject] Method which returns the hashable object to use as the key in the cache. Defaults to hashing `req.{method,path,query,body}`
* @param {boolean} [defaults.etag] Transmit an etag header when sending the cache to the client
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
	etag: true,
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
				emc.events.emit('routeCacheInvalidate', tag, hash);
				store.cache.unset(hash);
				cleared++;
			});
		});
	});

	return cleared;
};


/**
* Generate a 'fresh' etag based on the given hash result
* This should take the hash, add some entropy and return the result
* This function can be replaed with another entropy generating system if required
* @param {string} hash The hash generated for the request
* @param {Object} settings Settings objected used by the upstream hashing component
* @return {string} The new etag to use
*/
emc.generateEtag = (hash, settings) => {
	return settings.cache.hash(hash + '-' + Date.now());
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
