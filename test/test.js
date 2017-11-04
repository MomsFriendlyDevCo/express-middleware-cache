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
	before(function(finish) {
		this.timeout(10 * 1000);

		app.use(expressLogger);
		app.use(bodyParser.json());
		app.set('log.indent', '      ');

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

	after(function(finish) {
		server.close(finish);
	});
	// }}}

	[
		{label: '100ms', min: 100, invalidate: 120, max: 300, text: '100ms', url: `${url}/cache/100ms`},
		{label: '1s', min: 1000, invalidate: 1200, max: 3000, text: '1 second', url: `${url}/cache/1s`},
		{label: '2 seconds', min: 2000, invalidate: 2200, max: 3500, text: '2 seconds', url: `${url}/cache/2s`},
	].forEach(time => {

		it(`should cache something for ${time.text} (${time.label}, invalidated > ${time.invalidate/1000})`, function(done) {
			this.timeout(time.max);

			mlog.log(`initial request < ${time.min} (uncached)`)
			superagent.get(time.url)
				.end((err, resOne) => {
					expect(err).to.not.be.ok;
					expect(resOne.body).to.have.property('random');
					expect(resOne.headers).to.have.property('etag');

					mlog.log(`second request (within cache range, last result = ${resOne.body.random})`)
					superagent.get(time.url)
						.end((err, resTwo) => {
							expect(err).to.not.be.ok;
							expect(resTwo.body).to.have.property('random');
							expect(resTwo.body.random).to.equal(resOne.body.random);
							expect(resTwo.headers).to.have.property('etag');
							expect(resTwo.headers.etag).to.equal(resOne.headers.etag);

							setTimeout(()=> {
								mlog.log('third request (after cache range)')
								superagent.get(time.url)
									.end((err, resThree) => {
										expect(err).to.not.be.ok;
										expect(resThree.body).to.have.property('random');
										expect(resThree.body.random).to.not.equal(resOne.body.random);
										expect(resThree.headers).to.have.property('etag');
										expect(resThree.headers.etag).to.not.equal(resTwo.headers.etag);

										done();
									});
							}, time.invalidate);
						});
				});
		});

	});

});
