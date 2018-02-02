/**
* EMC config to be used when testing
* Ideally this should use a shared component (i.e. not the 'memory' module) so that state is shared. memcachd is recommended as it requires minimal config
*/
module.exports = {
	cache: {
		modules: ['memcached'],
	},
};
