@MomsFriendlyDevCo/express-middleware-cache
===========================================
Express middleware for caching the result of a server action in-memory, MongoDB or MemcacheD.


Features:

* Easy to use syntax - Specify cache times in shorthand durations such as `app.get('/some/api', cache('1h'), (req, res) => ...)`
* Cache invalidation - Provide a tag for your cache setup and quickly invalidate all matching routes if necessary
* Etag support - Allows the client to make a request by the server generated hash and recieve either a code 200 (with data) or a 304 (Not Modified) response without actually making a full request
* Pluggable interface - Not just in-memory storage! Add any FIXME plugin to hold cache contents over server restarts



Simple example
--------------

```javascript
var cache = require('@momsfriendlydevco/route-cache');

// Setup the cache (configure which modules to try etc.)
await util.promisify(ache.setup)();

// This route should cache for about about 30 seconds
app.get('/some/api/hourly', cache('30s'), (req, res) => ...)

// This route should cache for about a minute and a half
app.get('/some/api/hourly', cache('1m30s'), (req, res) => ...)

// This route should cache for an hour
app.get('/some/api/hourly', cache('1h'), (req, res) => ...)
```


Cache invalidation
------------------
When setting up a cache specify `tag` / `tags` and invalidate against them when you want all calls to that route to be refreshed.

```javascript
// Make a route which only gets refreshed every hour

app.get('/some/api', cache('1h', {tag: 'myApi'}), (req, res) => ...)


// Later after some action which requires a cache reset:

cache.invalidate('myApi');
```


API
===

cache.defaults
--------------
Object containing any future caching objects options.

Supported options:

| Option           | Type               | Default                       | Description                                                                                       |
|------------------|--------------------|-------------------------------|---------------------------------------------------------------------------------------------------|
| `duration`       | `string`           | `1h`                          | Default duration to cache for                                                                     |
| `cache`          | `object`           | `{}`                          | Options passed to [@momsfriendlydevco/cache](https://github.com/MomsFriendlyDevCo/generic-cache) to setup a cache instance |
| `hashObject`     | `function`         | See internals                 | Method which returns the hashable object to use as the key in the cache. Defaults to hashing `req.{method,path,query,body}` |
| `tag`            | `string` / `array` | `''`                          | Optional tag or tags to associate with the cache. These can be used to invalidate the cache later. If any member is a function it is called as `(req, res)` and expected to return a string |
| `tags`           | `string` / `array` | `''`                          | Alias of `tag`                                                                                    |
| `etag`           | `boolean`          | `true`                        | Use eTag compatible caching with backend (only refresh when the server eTag doesn't match)        |
| `generateEtag`   | `function`         | See internals                 | Callback-style function used to generate an eTag value. Called as `(cb, hash, settings)`          |
| `subscribe`      | `boolean`          | `true`                        | Subscribe the returned EMC instance to the `emc.events` eventEmitter to react to gloabl events such as calls to `emc.invalidate()` |
| `tagStorePrefix` | `string`           | `"emc-tagstore"`              | Prefix to use when caching tagStore collections                                                   |
| `cacheQuery`     | `function`         | `(req, res, content) => true` | Replacable function used to determine if the request should be cached. Replacing this with `(req, res) => res.statusCode == 200` would only cache 200 codes for example |



cache(duration, options)
------------------------
The basic cache factory. This function returns Express middleware tuned to the duration and options specified.

Options extend `cache.defaults`.


cache.setup(options, [callback])
--------------------------------
Initial setup function. This must be called before the caching system can actually be used.

You can also pass in options that override the defaults.


cache.invalidate(...tags)
-------------------------
Reset the caching of any cache matching the given tag, array of tags or multiple tags.


cache.ready
-----------
Boolean indicating if `cache.setup()` has finished its processing.


cache.events
------------
An `EventEmitter` instance which can be bound to in order to retrieve events.

Events fired:

| Event                         | Called as     | Description                                                                              |
|-------------------------------|---------------|------------------------------------------------------------------------------------------|
| `routeCacheHit`               | `(req)`       | Fired when a route is requested that is handled by route-cache                           |
| `routeCacheHashError`         | `(err, req)`  | Fired when a route hashing system fails                                                  |
| `routeCacheEtag`              | `(req, info)` | The client requested the current hash via the `etag` header and will be served a 304 "Not Modified" response |
| `routeCacheExisting`          | `(req, info)` | Fired when a route is requested, a cached version exists and will be provided instead of recomputing the result |
| `routeCacheFresh`             | `(req, info)` | Fired when a route is requested, a valid cache does not exist and we need to compute the result |
| `routeCacheInvalidate`        | `(tag, hash)` | Fired when a single tag is invalidated                                                   |
| `routeCacheCacher`            | `(driver)`    | Emitted when the upstream Cache has loaded along with the driver ID that was used        |
| `routeCacheInvalidateRequest` | `(...tags)` | Fired by `emc.invalidate()` to all upstream EMC objects to tell them to invalidate the given tags |

The info object contains the following structure:

| Key       | Type      | Description                                                            |
|-----------|-----------|------------------------------------------------------------------------|
| `isFresh` | `boolean` | Whether the cache response was generated for this specific request     |
| `hash`    | `string`  | The internal, unqiue hashing value used to identify this cache session |

