@MomsFriendlyDevCo/express-middleware-cache
===========================================
Express middleware for caching the result of a server action in-memory, MongoDB or MemcacheD.


Features:

* Easy to use syntax - Specify cache times in shorthand durations such as `app.get('/some/api', cache('1h'), (req, res) => ...)`
* Cache invalidation - Provide a tag for your cache setup and quickly invalidate all matching routes if necessary
* Pluggable interface - Not just in-memory storage! Add any FIXME plugin to hold cache contents over server restarts



Simple example
--------------

```javascript
var cache = require('@momsfriendlydevco/route-cache');

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

| Option       | Type               | Default              | Description                                                                                       |
|--------------|--------------------|----------------------|---------------------------------------------------------------------------------------------------|
| `duration`   | `string`           | `1h`                 | Default duration to cache for                                                                     |
| `cache`      | `object`           | `{}`                 | Options passed to [@momsfriendlydevco/cache](https://github.com/MomsFriendlyDevCo/generic-cache) to setup a cache instance |
| `hashObject` | `function`         | Complex              | Method which returns the hashable object to use as the key in the cache. Defaults to hashing `req.{method,path,query,body}` |
| `tag`        | `string` / `array` | `''`                 | Optional tag or tags to associate with the cache. These can be used to invalidate the cache later |
| `tags`       | `string` / `array` | `''`                 | Alias of `tag`                                                                                    |



cache(duration, options)
------------------------
The basic cache factory. This function returns Express middleware tuned to the duration and options specified.

Options extend `cache.defaults`.


cache.invalidate(...tags)
-------------------------
Reset the caching of any cache matching the given tag, array of tags or multiple tags.


cache.events
------------
An `EventEmitter` instance which can be bound to in order to retrieve events.

Events fired:

| Event             | Called as | Description                                                                              |
|-------------------|-----------|------------------------------------------------------------------------------------------|
| `routeInit`       | `(path)`  | Fired when a new route is registered                                                     |
| `routeHit`        | `(req)`   | Fired when a route is requested that is handled by route-cache                           |
| `routeServed`     | `(req)`   | Fired when a route is requested, a valid cache does not exist and it will be served      |
| `routePostServed` | `(req)`   | Fired after a route is requested, a valid cache does not exist and has been served       |
| `routeCacheServe` | `(req)`   | Fired when a route is requested but a cached version exists and will be provided instead |
