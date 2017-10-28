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
				lastRes = res.body;
				done();
			});
	});

	it('should get the same response within 1h', done => {
		superagent.get(`${url}/cache/1h`)
			.end((err, res) => {
				expect(err).to.not.be.ok;
				expect(res.body).to.have.property('random');
				expect(res.body.random).to.equal(lastRes.random);
				done();
			});
	});

	it('should invalidate the cache', ()=> {
		emc.invalidate('1h');
	});

	it('should get a different request post-invalidation', done => {
		superagent.get(`${url}/cache/1h`)
			.end((err, res) => {
				expect(err).to.not.be.ok;
				expect(res.body).to.have.property('random');
				expect(res.body.random).to.not.equal(lastRes.random);
				lastRes = res.body;
				done();
			});
	});

	it('should get the same response again', done => {
		superagent.get(`${url}/cache/1h`)
			.end((err, res) => {
				expect(err).to.not.be.ok;
				expect(res.body).to.have.property('random');
				expect(res.body.random).to.equal(lastRes.random);
				done();
			});
	});

});
