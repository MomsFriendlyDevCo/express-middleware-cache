var _ = require('lodash');
var bodyParser = require('body-parser');
var emc = require('..');
var expect = require('chai').expect;
var express = require('express');
var expressLogger = require('express-log-url');
var mlog = require('mocha-logger');
var superagent = require('superagent');

var app = express();
var server;

var port = 8181;
var url = 'http://localhost:' + port;

describe('Cache invalidation', ()=> {

	// Express Setup {{{
	before(function(finish) {
		this.timeout(10 * 1000);

		app.use(expressLogger);
		app.use(bodyParser.json());
		app.set('log.indent', '      ');

		app.get('/cache/1h', emc('1h', {tag: '1h'}), (req, res) => {
			res.send({random: _.random(0, 99999999)});
		});
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
	before(() => {
		emc.events.on('routeCacheHit', req => events.routeCacheHit.push(req));
		emc.events.on('routeCacheHashError', (req, err) => events.routeCacheHit.push(err));
		emc.events.on('routeCacheEtag', req => events.routeCacheEtag.push(req));
		emc.events.on('routeCacheExisting', req => events.routeCacheExisting.push(req));
		emc.events.on('routeCacheFresh', req => events.routeCacheFresh.push(req));
	});

	after(function(finish) {
		server.close(finish);
	});
	// }}}

	var lastRes;
	it('should cache something for 1 hour', done => {
		superagent.get(`${url}/cache/1h`)
			.end((err, res) => {
				expect(err).to.not.be.ok;
				expect(res.body).to.have.property('random');
				lastRes = res;
				done();
			});
	});

	it('should get the same response within 1h', done => {
		superagent.get(`${url}/cache/1h`)
			.end((err, res) => {
				expect(err).to.not.be.ok;
				expect(res.statusCode).to.be.equal(200);
				expect(res.body).to.have.property('random');
				expect(res.headers).to.have.property('etag');
				expect(res.body.random).to.equal(lastRes.body.random);
				done();
			});
	});

	it('should get the same response if provided with the same etag', done => {
		superagent.get(`${url}/cache/1h`)
			.set('etag', lastRes.headers.etag)
			.end((err, res) => {
				expect(err).to.be.ok; // Not modified
				expect(res.statusCode).to.be.equal(304);
				expect(res.body).to.be.deep.equal({});
				done();
			});
	});

	it('should get a full response if provided with a different etag', done => {
		superagent.get(`${url}/cache/1h`)
			.set('etag', 'nonsense-etag')
			.end((err, res) => {
				expect(err).to.not.be.ok;
				expect(res.statusCode).to.be.equal(200);
				expect(res.body).to.have.property('random');
				expect(res.body.random).to.equal(lastRes.body.random);
				done();
			});
	});

	it('should invalidate the cache', done => {
		emc.invalidate('1h', done);
	});

	it('should get a different request post-invalidation', done => {
		superagent.get(`${url}/cache/1h`)
			.end((err, res) => {
				expect(err).to.not.be.ok;
				expect(res.body).to.have.property('random');
				expect(res.body.random).to.not.equal(lastRes.body.random);
				lastRes = res;
				done();
			});
	});

	it('should get the same response again', done => {
		superagent.get(`${url}/cache/1h`)
			.end((err, res) => {
				expect(err).to.not.be.ok;
				expect(res.body).to.have.property('random');
				expect(res.body.random).to.equal(lastRes.body.random);
				done();
			});
	});

	it('should have fired the correct number of event handlers', ()=> {
		expect(events.routeCacheHit).to.have.length(6);
		expect(events.routeCacheHashError).to.have.length(0);
		expect(events.routeCacheEtag).to.have.length(1);
		expect(events.routeCacheExisting).to.have.length(3);
		expect(events.routeCacheFresh).to.have.length(2);
	});

});
