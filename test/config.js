/**
* EMC config to be used when testing
* Ideally this should use a shared component (i.e. not the 'memory' module). memcachd is recommended as it requires minimal config
*/
module.exports = {
	cache: {
		modules: ['memcached'],
	},
};
