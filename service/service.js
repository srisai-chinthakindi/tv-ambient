/*
 * TizenBrew service for the Ambient app.
 *
 * TizenBrew runs this file in Node.js on the TV (old Node 4, so plain ES5).
 * It serves a tiny local endpoint the app can call for feeds that a web page
 * cannot fetch directly because they send no CORS headers.
 *
 *   GET http://127.0.0.1:8095/songs?cc=in  ->  Apple Music top songs chart (JSON)
 *   GET http://127.0.0.1:8095/apps         ->  installed apps [{id, name, icon}]
 *   GET http://127.0.0.1:8095/icon?id=...  ->  an app's icon image
 *   GET http://127.0.0.1:8095/launch?id=.. ->  opens that app
 */
var http = require('http');
var https = require('https');
var url = require('url');
var fs = require('fs');

var PORT = 8095;
var CACHE_MS = 60 * 60 * 1000;
var cache = {};

function fetchText(target, redirects, done) {
  https.get(target, function (res) {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
      res.resume();
      return fetchText(url.resolve(target, res.headers.location), redirects - 1, done);
    }
    if (res.statusCode !== 200) {
      res.resume();
      return done(new Error('HTTP ' + res.statusCode));
    }
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (chunk) { body += chunk; });
    res.on('end', function () { done(null, body); });
  }).on('error', done);
}

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

/* ---- App launcher: list installed apps, serve their icons, launch one ---- */

var appsById = {};

function listApps(res) {
  if (typeof tizen === 'undefined' || !tizen.application) return send(res, 501, '{"error":"tizen api unavailable"}');
  tizen.application.getAppsInfo(function (infos) {
    var apps = [];
    appsById = {};
    for (var i = 0; i < infos.length; i++) {
      var a = infos[i];
      if (!a.show || !a.name) continue;
      appsById[a.id] = a;
      apps.push({ id: a.id, name: a.name, icon: a.iconPath ? '/icon?id=' + encodeURIComponent(a.id) : '' });
    }
    apps.sort(function (x, y) { return x.name.toLowerCase() < y.name.toLowerCase() ? -1 : 1; });
    send(res, 200, JSON.stringify(apps));
  }, function (e) {
    send(res, 500, JSON.stringify({ error: String(e && e.message) }));
  });
}

function sendIcon(res, id) {
  var a = appsById[id];
  if (!a || !a.iconPath) return send(res, 404, '{"error":"no icon"}');
  var file = String(a.iconPath).replace(/^file:\/\//, '');
  fs.readFile(file, function (err, data) {
    if (err) return send(res, 404, '{"error":"no icon"}');
    res.writeHead(200, {
      'Content-Type': /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'max-age=86400'
    });
    res.end(data);
  });
}

function launchApp(res, id) {
  if (typeof tizen === 'undefined' || !tizen.application) return send(res, 501, '{"error":"tizen api unavailable"}');
  tizen.application.launch(id, function () {
    send(res, 200, '{"ok":true}');
  }, function (e) {
    send(res, 500, JSON.stringify({ error: String(e && e.message) }));
  });
}

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  if (parsed.pathname === '/apps') return listApps(res);
  if (parsed.pathname === '/icon') return sendIcon(res, String(parsed.query.id || ''));
  if (parsed.pathname === '/launch') return launchApp(res, String(parsed.query.id || ''));
  if (parsed.pathname !== '/songs') return send(res, 404, '{"error":"not found"}');

  var cc = String(parsed.query.cc || 'in').toLowerCase();
  if (!/^[a-z]{2}$/.test(cc)) return send(res, 400, '{"error":"bad country"}');

  var hit = cache[cc];
  if (hit && Date.now() - hit.at < CACHE_MS) return send(res, 200, hit.body);

  fetchText('https://rss.marketingtools.apple.com/api/v2/' + cc + '/music/most-played/20/songs.json', 3, function (err, body) {
    if (err) return hit ? send(res, 200, hit.body) : send(res, 502, '{"error":"feed unavailable"}');
    cache[cc] = { at: Date.now(), body: body };
    send(res, 200, body);
  });
});

// TizenBrew may start the service again on each launch; if the port is
// already served by an earlier copy, that copy keeps working.
server.on('error', function (e) {
  if (e.code !== 'EADDRINUSE') throw e;
});
server.listen(PORT, '127.0.0.1');
