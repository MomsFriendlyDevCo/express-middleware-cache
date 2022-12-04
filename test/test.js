var _ = require('lodash');
var axios = require('axios');
var bodyParser = require('body-parser');
var emc = require('..');
var emcConfig = require('./config');
var expect = require('chai').expect;
var express = require('express');
var expressLogger = require('express-log-url');
var mlog = require('mocha-logger');

var app = express();
var server;

var port = 8181;
var url = 'http://localhost:' + port;

describe('Caching scenarios', ()=> {

	// EMC Setup {{{
	before('setup EMC', done => emc.setup(emcConfig, done));
	// }}}

	// Express Setup {{{
	before('server setup', function(finish) {
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

		app.get('/cache/3000ms', emc('3000ms'), (req, res) => {
			res.send({random: _.random(0, 99999999)});
		});

		app.get('/cache/customTag/:tag', emc('1h', {tag: req => req.params.tag}), (req, res) => {
			res.send({tag: req.params.tag, random: _.random(0, 99999999)});
		});

		app.get('/cache/selective/:code', emc('1h', {tag: 'selective', cacheQuery: (req, res, content) => res.statusCode == 200}), (req, res) => {
			res.status(req.params.code).send({
				code: new Number(req.params.code),
				random: _.random(0, 99999999),
			});
		});

		app.get('/cache/invalidate/:tag', (req, res) => {
			emc.invalidate(req.params.tag, err => {
				res.send({error: err});
			});
		});

		server = app.listen(port, null, function(err) {
			if (err) return finish(err);
			mlog.log('Server listening on ' + url);
			finish();
		});
	});

	after(finish => server.close(finish));
	// }}}

	// Ping various endpoints with different cache expiry times {{{
	[
		// {label: '100ms', min: 100, invalidate: 120, max: 500, text: '100ms', url: `${url}/cache/100ms`}, // Precision <1s is a bit weird with things like MemcacheD so its skipped here
		{label: '1s', min: 1000, invalidate: 1200, max: 5000, text: '1 second', url: `${url}/cache/1s`},
		{label: '2 seconds', min: 2000, invalidate: 2200, max: 8000, text: '2 seconds', url: `${url}/cache/2s`},
		{label: '3000ms', min: 3000, invalidate: 3200, max: 10000, text: '3000ms', url: `${url}/cache/3000ms`},
	].forEach(time => {

		describe(`should cache something for ${time.text} (${time.label}, invalidated > ${time.invalidate/1000})`, function() {
			this.timeout(time.max);

			var responses = [];
			it(`should make the initial request < ${time.min} (uncached)`, ()=>
				axios.get(time.url)
					.then(res => responses.push(res))
			);

			it('should have a valid response the first time', ()=> {
				expect(responses[0].data).to.have.property('random');
				expect(responses[0].headers).to.have.property('etag');
			});

			it(`should make the second request (within cache range)`, ()=>
				axios.get(time.url)
					.then(res => responses.push(res))
			);

			it('should have a valid response the second time', ()=> {
				expect(responses[1].data).to.have.property('random');
				expect(responses[1].data.random).to.equal(responses[0].data.random);
				expect(responses[1].headers).to.have.property('etag');
				expect(responses[1].headers.etag).to.equal(responses[0].headers.etag);
			});

			it(`should wait the invalidation period (${time.invalidate}ms)`, done => {
				setTimeout(()=> done(), time.invalidate);
			});


			it('should make the third request (after cache range)', ()=>
				axios.get(time.url)
					.then(res => responses.push(res))
			);

			it('should have a valid response the third time', ()=> {
				expect(responses[2].data).to.have.property('random');
				expect(responses[2].data.random).to.not.equal(responses[0].data.random);
				expect(responses[2].headers).to.have.property('etag');
				// FIXME: Should etag be identical or different after invalidation - MC 2017-11-22
				// expect(responses[2].headers.etag).to.not.equal(responses[1].headers.etag);
			});

		});

	});
	// }}}

	it('should support dynamic tags', ()=> {
		// Initial hit
		var responses = [];
		return Promise.resolve()
			.then(()=> axios.get(`${url}/cache/customTag/foo`))
			.then(({data}) => responses.push(data))
			.then(()=> axios.get(`${url}/cache/invalidate/foo`)) // Request clear
			.then(({data}) => responses.push(data))
			.then(()=> axios.get(`${url}/cache/customTag/foo`))
			.then(({data}) => responses.push(data))
			.then(()=> {
				expect(responses).to.have.length(3);
				expect(responses).to.have.nested.property('0.tag', 'foo');
				expect(responses).to.have.nested.property('0.random');
				expect(responses).to.have.nested.property('2.tag', 'foo');
				expect(responses).to.have.nested.property('2.random');

				expect(responses[2].random).to.not.equal(responses[1].random);
			});
	});

	it('should cache only when the response is 200 (custom behaviour)', ()=> {
		// Initial hit
		var responses = [];
		return Promise.resolve()
			.then(()=> axios.get(`${url}/cache/selective/200`))
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('code', 200);
				expect(res.data).to.have.property('random');
				responses.push(res.data);
			})
			.then(()=> axios.get(`${url}/cache/selective/200`))
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('code', 200);
				expect(res.data).to.have.property('random', responses[0].random);
				responses.push(res.data);
			})
			.then(()=> axios.get(`${url}/cache/invalidate/selective`))
			.then(()=> axios.get(`${url}/cache/selective/202`))
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('code', 202);
				expect(res.data).to.have.property('random');
				responses.push(res.data);
			})
			.then(()=> axios.get(`${url}/cache/selective/202`))
			.then(res => {
				expect(res.data).to.be.an('object');
				expect(res.data).to.have.property('code', 202);
				expect(res.data).to.have.property('random');
				expect(res.data.random).to.not.equal(responses[2].random);
				responses.push(res.data);
			})
			.catch(e => expect.fail(e))
	});

});
