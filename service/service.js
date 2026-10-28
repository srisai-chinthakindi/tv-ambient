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
 *   GET http://127.0.0.1:8095/config?json= ->  auto-start settings from the app
 *   GET http://127.0.0.1:8095/session      ->  {auto, prevApp}: opened by the idle timer, and from which app
 *   GET http://127.0.0.1:8095/open?url=    ->  opens Spotify's login page in the TV browser
 *   GET http://127.0.0.1:8095/callback     ->  Spotify login redirect (PKCE code)
 *   GET http://<tv>:8096/                  ->  read-only auto-start status, for testing
 *
 * It also watches what is on screen and reopens Ambient (through TizenBrew)
 * when nothing, or only Spotify, has been showing for the chosen delay.
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

/* ---- Auto-start: reopen Ambient when nothing (or only Spotify) is on screen ---- */

var MODULE = { moduleName: 'srisai-chinthakindi/tv-ambient', moduleType: 'gh' };
var STANDALONE_PKG = 'AmbientTV1'; // package id in tizen/config.xml
var SPOTIFY_APP = '3201606009684';
var auto = { on: true, delay: 10, overSpotify: true, launcher: false, pausedUntil: 0 };
var watch = { running: [], visible: [], idleSince: 0, lastLaunch: 0, lastError: '' };
// The app that was on screen when Ambient opened by itself (e.g. Spotify), so any
// button press can send the viewer straight back to it. Empty means Samsung's home.
var session = { autoAt: 0, prevApp: '' };
var ownPkg = 'xvvl3S1bvH';
try { ownPkg = tizen.application.getAppInfo().packageId || ownPkg; } catch (e) { /* keep the default */ }

// The TV's own status service tells us whether an app is on screen.
function appState(id, done) {
  http.get({ host: '127.0.0.1', port: 8001, path: '/api/v2/applications/' + encodeURIComponent(id) }, function (res) {
    var body = '';
    res.setEncoding('utf8');
    res.on('data', function (c) { body += c; });
    res.on('end', function () {
      try { done(JSON.parse(body)); } catch (e) { done(null); }
    });
  }).on('error', function () { done(null); });
}

function openAmbient() {
  watch.lastLaunch = Date.now();
  watch.idleSince = 0;
  if (ownPkg === STANDALONE_PKG) {
    // Installed as its own app: resume it (instant if it is already running in the background).
    var me = STANDALONE_PKG + '.Ambient';
    try {
      tizen.application.launchAppControl(new tizen.ApplicationControl('http://samsung.com/appcontrol/operation/eden_resume'), me, null,
        function () { tizen.application.launch(me); });
    } catch (e) {
      watch.lastError = 'launch: ' + e.message;
    }
    return;
  }
  // Running inside TizenBrew: ask TizenBrew to open the Ambient module.
  var target = ownPkg + '.TizenBrewStandalone';
  try {
    var ctl = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', null, null, null,
      [new tizen.ApplicationControlData('module', [JSON.stringify(MODULE)])]);
    tizen.application.launchAppControl(ctl, target, null, function (e) {
      watch.lastError = 'appcontrol: ' + (e && e.message);
      tizen.application.launch(target);
    });
  } catch (e) {
    watch.lastError = 'launch: ' + e.message;
  }
}

function evaluate(ids, visible) {
  watch.running = ids;
  watch.visible = visible;
  var mine = false, others = [];
  for (var i = 0; i < visible.length; i++) {
    if (visible[i].indexOf(ownPkg) === 0) mine = true;
    else others.push(visible[i]);
  }
  var spotifyOnly = others.length === 1 && others[0].indexOf(SPOTIFY_APP) === 0;
  var idle = others.length === 0 || (auto.overSpotify && spotifyOnly);
  if (!auto.on || Date.now() < auto.pausedUntil || mine || !idle) { watch.idleSince = 0; return; }
  if (!watch.idleSince) watch.idleSince = Date.now();
  // Launcher mode: Samsung's home with nothing open is replaced by Ambient after ~2 s.
  var home = others.length === 0;
  var delay = auto.launcher && home ? 2 : auto.delay;
  var cooldown = auto.launcher ? 4000 : 15000;
  if (Date.now() - watch.idleSince >= delay * 1000 && Date.now() - watch.lastLaunch > cooldown) {
    session = { autoAt: Date.now(), prevApp: others[0] || '' };
    openAmbient();
  }
}

