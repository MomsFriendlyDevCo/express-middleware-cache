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

describe('Basic cache setup', ()=> {

	// Express Setup {{{
	before('server setup', finish => {
		this.timeout(10 * 1000);

		app.set('log.indent', '      ');
		app.use(expressLogger);
		app.use(bodyParser.json());

		app.get('/cache/100ms', emc('100ms'), (req, res) => {
			res.send({random: _.random(0, 99999999)});
		});

		app.get('/cache/1s', emc('1s'), (req, res) => {
			res.send({random: _.random(0, 99999999)});
		});

		app.get('/cache/2s', emc('2 seconds'), (req, res) => {
			res.send({random: _.random(0, 99999999)});
		});

		server = app.listen(port, null, function(err) {
			if (err) return finish(err);
			mlog.log('Server listening on ' + url);
			finish();
		});
	});

	after(finish => server.close(finish));
	// }}}

	[
		{label: '100ms', min: 100, invalidate: 120, max: 500, text: '100ms', url: `${url}/cache/100ms`},
		{label: '1s', min: 1000, invalidate: 1200, max: 5000, text: '1 second', url: `${url}/cache/1s`},
		{label: '2 seconds', min: 2000, invalidate: 2200, max: 8000, text: '2 seconds', url: `${url}/cache/2s`},
	].forEach(time => {

		describe(`should cache something for ${time.text} (${time.label}, invalidated > ${time.invalidate/1000})`, function() {
			this.timeout(time.max);

			var responses = [];
			it(`should make the initial request < ${time.min} (uncached)`, done => {
				superagent
					.get(time.url)
					.end((err, res) => {
						if (err) return done(err);
						responses.push(res);
						done();
					});
			});

			it('should have a valid response the first time', ()=> {
				expect(responses[0].body).to.have.property('random');
				expect(responses[0].headers).to.have.property('etag');
			});

			it(`should make the second request (within cache range)`, done => {
				superagent
					.get(time.url)
					.end((err, res) => {
						if (err) return done(err);
						responses.push(res);
						done();
					});
			});

			it('should have a valid response the second time', ()=> {
				expect(responses[1].body).to.have.property('random');
				expect(responses[1].body.random).to.equal(responses[0].body.random);
				expect(responses[1].headers).to.have.property('etag');
				expect(responses[1].headers.etag).to.equal(responses[0].headers.etag);
			});

			it(`should wait the invalidation period (${time.invalidate}ms)`, done => {
				setTimeout(()=> done(), time.invalidate);
			});


			it('should make the third request (after cache range)', done => {
				superagent
					.get(time.url)
					.end((err, res) => {
						if (err) return done(err);
						responses.push(res);
						done();
					});
			});

			it('should have a valid response the third time', ()=> {
				expect(responses[2].body).to.have.property('random');
				expect(responses[2].body.random).to.not.equal(responses[0].body.random);
				expect(responses[2].headers).to.have.property('etag');
				// FIXME: Should etag be identical or different after invalidation - MC 2017-11-22
				// expect(responses[2].headers.etag).to.not.equal(responses[1].headers.etag);
			});

		});

	});

});
