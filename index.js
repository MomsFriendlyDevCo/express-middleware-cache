var _ = require('lodash');
var async = require('async-chainable');
var argy = require('argy');
var cache = require('@momsfriendlydevco/cache');
var events = require('events');
var timestring = require('timestring');

/**
* Factory function which returns a caching object which returns an the Expres function
* @param {string} [duration='1h'] timestring NPM module compatible duration to cache for (sets options.duration)
* @param {Object} [options] Additional options to use, overrides emc.defaults
* @see emc.defaults
*/
var emc = argy('[string] [object] [function]', function(duration, options, callback) {
	var settings = _.clone(emc.defaults);

	// Settings parsing {{{
	settings.durationMS = timestring(settings.duration) * 1000;
	// }}}

	// Make our caching object {{{
	settings.cache = new cache(settings.cache, err => {
		if (err) throw new Error('Unable to allocate cache: ' + err.toString());
	});


	settings.cache.on('loadedMod', mod => emc.events.emit('routeCacheCacher', mod))
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
				res.json = function(content) {
					async()
						.set('context', this)
						// Store result in tags if we are using them {{{
						.set('tags', _.castArray(settings.tag || settings.tags))
						.forEach('tags', function(nextTag, tag) {
							var tagId = `${settings.tagStorePrefix}-${tag}`;

							settings.cache.get(tagId, [], function(err, tagContents) {
								tagContents.push(hash);
								console.log('SET TAG', tag, tagId, tagContents);
								settings.cache.set(tagId, tagContents, nextTag);
							});
						})
						// }}}
						// Generate an etag (optional) {{{
						.then('etag', function(next) {
							if (!settings.etag) return next();
							settings.generateEtag(next, hash, settings);
						})
						// }}}
						// Save the response contents into the cache {{{
						.then(function(next) {
							settings.cache.set(
								hash,
								Object.assign({content}, settings.etag ? {etag: this.etag} : {}),
								new Date(Date.now() + settings.durationMS),
								next
							);
						})
						// }}}
						// Fire 'routeCacheFresh' {{{
						.then(function(next) {
							emc.events.emit('routeCacheFresh', req, {
								isFresh: true,
								hash: hash,
							});
							next();
						})
						// }}}
						// End - either crash out or revert to the default ExpressJS handler to pass the result onto the upstream {{{
						.end(function(err) {
							if (err) {
								res.status(500).end();
								throw new Error(err);
							} else {
								res.type('application/json');
								if (settings.etag) res.set('etag', this.etag);
								oldJSONHandler.call(this.context, content); // Let the downstream serve the data as needed
							}
						});
						// }}}
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
					.forEach('tagStore', function(nextHash, hash) {
						settings.cache.unset(hash, nextHash);
					})
					// }}}
					.then(function(next) {
						cleared += this.tagStore.length;
						next();
					})
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
	generateEtag: (next, hash, settings) => next(null, settings.cache.hash(hash + '-' + Date.now())),
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
