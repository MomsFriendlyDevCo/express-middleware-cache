var _ = require('lodash');
var async = require('async-chainable');
var argy = require('argy');
var cache = require('@momsfriendlydevco/cache');
var events = require('events');
var timestring = require('timestring');

/**
* Factory function which returns a caching object which returns an the Expres function
* NOTE: emc.setup() must have finished before this function is usable
* @param {string} [duration='1h'] timestring NPM module compatible duration to cache for (sets options.duration)
* @param {Object} [options] Additional options to use, overrides emc.defaults
* @see emc.defaults
*/
var emc = module.exports = argy('[string] [object]', function(duration, options) {
	if (!emc.ready) throw new Error('EMC is not yet ready. Call emc.setup(settings, callback) and wait for that before using the cache middleware');

	var settings = _.defaults(options, emc.settings); // Note we are inheriting from settings here not the defaults. The user should already have called emc.setup()
	if (duration) settings.duration = duration;
	settings.durationMS = timestring(settings.duration || '1h') * 1000;

	/**
	* Main emcInstance factory
	* Calling the main emc() function should return an ExpressJS compatible middleware function which is composed in the form (req, res, next)
	* @param {Object} req The ExpressJS compatible request object
	* @param {Object} res The ExpressJS comaptible response object
	* @param {function} next The upstream callback to pass control to the next middleware
	*/
	var emcInstance = function(req, res, next) {
		// Emit: routeCacheHit(req) {{{
		emc.events.emit('routeCacheHit', req);
		// }}}

		var hash = emc.cache.hash(settings.hashObject(req));

		emc.cache.get(hash, emc.cacheFallback, (err, cacheRes) => {
			if (err) {
				console.log('Error while computing hash', err);
				emc.events.emit('routeCacheHashError', err, req);
				return res.sendStatus(500);
			} else if (settings.etag && req.headers.etag && cacheRes !== emc.cacheFallback && cacheRes.etag && cacheRes.etag == req.headers.etag) { // User is supplying an etag - compare it agasint the one we have cached
				emc.events.emit('routeCacheEtag', req, {
					isFresh: false,
					hash: hash,
				});
				return res.sendStatus(304);
			} else if (cacheRes !== emc.cacheFallback) { // Got a hit
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
					// Does cacheQuery reject us caching this?
					if (!settings.cacheQuery(req, res, content)) {
						return oldJSONHandler.call(this, content); // Let the downstream serve the data as needed
					}

					var tags = settings.tag || settings.tags;
					tags = tags ? _.castArray(tags) : [];
					tags.forEach(t => _.isFunction(t) ? t(req, res) : t); // Flatten functions

					async()
						.set('context', this)
						// Store result in tags if we are using them {{{
						.forEach(tags, function(nextTag, tag) {
							var tagId = `${settings.tagStorePrefix}-${tag}`;

							emc.cache.get(tagId, [], function(err, tagContents) {
								tagContents.push(hash);
								emc.cache.set(tagId, tagContents, nextTag);
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
							emc.cache.set(
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

	return emcInstance;
});


/**
* Caching driver to use
* See the NPM @momsfriendlydevco/cache
* NOTE: This is asyncronously loaded so we can't expect it to be immediately available - hence why we have to wait for emc.setup() to finish
* @var {Object}
*/
emc.cache;


/**
* Simple marker to deterine if this instance of EMC has had time to boot yet
* @var {boolean}
*/
emc.ready = false;


/**
* Init the module, loading a cache
* Options provided override the defaults
* NOTE: Because the upstream cache has to load its drivers we have to wait for this function to finish before we can use the main callback. Attach a callback to this function to determine when ready.
* @param {Object} [options] Options to use for the module. See emc.defaults
* @param {function} [cb] Callback to run when the upstream caching module has finished. Callback called as (err, emc)
* @returns {Object} This chainable object
*/
emc.setup = argy('[object] [function]', function(options, callback) {
	// Set this modules settings, if given any to merge
	emc.settings = _.defaults(options, emc.defaults);

	// Make our caching object
	emc.cache = new cache(emc.settings, err => {
		emc.ready = true;
		if (callback) callback(err, emc);
	});

	return emc;
});


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
	generateEtag: (next, hash, settings) => next(null, emc.cache.hash(hash + '-' + Date.now())),
	tagStorePrefix: 'emc-tagstore',
	cacheQuery: (req, res, content) => true,
};


/**
* The current instances settings
* This is usually inherited from emc.defaults unless a specific setting is overridden
* @see emc.defaults
* @var {Object}
*/
emc.settings = _.clone(emc.defaults);


/**
* Invalidate all matching tags - effectively clearing the internal cache for anything matching the query
* @param {array|string} tags The tag or tag strings to match against
* @param {function} [cb] Callback to call as (err, clearedCount) when complete
* @return {Object} This chainable object
*/
emc.invalidate = function(tags, cb) {
	var cleared = 0;

	async()
		.forEach(_.castArray(tags), function(nextTag, tag) {
			async()
				// Fetch tag store {{{
				.set('tsID', `${emc.settings.tagStorePrefix}-${tag}`)
				.then('tagStore', function(next) {
					emc.cache.get(this.tsID, [], next);
				})
				// }}}
				 // Erase all ID's assocated with the tag {{{
				.forEach('tagStore', function(nextHash, hash) {
					emc.cache.unset(hash, nextHash);
				})
				// }}}
				// Erase the tag store {{{
				.then(function(next) {
					emc.cache.unset(this.tsID, next);
				})
				// }}}
				// Track how many items we've cleared {{{
				.then(function(next) {
					cleared += this.tagStore.length;
					next();
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

	return emc;
};


/**
* Bindable EventEmitter which can receive EMC events
* @var {EventEmitter}
*/
emc.events = new events.EventEmitter();
