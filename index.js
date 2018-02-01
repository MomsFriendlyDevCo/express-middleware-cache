var _ = require('lodash');
var async = require('async-chainable');
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

	// Store the settings object in tagStore if it has a valid tag/tags {{{
	var tag = settings.tag || settings.tags;
	if (tag) {
		settings.hashes = []; // Make storage for hashes (used to remember/forget future cache storage on .invalidate() calls)
		_.castArray(tag).forEach(tag => {
			async()
				// Fetch tag store {{{
				.set('tsID', `${settings.tagStorePrefix}-${tag}`)
				.then('store', function(next) {
					settings.cache.get(this.tsID, [], next);
				})
				// }}}
				// Append to it {{{
				.then(function(next) {
					this.store.push(settings);
					next();
				})
				// }}}
				// Save it back {{{
				.then(function(next) {
					settings.cache.set(this.tsID, this.store, next);
				})
				// }}}
				.end();
		});
	}
	// }}}


	/**
	* Main emcInstance worker
	* @param {Object} req The ExpressJS compatible request object
	* @param {Object} res The ExpressJS comaptible response object
	* @param {function} next The upstream callback to pass control to the next middleware
	*/
	var emcInstance = function(req, res, next) {
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

					var etag = settings.generateEtag(hash, settings);
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

	/**
	* Invalidate all matching tags - effectively clearing the internal cache for anything matching the query
	* @param {array|string} tags The tag or tag strings to match against
	* @param {function} cb Callback to call as (err, clearedCount) when complete
	* @return {number} The number of cache hashes cleared (this does not necessarily equal the number of items removed from memory as some of the cleared items may already have expired depending on the individual cache modules used)
	*/
	emcInstance.invalidate = (tags, cb) => {
		var cleared = 0;

		async()
			.forEach(_.castArray(tags), function(nextTag, tag) {
				async()
					// Fetch tag store {{{
					.set('tsID', `${settings.tagStorePrefix}-${tag}`)
					.then('tagStore', function(next) {
						settings.cache.get(this.tsID, [], next);
					})
					// }}}
					 // Erase all ID's assocated with the tag {{{
					.forEach('tagStore', function(nextStore, store) {
						async()
							.forEach(store.hashes, function(next, hash) {
								store.cache.unset(hash, next);
							})
							.then(function(next) {
								cleared++;
								next();
							})
							.end(nextStore);
					})
					// }}}
					.end(nextTag);
			})
			.end(err => {
				if (_.isFunction(cb)) {
					cb(err, cleared)
				} else if (err) {
					throw new Error(err);
				}
			});
	};

	// Subscribe to event emitter?
	if (settings.subscribe) emc.events.on('routeCacheInvalidateRequest', (tags, cb) => emcInstance.invalidate(tags, cb));

	return emcInstance;
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
	generateEtag: (hash, settings) => settings.cache.hash(hash + '-' + Date.now()),
	subscribe: true,
	tagStorePrefix: 'emc-tagstore',
};


/**
* Function to invoke 'invalidate' on all EMC objects subscribed to the emc.events EventEmitter
* @param {array|string} tags Tag or tags to invalidate
* @param {function} [cb] Optional callback to fire when complete
*/
emc.invalidate = (tags, cb) => emc.events.emit('routeCacheInvalidateRequest', tags, cb);


/**
* Bindable EventEmitter which can receive EMC events
* @var {EventEmitter}
*/
emc.events = new events.EventEmitter();

module.exports = emc;
