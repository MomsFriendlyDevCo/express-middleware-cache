var _ = require('lodash');
var axios = require('axios');
var bodyParser = require('body-parser');
var emc = require('..');
var emcConfig = require('./config');
var exec = require('child_process').exec;
var expect = require('chai').expect;
var express = require('express');
var expressLogger = require('express-log-url');
var mlog = require('mocha-logger');

var app = express();
var server;

var port = 8181;
var url = 'http://localhost:' + port;

describe('Cache invalidation (same process)', ()=> {

	// EMC Setup {{{
	before('create EMC instance', done => emc.setup(emcConfig, done));

	before('clear out existing EMC cache', done =>
		emc.invalidate('tag-1h', done)
	);
	// }}}

	// Express Setup {{{
	before('setup server', function(finish) {
		this.timeout(10 * 1000);

		app.use(expressLogger);
		app.use(bodyParser.json());
		app.set('log.indent', '      ');

		app.get('/cache/1h', emc('1h', {tag: 'tag-1h'}), (req, res) => res.send({random: _.random(0, 99999999)}));

		server = app.listen(port, null, function(err) {
			if (err) return finish(err);
			mlog.log('Server listening on ' + url);
			finish();
		});
	});

	var events = {
		routeCacheHit: [],
		routeCacheHashError: [],
		routeCacheEtag: [],
		routeCacheExisting: [],
		routeCacheFresh: [],
	};
	before('setup event counters', () => {
		emc.events.on('routeCacheHit', req => events.routeCacheHit.push(req));
		emc.events.on('routeCacheHashError', (req, err) => events.routeCacheHit.push(err));
		emc.events.on('routeCacheEtag', req => events.routeCacheEtag.push(req));
		emc.events.on('routeCacheExisting', req => events.routeCacheExisting.push(req));
		emc.events.on('routeCacheFresh', req => events.routeCacheFresh.push(req));
	});

	after('server teardown', finish => {
		if (server) {
			server.close(finish);
		} else {
			finish();
		}
	});
	// }}}

	// Axios config {{{
	before('Axios setup', ()=> {
		axios.defaults.headers.common.Accept = 'application/json';
		axios.defaults.validateStatus = status => {
			return status >= 200 && status < 400; // Override 200 range only to also accept 3??
		};
	});
	// }}}

	var lastRes;
	it('should cache something for 1 hour', ()=>
		axios.get(`${url}/cache/1h`)
			.then(res => {
				expect(res.status).to.be.equal(200);
				expect(res.data).to.have.property('random');
				lastRes = res;
			})
	);

	it('should get the same response within 1h', ()=>
		axios.get(`${url}/cache/1h`)
			.then(res => {
				expect(res.status).to.be.equal(200);
				expect(res.data).to.have.property('random');
				expect(res.headers).to.have.property('etag');
				expect(res.data.random).to.equal(lastRes.data.random);
			})
	);

	it('should get the same response if provided with the same etag', ()=>
		axios.get(`${url}/cache/1h`, {
			headers: {
				etag: lastRes.headers.etag,
			},
		})
			.then(res => {
				expect(res.status).to.be.equal(304);
				expect(res.data).to.be.deep.equal('');
			})
	);

	it('should get a full response if provided with a different etag', ()=>
		axios.get(`${url}/cache/1h`, {
			headers: {
				etag: 'nonsense-etag',
			},
		})
			.then(res => {
				expect(res.status).to.be.equal(200);
				expect(res.data).to.have.property('random');
				expect(res.data.random).to.equal(lastRes.data.random);
			})
	);

	it('should invalidate the cache', done =>
		emc.invalidate('tag-1h', done)
	);

	it('should get a different request post-invalidation', ()=>
		axios.get(`${url}/cache/1h`)
			.then(res => {
				expect(res.data).to.have.property('random');
				expect(res.data.random).to.not.equal(lastRes.data.random);
				lastRes = res;
			})
	);

	it('should get the same response again', ()=>
		axios.get(`${url}/cache/1h`)
			.then(res => {
				expect(res.data).to.have.property('random');
				expect(res.data.random).to.equal(lastRes.data.random);
			})
	);

	it('should have fired the correct number of event handlers', ()=> {
		expect(events.routeCacheHit).to.have.length(6);
		expect(events.routeCacheHashError).to.have.length(0);
		expect(events.routeCacheEtag).to.have.length(1);
		expect(events.routeCacheExisting).to.have.length(3);
		expect(events.routeCacheFresh).to.have.length(2);
	});

});
