var _ = require('lodash');
var cache = require('@momsfriendlydevco/cache');
var timestring = require('timestring');

/**
* Factory function which returns a caching object which returns an the Expres function
*/
module.exports = function(duration, options) {
	var settings = {
		duration: '1h', // Human parsable duration
		durationMS: 1000 * 60 * 60, // Parsed version of duration in MS
		cache: {}, // Options passed to @momsfriendlydevco/cache
		hashObject: req => ({ // How to extract the request keys to hash
			method: req.method,
			path: req.path,
			query: req.query,
			body: req.body,
		}),
		cacheFallback: '!!NOCACHE!!', // Fallback value passed to cache (ensures that undefined is a valid return)
	};

	// Argument mangling {{{
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

	return function(req, res, next) {
		var hash = settings.cache.hash(settings.hashObject(req));

		settings.cache.get(hash, settings.cacheFallback, (err, cacheRes) => {
			if (err) {
				console.log('Error while computing hash', err);
				return res.sendStatus(500);
			} else if (cacheRes !== settings.cacheFallback) { // Got a hit
				res.send(cacheRes);
			} else { // No cache object - allow request to pass though
				// Replace res.json() with our own handler {{{
				var oldJSONHandler = res.json;
				var servedJSON;
				res.json = function() {
					settings.cache.set(hash, arguments[0], new Date(Date.now() + settings.durationMS), err => {
						oldJSONHandler.apply(this, arguments); // Let the downstream serve the data as needed
					});
				};
				// }}}

				return next();
			}
		});
	};
};
