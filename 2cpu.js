var http = require('http');
var zlib = require('zlib');
var iconv = require('iconv-lite');
var cheerio = require('cheerio');
var Firebase = require('firebase');
var userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2717.0 Safari/537.36';

var cookies = {};

var db = {};

var headers = {
	'Accept' : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
	'Accept-Encoding' : 'gzip, deflate, sdch',
	'Accept-Language' : 'ko-KR,ko;q=0.8,en-US;q=0.6,en;q=0.4',
	'Connection' : 'keep-alive',
	'Host' : '2cpu.co.kr',
	'Upgrade-Insecure-Requests' : '0',
	'User-Agent' : userAgent,
};

var options = {
	host : 'www.2cpu.co.kr',
	port : 80,
	path : '/sell',
	method : 'GET',
	headers : headers
};

function buildCookies(headers) {
	var str = '';
	for ( var key in cookies) {
		if (str.length > 0)
			str += '; '
		str += key + '=' + cookies[key];
	}
	if (str.length > 0) {
		headers.Cookie = str;
		headers.Referer = 'http://2cpu.co.kr/sell';
	} else {
		delete headers.Cookie;
		delete headers.Referer;
	}
	return headers;
}

function parseCookies(res) {
	var setCookies = res.headers['set-cookie'] || [];
	if (typeof setCookies === 'string')
		setCookies = [ setCookies ];
	for (var i = 0; i < setCookies.length; i++) {
		var setCookie = parseParams(setCookies[i]);
		for ( var key in setCookie) {
			if (key === 'path' || key === 'domain' || key === 'expires')
				continue;
			cookies[key] = setCookie[key];
			if (cookies[key] === 'deleted')
				delete cookies[key];
		}
	}
}

function buildHeaders(headers) {
	headers = buildCookies(headers);
	return headers;
}

function parseParams(params) {
	params = params || '';
	params = params.split(';');
	var result = {};
	for (var i = 0; i < params.length; i++) {
		var param = params[i].split('=');
		if (param.length > 1) {
			result[param[0].trim()] = param[1].trim();
		}
	}
	return result;
}

function requestWithEncoding(options, callback) {
	options.headers = buildHeaders(headers);
	var req = http.request(options);
	req.on('error', callback);
	req.on('response', function(res) {
		if (res.statusCode !== 200) {
			callback({
				code : res.statusCode,
				message : res.statusMessage
			});
			return;
		}
		var encoding = res.headers['content-encoding'] || '';
		var contentType = parseParams(res.headers['content-type']);
		var chunks = [];
		// res.setEncoding('utf8');
		res.on('data', function(chunk) {
			chunks.push(chunk);
		});
		res.on('end', function() {
			var buffer = Buffer.concat(chunks);
			headers['If-Modified-Since'] = new Date().toGMTString();
			parseCookies(res);
			var charset = (contentType.charset || 'utf-8').replace('-', '');
			var handler = function(err, decoded) {
				if (err)
					callback(err);
				else if (iconv.encodingExists(charset))
					callback(err, decoded && iconv.decode(decoded, charset));
				else
					callback({
						code : 500,
						message : charset + ' is not supported encoding'
					});
			};
			if (encoding == 'gzip') {
				zlib.gunzip(buffer, handler);
			} else if (encoding == 'deflate') {
				zlib.inflate(buffer, handler);
			} else {
				callback(null, handler);
			}
		});
	});
	req.end();
}

var firebase = new Firebase('https://akafactory.firebaseio.com/2cpu-co-kr/sell');

function syncFirebase(callback) {
	firebase.once('value', function(snapshot) {
		db = snapshot.val();
		callback();
	});
}

function syncWeb(callback) {
	requestWithEncoding(
			options,
			function(err, html) {
				if (err) {
					callback(err);
				} else {
					var $ = cheerio.load(html);
					var table = $('#list_sell > table > tr.visible-xs');

					table
							.each(function() {
								var tr = $(this);
								var tds = tr.find('td');
								var header = $(tds[0]);
								var isNotify = header.find('i.fa-microphone').length > 0;
								if (!isNotify) {
									var a = $(header.find('a')[0]);
									var content = a.text().trim();
									var href = a.attr('href');
									var number = Number(href.substr(href
											.lastIndexOf('/') + 1));
									var data = {
										number : number,
										link : 'http://www.2cpu.co.kr'
												+ href.substr(2),
										content : content
									};
									if (!db[data.number]
											|| db[data.number].content !== data.content) {
										db[data.number] = data;
										if (db[data.number])
											console.log('update: '
													+ data.number);
										else
											console.log('add new: '
													+ data.number);
										firebase.child(data.number).set(data);
									}
								}
							});
					callback(false);
				}
			});
}

var updateCount = 0;
var timeout = false;
var intervalTime = 60 * 1000;

function update() {
	// console.log('update ' + ++updateCount);
	syncWeb(function(err) {
		if (err) {
			console.log('Error: ');
			console.log(err);
			setTimeout(update, intervalTime * 5);
		} else {
			setTimeout(update, intervalTime);
		}
	});
}

syncFirebase(function() {
	update();
});