var checking = false;
function checkScreen() {
  if (checking || typeof tizen === 'undefined' || !tizen.application) return;
  checking = true;
  tizen.application.getAppsContext(function (ctxs) {
    var ids = [];
    for (var i = 0; i < ctxs.length; i++) if (ids.indexOf(ctxs[i].appId) < 0) ids.push(ctxs[i].appId);
    var pending = ids.length, visible = [];
    function finish() { evaluate(ids, visible); checking = false; }
    if (!pending) return finish();
    ids.forEach(function (id) {
      appState(id, function (st) {
        if (st && st.visible) visible.push(id);
        if (--pending === 0) finish();
      });
    });
  }, function (e) {
    watch.lastError = 'context: ' + (e && e.message);
    checking = false;
  });
}
// Every 2 s is plenty for a 5 s idle delay and keeps the load on the TV low; it does nothing while auto-start is off.
setInterval(function () { if (auto.on && Date.now() >= auto.pausedUntil) checkScreen(); }, 2000);

// The app asks this when it comes on screen: was it opened by the idle timer, and from where?
function sendSession(res) {
  var s = { auto: Date.now() - session.autoAt < 10000, prevApp: session.prevApp };
  session.autoAt = 0;
  send(res, 200, JSON.stringify(s));
}

function setConfig(res, json) {
  try {
    var c = JSON.parse(json || '{}');
    if (typeof c.on === 'boolean') auto.on = c.on;
    if (c.delay > 0 && c.delay <= 3600) auto.delay = c.delay;
    if (typeof c.overSpotify === 'boolean') auto.overSpotify = c.overSpotify;
    if (typeof c.launcher === 'boolean') auto.launcher = c.launcher;
    if (c.pause > 0) auto.pausedUntil = Date.now() + c.pause * 60000;
    send(res, 200, JSON.stringify(auto));
  } catch (e) {
    send(res, 400, '{"error":"bad config"}');
  }
}

/* ---- Spotify login: open the login page, catch the redirect ---- */

var spotifyResults = {};

function openBrowser(res, target) {
  if (String(target).indexOf('https://accounts.spotify.com/') !== 0) return send(res, 400, '{"error":"not allowed"}');
  try {
    tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', target), null,
      function () { send(res, 200, '{"ok":true}'); },
      function (e) { send(res, 500, JSON.stringify({ error: String(e && e.message) })); });
  } catch (e) {
    send(res, 500, JSON.stringify({ error: e.message }));
  }
}

function spotifyCallback(res, q) {
  if (q.state) spotifyResults[q.state] = q.code ? { code: String(q.code) } : { error: String(q.error || 'cancelled') };
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<html><body style="background:#111;color:#fff;font:28px sans-serif;text-align:center;padding-top:20vh">' +
    (q.code ? 'Spotify connected. Press Back or open Ambient again.' : 'Spotify login was cancelled.') + '</body></html>');
}

function spotifyResult(res, state) {
  var r = spotifyResults[state];
  if (r) delete spotifyResults[state];
  send(res, 200, JSON.stringify(r || {}));
}

/* ---- Read-only status on the home network, for testing from a computer ---- */

var statusServer = http.createServer(function (req, res) {
  send(res, 200, JSON.stringify({ auto: auto, watch: watch, ownPkg: ownPkg, now: Date.now() }));
});
statusServer.on('error', function (e) {
  if (e.code !== 'EADDRINUSE') throw e;
});
statusServer.listen(8096, '0.0.0.0');

var server = http.createServer(function (req, res) {
  var parsed = url.parse(req.url, true);
  if (parsed.pathname === '/apps') return listApps(res);
  if (parsed.pathname === '/icon') return sendIcon(res, String(parsed.query.id || ''));
  if (parsed.pathname === '/launch') return launchApp(res, String(parsed.query.id || ''));
  if (parsed.pathname === '/config') return setConfig(res, parsed.query.json);
  if (parsed.pathname === '/session') return sendSession(res);
  if (parsed.pathname === '/open') return openBrowser(res, String(parsed.query.url || ''));
  if (parsed.pathname === '/callback') return spotifyCallback(res, parsed.query);
  if (parsed.pathname === '/spotify/result') return spotifyResult(res, String(parsed.query.state || ''));
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

// Entry points when installed as a standalone Tizen web service; the servers above are
// already running, so there is nothing more to do. (TizenBrew ignores these.)
module.exports = {
  onStart: function () {},
  onRequest: function () {},
  onExit: function () {}
};
