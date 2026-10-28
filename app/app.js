/*
 * Ambient for Samsung Tizen TVs (runs as a TizenBrew app module).
 *
 * Sources: animated anime-style scenes (scenes.js), public-domain paintings
 * (curated from The Met, art-list.js), nature photos (Wikimedia Commons),
 * the user's own wallpapers (video or image links), trending songs (Apple
 * Music charts, fetched by the TizenBrew service in service/service.js) and
 * what's popular on Netflix (TMDB, needs the user's own free API key).
 * Overlay: clock, date, weather (Open-Meteo). Everything is configurable from
 * the remote (OK button). The app never plays sound, so music apps keep the audio.
 */
(function () {
  'use strict';

  /* ------------------------------ Settings ------------------------------ */

  const DEFAULTS = {
    mode: 'mix',
    mixAnime: true, mixArt: true, mixNature: true, mixDaily: true, mixWalls: false, mixSongs: true, mixNetflix: false,
    scene: 'auto',
    artStyle: 'japanese', artMat: 'light', caption: true,
    natureTopic: 'landscapes',
    interval: 0.05,
    clock: true, clock24: false, seconds: false, clockSize: 'm', clockPos: 'br', date: true,
    weather: true, city: 'Hyderabad', units: 'c',
    brightness: 100, nightDim: '23-7',
    quality: 'standard',
    videos: '', wallList: 'my-wallpapers.txt',
    songsCountry: 'in', tmdbKey: '',
    pins: null, pinned: null, look: 'cinematic',
    autoOn: true, autoDelay: 10, autoOverSpotify: true,
    sleepAfter: 0, tone: 'neutral', motion: 'full',
    spotifyClientId: '', spotifyRefresh: '', miniPlayer: true,
    clockFont: 'modern', clockWeight: 'thin', clockColor: 'white', clockStyle: 'inline'
  };
  const STORE_KEY = 'ambient.settings.v1';

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return Object.assign({}, DEFAULTS, saved);
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
  }
  let S = loadSettings();
  // Preview overrides, e.g. index.html?mode=anime&scene=neon (not saved).
  new URLSearchParams(location.search).forEach((v, k) => { if (k in DEFAULTS) S[k] = v; });

  const MENU_COUNTRIES = [['in', 'India'], ['us', 'United States'], ['gb', 'United Kingdom'], ['jp', 'Japan'], ['kr', 'South Korea'], ['ae', 'UAE'], ['au', 'Australia'], ['ca', 'Canada']];
  const NATURE_CATEGORIES = {
    landscapes: 'Featured pictures of landscapes',
    mountains: 'Featured pictures of mountains',
    waterfalls: 'Featured pictures of waterfalls',
    japan: 'Featured pictures of Japan',
    beaches: 'Featured pictures of beaches',
    forests: 'Featured pictures of forests'
  };

  /* ------------------------------ Elements ------------------------------ */

  const $ = (id) => document.getElementById(id);
  const sceneCanvas = $('scene');
  const ctx = sceneCanvas.getContext('2d');
  const photo = $('photo');
  const slides = [$('slideA'), $('slideB')];
  const video = $('video');
  const card = $('card');
  const caption = $('caption');
  const hud = $('hud');
  const dim = $('dim');
  const toastEl = $('toast');
  const menu = $('menu');
  const menuList = $('menuList');
  const textInput = $('textInput');

  let toastTimer = 0;
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 2500);
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function preload(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => reject(new Error('image failed'));
      img.src = url;
    });
  }

  /* --------------------------- Anime scenes ----------------------------- */

  const SCENES = window.AmbientScenes || [];
  let sceneState = null, scene = null, sceneStart = 0, rafId = 0, lastFrame = 0;

  function sizeCanvas() {
    sceneCanvas.width = Math.min(window.innerWidth, 1920);
    sceneCanvas.height = Math.round(sceneCanvas.width * window.innerHeight / window.innerWidth);
  }

  function startScene(id) {
    sizeCanvas();
    scene = SCENES.find((s) => s.id === id) || SCENES[0];
    sceneState = scene.init(sceneCanvas.width, sceneCanvas.height);
    sceneStart = performance.now();
    lastFrame = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function stopScene() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    // ~30 fps is plenty for ambient motion and is kind to the TV's CPU.
    if (lastFrame && now - lastFrame < 32) return;
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0.033;
    lastFrame = now;
    const w = sceneCanvas.width, h = sceneCanvas.height;
    const t = (now - sceneStart) / 1000;
    // Very slow push-in on the backdrop for a living-painting feel.
    const z = 1.02 + Math.sin(t / 40) * 0.02;
    ctx.drawImage(sceneState.bg, -(z - 1) * w / 2, -(z - 1) * h / 2, w * z, h * z);
    scene.draw(ctx, sceneState, w, h, t, dt);
    // Motion: Still — draw one frame and stop.
    if (S.motion === 'still') { cancelAnimationFrame(rafId); rafId = 0; }
  }

  let autoSceneIndex = Math.floor(Math.random() * SCENES.length);
  function nextSceneId() {
    if (S.scene !== 'auto') return S.scene;
    autoSceneIndex = (autoSceneIndex + 1) % SCENES.length;
    return SCENES[autoSceneIndex].id;
  }

  /* ----------------------- Paintings (The Met) -------------------------- */

  // Curated list baked in by build_art_list.py (art-list.js): the TV only
  // downloads images, so there are no API calls or rate limits at runtime.
  let artQueue = [], artQueueStyle = '';

  async function nextArt() {
    const all = window.AmbientArt || {};
    if (artQueueStyle !== S.artStyle || !artQueue.length) {
      artQueue = shuffle((all[S.artStyle] || all.japanese || []).slice());
      artQueueStyle = S.artStyle;
    }
    for (let tries = 0; tries < 6 && artQueue.length; tries++) {
      const a = artQueue.pop();
      const url = S.quality === 'high' ? a.large : a.small;
      try {
        await preload(url);
        return { kind: 'art', url, title: a.title, by: a.by, credit: 'The Metropolitan Museum of Art' };
      } catch (e) { /* try another artwork */ }
    }
    throw new Error('no artwork available');
  }

  /* -------------------- Nature (Wikimedia Commons) ---------------------- */

  let natureTitles = [], natureTopicLoaded = '';
  const COMMONS = 'https://commons.wikimedia.org/w/api.php?format=json&origin=*&action=query';

  function stripTags(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').trim();
  }

  async function nextNature() {
    if (natureTopicLoaded !== S.natureTopic || !natureTitles.length) {
      const cat = NATURE_CATEGORIES[S.natureTopic] || NATURE_CATEGORIES.landscapes;
      const data = await getJSON(COMMONS + '&list=categorymembers&cmtype=file&cmlimit=500&cmtitle=' + encodeURIComponent('Category:' + cat));
      natureTitles = shuffle((data.query.categorymembers || []).map((m) => m.title));
      natureTopicLoaded = S.natureTopic;
    }
    const width = S.quality === 'high' ? 3840 : 2560;
    for (let tries = 0; tries < 10 && natureTitles.length; tries++) {
      const title = natureTitles.pop();
      try {
        const data = await getJSON(COMMONS + '&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=Artist|LicenseShortName&iiurlwidth=' + width + '&titles=' + encodeURIComponent(title));
        const pg = Object.values(data.query.pages)[0];
        const info = pg && pg.imageinfo && pg.imageinfo[0];
        // Landscape-oriented photos only; portraits look poor on a TV.
        if (!info || info.width < info.height * 1.25) continue;
        const url = info.thumburl || info.url;
        await preload(url);
        const meta = info.extmetadata || {};
        const name = title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ');
        const artist = stripTags(meta.Artist && meta.Artist.value);
        const lic = meta.LicenseShortName && meta.LicenseShortName.value;
        return { kind: 'nature', url, title: name, by: [artist, lic].filter(Boolean).join(' · '), credit: 'Wikimedia Commons' };
      } catch (e) { /* try another photo */ }
    }
    throw new Error('no photo available');
  }

  /* -------------------------- Your wallpapers --------------------------- */

  // Links come from the settings menu and/or a plain text file (one link per
  // line) that lives next to the app in the user's GitHub repo, so the list
  // can be edited from a phone instead of typed with the remote.
  let wallIndex = -1, wallFile = [], wallFileAt = 0, wallFileSrc = '';
  const isImageLink = (u) => /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(u);
  const linksIn = (text) => (text || '').split(/[\s,]+/).filter((u) => /^https?:\/\//.test(u));

  async function wallpaperLinks() {
    if (S.wallList && (wallFileSrc !== S.wallList || Date.now() - wallFileAt > 10 * 60 * 1000)) {
      try {
        const res = await fetch(S.wallList, { cache: 'no-store' });
        if (res.ok) wallFile = linksIn((await res.text()).replace(/^#.*$/gm, ''));
      } catch (e) { /* keep the last list */ }
      wallFileAt = Date.now(); wallFileSrc = S.wallList;
    }
    return linksIn(S.videos).concat(wallFile);
  }

  /* ------------------------ Trending songs card -------------------------- */

  const SERVICE = 'http://127.0.0.1:8095';
  let songs = null, songsAt = 0, songsCc = '';

  async function loadSongs() {
    if (songs && songsCc === S.songsCountry && Date.now() - songsAt < 60 * 60 * 1000) return songs;
    let data;
    try {
      // The TizenBrew service fetches the chart for us (the feed has no CORS headers).
      data = await getJSON(SERVICE + '/songs?cc=' + encodeURIComponent(S.songsCountry));
    } catch (e) {
      data = await getJSON('https://rss.marketingtools.apple.com/api/v2/' + S.songsCountry + '/music/most-played/20/songs.json');
    }
    songs = (data.feed && data.feed.results) || [];
    songsAt = Date.now(); songsCc = S.songsCountry;
    return songs;
  }

  async function songsCard() {
    const list = (await loadSongs()).slice(0, 8);
    if (!list.length) throw new Error('no songs');
    const big = (u) => (u || '').replace(/\/\d+x\d+bb\./, '/600x600bb.');
    await preload(big(list[0].artworkUrl100)).catch(() => {});
    const country = (MENU_COUNTRIES.find((c) => c[0] === S.songsCountry) || ['', S.songsCountry.toUpperCase()])[1];
    return {
      kind: 'card', bg: big(list[0].artworkUrl100),
      html: '<div class="card-kicker">Trending songs · ' + esc(country) + '</div>' +
        '<div class="songs"><img class="cover" src="' + esc(big(list[0].artworkUrl100)) + '" alt="">' +
        '<ol>' + list.map((t, i) => '<li><span class="rank">' + (i + 1) + '</span><img src="' + esc(t.artworkUrl100) + '" alt="">' +
          '<div><b>' + esc(t.name) + '</b><span>' + esc(t.artistName) + '</span></div></li>').join('') + '</ol></div>' +
        '<div class="card-foot">Apple Music charts · find them on Spotify</div>'
    };
  }

  /* ----------------------- Popular on Netflix card ----------------------- */

  let shows = null, showsAt = 0, showIndex = -1;

  async function loadShows() {
    if (shows && Date.now() - showsAt < 3 * 60 * 60 * 1000) return shows;
    if (!S.tmdbKey) throw new Error('Add your free TMDB key in settings to see Netflix picks');
    const region = S.songsCountry.toUpperCase();
    const q = '?with_watch_providers=8&watch_region=' + region + '&sort_by=popularity.desc&api_key=' + encodeURIComponent(S.tmdbKey);
    const [tv, movies] = await Promise.all([
      getJSON('https://api.themoviedb.org/3/discover/tv' + q),
      getJSON('https://api.themoviedb.org/3/discover/movie' + q)
    ]);
    const merged = [];
    for (let i = 0; i < 10; i++) {
      if (tv.results[i]) merged.push(tv.results[i]);
      if (movies.results[i]) merged.push(movies.results[i]);
    }
    shows = merged.filter((m) => m.backdrop_path && m.poster_path);
    showsAt = Date.now();
    return shows;
  }

  async function netflixCard() {
    const list = await loadShows();
    if (!list.length) throw new Error('no titles');
    showIndex = (showIndex + 1) % list.length;
    const top = list[showIndex];
    const bg = 'https://image.tmdb.org/t/p/w1280' + top.backdrop_path;
    await preload(bg);
    const rest = list.filter((m) => m !== top).slice(0, 6);
    const year = (top.first_air_date || top.release_date || '').slice(0, 4);
    const meta = [year, top.first_air_date ? 'Series' : 'Film', top.vote_average ? '★ ' + top.vote_average.toFixed(1) : ''].filter(Boolean).join('  ·  ');
    return {
      kind: 'card', bg, sharp: true,
      html: '<div class="card-kicker">Popular on Netflix · ' + esc(S.songsCountry.toUpperCase()) + '</div>' +
        '<div class="show-title">' + esc(top.name || top.title) + '</div>' +
        '<div class="show-meta">' + esc(meta) + '</div>' +
        '<div class="show-text">' + esc(top.overview || '') + '</div>' +
        '<div class="posters">' + rest.map((m) => '<img src="https://image.tmdb.org/t/p/w342' + esc(m.poster_path) + '" alt="">').join('') + '</div>' +
        '<div class="card-foot">Data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</div>'
    };
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ESC[c]);
  }

  /* --------------------- Daily pictures (Commons POTD) -------------------- */

  // Wikimedia Commons "Picture of the day": a new featured photo every day.
  // Today's comes first, then earlier days, going back two months.
  const dailyCache = {};
  let dailyOffset = -1;

  async function dailyItem(day) {
    if (day in dailyCache) return dailyCache[day];
    const width = S.quality === 'high' ? 3840 : 2560;
    const data = await getJSON(COMMONS + '&generator=images&prop=imageinfo&iiprop=url|size|extmetadata&iiextmetadatafilter=Artist|LicenseShortName&iiurlwidth=' + width + '&titles=' + encodeURIComponent('Template:Potd/' + day));
    const pages = data.query ? Object.values(data.query.pages) : [];
    const pg = pages.find((p) => p.imageinfo && p.imageinfo[0].width >= p.imageinfo[0].height * 1.2);
    let item = null;
    if (pg) {
      const info = pg.imageinfo[0], meta = info.extmetadata || {};
      item = {
        kind: 'nature', url: info.thumburl || info.url,
        title: pg.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/[_]+/g, ' '),
        by: [stripTags(meta.Artist && meta.Artist.value), meta.LicenseShortName && meta.LicenseShortName.value].filter(Boolean).join(' · '),
        credit: 'Picture of the day, ' + day
      };
    }
    dailyCache[day] = item;
    return item;
  }

  async function nextDaily() {
    for (let tries = 0; tries < 8; tries++) {
      dailyOffset = (dailyOffset + 1) % 60;
      const day = new Date(Date.now() - dailyOffset * 86400000).toISOString().slice(0, 10);
      try {
        const item = await dailyItem(day);
        if (item) { await preload(item.url); return item; }
      } catch (e) { /* try the day before */ }
    }
    throw new Error('no daily picture');
  }

  /* ------------------------ Wallpaper picker ----------------------------- */

  // OK → "Choose a wallpaper": a grid of everything available; the chosen one
  // stays on screen (Show = "My chosen wallpaper") until another is picked.
  const picker = $('picker'), pickerList = $('pickerList');
  const PICK_COLS = 4;
  let pickItems = [], pickSel = 0, picking = false;

  function sceneThumb(sc) {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 270;
    const st = sc.init(480, 270);
    const g = c.getContext('2d');
    g.drawImage(st.bg, 0, 0);
    return c.toDataURL('image/jpeg', 0.8);
  }

  async function openPicker() {
    closeMenu();
    picking = true; pickSel = 0;
    picker.classList.add('show');
    pickerList.innerHTML = '<div class="pick-loading">Loading wallpapers…</div>';
    const items = SCENES.map((sc) => ({ item: { kind: 'scene', id: sc.id, name: sc.name }, thumb: sceneThumb(sc), label: sc.name, tag: 'Live' }));
    for (let i = 0; i < 8; i++) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      try {
        const it = await dailyItem(day);
        if (it) items.push({ item: it, thumb: it.url.replace(/\/\d+px-/, '/500px-'), label: i === 0 ? 'Today' : day, tag: 'Daily' });
      } catch (e) { /* skip that day */ }
      if (!picking) return;
    }
    const art = ((window.AmbientArt || {})[S.artStyle] || []).slice(0, 8);
    art.forEach((a) => items.push({ item: { kind: 'art', url: S.quality === 'high' ? a.large : a.small, title: a.title, by: a.by, credit: 'The Metropolitan Museum of Art' }, thumb: a.small, label: a.title, tag: 'Art' }));
    (await wallpaperLinks()).forEach((u, i) => items.push({
      item: isImageLink(u) ? { kind: 'wallimg', url: u } : { kind: 'video', url: u },
      thumb: isImageLink(u) ? u : '', label: 'My wallpaper ' + (i + 1), tag: isImageLink(u) ? 'Mine' : 'My video'
    }));
    pickItems = items;
    renderPicker();
  }

  function renderPicker() {
    pickerList.innerHTML = pickItems.map((p, i) =>
      '<div class="pick' + (i === pickSel ? ' sel' : '') + '">' +
        (p.thumb ? '<img src="' + esc(p.thumb) + '" alt="">' : '<div class="pick-video">▶</div>') +
        '<span class="pick-tag">' + esc(p.tag) + '</span><div class="pick-label">' + esc(p.label) + '</div></div>').join('');
    const sel = pickerList.children[pickSel];
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function closePicker() {
    picking = false;
    picker.classList.remove('show');
  }

  function pickerKey(k) {
    if (k === K.BACK || k === K.ESC || k === K.BACKSPACE) { closePicker(); return; }
    if (!pickItems.length) return;
    if (k === K.LEFT) pickSel = Math.max(0, pickSel - 1);
    else if (k === K.RIGHT) pickSel = Math.min(pickItems.length - 1, pickSel + 1);
    else if (k === K.UP) pickSel = Math.max(0, pickSel - PICK_COLS);
    else if (k === K.DOWN) pickSel = Math.min(pickItems.length - 1, pickSel + PICK_COLS);
    else if (k === K.ENTER) {
      S.pinned = pickItems[pickSel].item;
      S.mode = 'pinned';
      saveSettings();
      closePicker();
      restartShow();
      toast('Wallpaper set · OK → Show to shuffle again', 4000);
      return;
    }
    renderPicker();
  }

  /* -------------------- Auto-start (helper on the TV) -------------------- */

  // The TizenBrew service watches what is on screen and reopens Ambient when
  // nothing (or only Spotify) has been showing for S.autoDelay seconds.
  function sendAutoConfig() {
    const cfg = { on: !!S.autoOn, delay: Number(S.autoDelay) || 5, overSpotify: !!S.autoOverSpotify };
    fetch(SERVICE + '/config?json=' + encodeURIComponent(JSON.stringify(cfg))).catch(() => {});
  }

  /* ------------------------- Spotify mini player ------------------------- */

  // Spotify login uses PKCE (no secret): the helper opens Spotify's login page
  // in the TV browser and catches the redirect on http://127.0.0.1:8095/callback.
  const SPOTIFY_REDIRECT = SERVICE + '/callback';
  const player = $('player');
  let spAccess = '', spAccessUntil = 0, spState = null, playerFocus = false;

  function b64url(bytes) {
    let s = '';
    bytes.forEach((b) => { s += String.fromCharCode(b); });
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async function connectSpotify() {
    if (!S.spotifyClientId) { toast('Add your Spotify Client ID first (see the guide on GitHub)', 5000); return; }
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const auth = 'https://accounts.spotify.com/authorize?response_type=code&code_challenge_method=S256' +
      '&client_id=' + encodeURIComponent(S.spotifyClientId) +
      '&scope=' + encodeURIComponent('user-read-playback-state user-modify-playback-state user-read-currently-playing') +
      '&redirect_uri=' + encodeURIComponent(SPOTIFY_REDIRECT) +
      '&code_challenge=' + challenge + '&state=' + state;
    try {
      await getJSON(SERVICE + '/open?url=' + encodeURIComponent(auth));
    } catch (e) {
      toast('Could not open the browser. Open Ambient from TizenBrew and try again.', 5000);
      return;
    }
    toast('Log in to Spotify in the browser, then come back here', 6000);
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      let res;
      try { res = await getJSON(SERVICE + '/spotify/result?state=' + state); } catch (e) { continue; }
      if (res.error) { toast('Spotify login was cancelled', 4000); return; }
      if (!res.code) continue;
      const tok = await spotifyToken({ grant_type: 'authorization_code', code: res.code, redirect_uri: SPOTIFY_REDIRECT, code_verifier: verifier });
      if (tok) { toast('Spotify connected', 3000); renderMenu(); pollPlayer(); }
      return;
    }
    toast('Spotify login timed out', 4000);
  }

  async function spotifyToken(params) {
    params.client_id = S.spotifyClientId;
    const body = Object.keys(params).map((k) => k + '=' + encodeURIComponent(params[k])).join('&');
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    if (!res.ok) { if (res.status === 400) { S.spotifyRefresh = ''; saveSettings(); } return null; }
    const t = await res.json();
    spAccess = t.access_token;
    spAccessUntil = Date.now() + (t.expires_in - 60) * 1000;
    if (t.refresh_token) { S.spotifyRefresh = t.refresh_token; saveSettings(); }
    return t;
  }

  async function spotifyApi(method, path) {
    if (!S.spotifyRefresh || !S.spotifyClientId) return null;
    if (!spAccess || Date.now() > spAccessUntil) {
      if (!await spotifyToken({ grant_type: 'refresh_token', refresh_token: S.spotifyRefresh })) return null;
    }
    const res = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: 'Bearer ' + spAccess } });
    if (res.status === 204 || method !== 'GET') return res.ok || res.status === 204 ? {} : null;
    return res.ok ? res.json() : null;
  }

  async function pollPlayer() {
    if (!S.miniPlayer || !S.spotifyRefresh) { spState = null; renderPlayer(); return; }
    try { spState = await spotifyApi('GET', '/me/player'); } catch (e) { spState = null; }
    renderPlayer();
  }

  function renderPlayer() {
    const item = spState && spState.item;
    player.classList.toggle('hidden', !item);
    if (!item) { playerFocus = false; return; }
    const art = (item.album && item.album.images && item.album.images[item.album.images.length > 1 ? 1 : 0]) || {};
    const pct = item.duration_ms ? Math.min(100, (spState.progress_ms || 0) / item.duration_ms * 100) : 0;
    player.classList.toggle('focus', playerFocus);
    player.innerHTML =
      (art.url ? '<img src="' + esc(art.url) + '" alt="">' : '') +
      '<div class="pl-body"><b>' + esc(item.name) + '</b><span>' + esc((item.artists || []).map((a) => a.name).join(', ')) + '</span>' +
      '<div class="pl-bar"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="pl-ctl"><em>⏮</em><em class="pp">' + (spState.is_playing ? '❚❚' : '▶') + '</em><em>⏭</em></div></div>';
  }

  async function playerCommand(cmd) {
    const playing = spState && spState.is_playing;
    const ok = cmd === 'prev' ? await spotifyApi('POST', '/me/player/previous')
      : cmd === 'next' ? await spotifyApi('POST', '/me/player/next')
      : await spotifyApi('PUT', playing ? '/me/player/pause' : '/me/player/play');
    if (!ok) toast('Spotify did not accept that (playback control needs Spotify Premium)', 4000);
    setTimeout(pollPlayer, 600);
  }

  function playerKey(k) {
    if (k === K.LEFT) playerCommand('prev');
    else if (k === K.RIGHT) playerCommand('next');
    else if (k === K.ENTER || k === K.PLAYPAUSE) playerCommand('toggle');
    else if (k === K.DOWN || k === K.BACK || k === K.ESC || k === K.BACKSPACE) { playerFocus = false; renderPlayer(); }
  }

  /* ----------------------- Clock style (Mac-like) ------------------------ */

  const CLOCK_FONTS = {
    modern: '"Outfit", sans-serif',
    classic: '"Fraunces", Georgia, serif',
    rounded: '"Nunito", sans-serif',
    mono: '"JetBrains Mono", monospace',
    condensed: '"Bebas Neue", "Outfit", sans-serif'
  };
  const CLOCK_COLORS = { white: '#ffffff', warm: '#ffe2b8', rose: '#ffc4d6', mint: '#b9f5dc', sky: '#bcdcff', gold: '#ffd36b' };
  const CLOCK_WEIGHTS = { thin: 200, regular: 400, bold: 700 };

  function applyClockStyle() {
    const clock = $('clock');
    clock.style.fontFamily = CLOCK_FONTS[S.clockFont] || CLOCK_FONTS.modern;
    clock.style.fontWeight = CLOCK_WEIGHTS[S.clockWeight] || 200;
    // On the white gallery mat a white clock would vanish; keep the dark ink there.
    hud.style.color = document.body.classList.contains('light') && S.clockColor === 'white' ? '' : (CLOCK_COLORS[S.clockColor] || '#fff');
    clock.classList.toggle('stacked', S.clockStyle === 'stacked');
  }

  /* ---------------------------- Display --------------------------------- */

  let activeSlide = 0;
  let current = null;
  const history = [];

  function showLayer(which) {
    if (which === 'scene') { sceneCanvas.style.display = 'block'; } else { sceneCanvas.style.display = 'none'; stopScene(); }
    photo.classList.toggle('on', which === 'photo');
    video.classList.toggle('on', which === 'video');
    card.classList.toggle('on', which === 'card');
    if (which !== 'video') { video.pause(); video.removeAttribute('src'); video.load(); }
  }

  function render(item) {
    current = item;
    caption.classList.remove('show', 'on-light');
    const cin = S.look === 'cinematic';
    document.body.classList.toggle('light', !cin && item.kind === 'art' && S.artMat === 'light');
    applyClockStyle();
    document.body.classList.toggle('photo', cin || ['nature', 'video', 'wallimg', 'card'].indexOf(item.kind) >= 0 || (item.kind === 'art' && S.artMat === 'none'));
    if (item.kind === 'scene') {
      showLayer('scene');
      startScene(item.id);
      setCaption(item.name, cin ? '' : 'Ambient scene', '');
    } else if (item.kind === 'art' || item.kind === 'nature' || item.kind === 'wallimg') {
      showLayer('photo');
      const next = slides[1 - activeSlide];
      // Cinematic look: everything full-bleed; Gallery look: paintings on a mat.
      next.className = 'slide ' + (item.kind === 'art' && !cin ? 'art mat-' + S.artMat : 'cover');
      const img = next.querySelector('img');
      img.style.width = img.style.height = '';
      if (item.kind === 'art' && !cin) {
        // Scale the artwork to fill the mat, whatever its source resolution.
        img.onload = () => {
          const pad = S.artMat === 'none' ? 0 : 1;
          const aw = window.innerWidth * (pad ? 0.82 : 1), ah = window.innerHeight * (pad ? 0.86 : 1);
          const k = Math.min(aw / img.naturalWidth, ah / img.naturalHeight);
          img.style.width = Math.round(img.naturalWidth * k) + 'px';
          img.style.height = Math.round(img.naturalHeight * k) + 'px';
        };
      } else {
        img.onload = null;
      }
      img.src = item.url;
      next.classList.add('show');
      slides[activeSlide].classList.remove('show');
      activeSlide = 1 - activeSlide;
      setCaption(item.title || '', item.by, item.credit);
      if (!cin && item.kind === 'art' && S.artMat === 'light') caption.classList.add('on-light');
    } else if (item.kind === 'card') {
      showLayer('card');
      card.innerHTML = '<div class="card-bg' + (item.sharp ? ' sharp' : '') + '"></div><div class="card-body">' + item.html + '</div>';
      card.firstChild.style.backgroundImage = 'url("' + item.bg + '")';
      setCaption('', '', '');
    } else if (item.kind === 'video') {
      showLayer('video');
      video.muted = true;
      video.src = item.url;
      video.play().catch(() => {});
      setCaption('', '', '');
    }
  }

  const ART_STYLE_NAMES = { japanese: 'Japanese prints', impressionism: 'Impressionism', landscapes: 'Landscapes', classics: 'Old masters' };

  function captionTags(item) {
    if (item.kind === 'scene') return ['Live wallpaper', 'Anime', 'Animated'];
    if (item.kind === 'art') return ['Painting', ART_STYLE_NAMES[S.artStyle] || 'Art', 'Public domain'];
    if (item.kind === 'nature' && /day/.test(item.credit || '')) return ['Picture of the day', 'Photography', 'Updated daily'];
    if (item.kind === 'nature') return ['Nature', S.natureTopic.charAt(0).toUpperCase() + S.natureTopic.slice(1), 'Photography'];
    return ['Ambient'];
  }

  function setCaption(title, by, credit) {
    if (!S.caption || !title) { caption.innerHTML = ''; return; }
    caption.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = title.length > 90 ? title.slice(0, 87) + '…' : title;
    caption.appendChild(b);
    if (S.look === 'cinematic' && current) {
      // Netflix layout: tags separated by dots, then one small info line.
      const tags = document.createElement('div');
      tags.className = 'tags';
      tags.textContent = captionTags(current).join('  •  ');
      const line = document.createElement('div');
      line.className = 'line';
      line.textContent = [by, credit].filter(Boolean).join('  ·  ');
      caption.appendChild(tags);
      caption.appendChild(line);
    } else {
      caption.appendChild(document.createTextNode([by, credit].filter(Boolean).join(' — ')));
    }
    setTimeout(() => caption.classList.add('show'), 1200);
  }

  function enabledSources() {
    if (S.mode !== 'mix') return [S.mode];
    const list = [];
    if (S.mixAnime) list.push('anime');
    if (S.mixArt) list.push('art');
    if (S.mixNature) list.push('nature');
    if (S.mixDaily) list.push('daily');
    if (S.mixWalls) list.push('walls');
    if (S.mixSongs) list.push('songs');
    if (S.mixNetflix && S.tmdbKey) list.push('netflix');
    return list.length ? list : ['anime'];
  }

  let sourceIndex = -1, busy = false, rotateTimer = 0, paused = false;

  async function produce(source) {
    if (source === 'anime') {
      const id = nextSceneId();
      const sc = SCENES.find((s) => s.id === id) || SCENES[0];
      return { kind: 'scene', id: sc.id, name: sc.name };
    }
    if (source === 'art') return nextArt();
    if (source === 'nature') return nextNature();
    if (source === 'daily') return nextDaily();
    if (source === 'pinned') {
      if (!S.pinned) throw new Error('Choose a wallpaper in settings first');
      if (S.pinned.url && S.pinned.kind !== 'video') await preload(S.pinned.url);
      return S.pinned;
    }
    if (source === 'walls') {
      const list = await wallpaperLinks();
      if (!list.length) throw new Error('Add wallpaper links in settings or my-wallpapers.txt');
      wallIndex = (wallIndex + 1) % list.length;
      const url = list[wallIndex];
      if (isImageLink(url)) { await preload(url); return { kind: 'wallimg', url }; }
      return { kind: 'video', url };
    }
    if (source === 'songs') return songsCard();
    if (source === 'netflix') return netflixCard();
    throw new Error('unknown source');
  }

  // Fetch (and preload the image of) the next item while the current one is on screen,
  // so changing wallpapers is instant instead of waiting for a download.
  let upcoming = null;
  function prefetch() {
    const sources = enabledSources();
    const source = sources[(sourceIndex + 1) % sources.length];
    if (source === 'pinned') return;
    const promise = produce(source);
    promise.catch(() => {});
    upcoming = { source, promise };
  }

  async function next() {
    if (busy) return;
    busy = true;
    const sources = enabledSources();
    sourceIndex = (sourceIndex + 1) % sources.length;
    const source = sources[sourceIndex];
    try {
      // Use the item fetched in the background while the previous one was showing, if it matches.
      const ready = upcoming && upcoming.source === source ? upcoming.promise : null;
      upcoming = null;
      const item = await (ready || produce(source));
      if (current) { history.push(current); if (history.length > 20) history.shift(); }
      render(item);
      prefetch();
    } catch (e) {
      // Network trouble or empty list: fall back to an offline scene.
      toast(/settings/.test(e.message) ? e.message : 'Could not load ' + source + ' — showing a scene', 4000);
      if (!current || current.kind !== 'scene') {
        const sc = SCENES.find((s) => s.id === nextSceneId()) || SCENES[0];
        render({ kind: 'scene', id: sc.id, name: sc.name });
      }
    }
    busy = false;
    scheduleRotate();
  }

  function prev() {
    const item = history.pop();
    if (!item) { toast('Nothing earlier'); return; }
    render(item);
    scheduleRotate();
  }

  function scheduleRotate() {
    clearTimeout(rotateTimer);
    if (paused) return;
    document.body.classList.toggle('fast', S.interval < 1);
    if (S.mode === 'pinned') return;
    rotateTimer = setTimeout(next, S.interval * 60 * 1000);
  }

  function restartShow() {
    upcoming = null;
    sourceIndex = -1;
    dailyOffset = -1;
    artQueue = [];
    next();
  }

  /* ---------------------------- Clock / HUD ----------------------------- */

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n) => (n < 10 ? '0' : '') + n;

  function tick() {
    const d = new Date();
    let hr = d.getHours();
    let html;
    if (S.clock24) {
      html = pad(hr) + (S.clockStyle === 'stacked' ? '<br>' : ':') + pad(d.getMinutes());
    } else {
      const ampm = hr < 12 ? 'AM' : 'PM';
      hr = hr % 12 || 12;
      html = (S.clockStyle === 'stacked' ? pad(hr) + '<br>' : hr + ':') + pad(d.getMinutes()) + '<span class="ampm">' + ampm + '</span>';
    }
    if (S.seconds) html += '<span class="sec">' + pad(d.getSeconds()) + '</span>';
    $('clock').innerHTML = html;
    $('date').textContent = DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    applyDim();
  }

  function applyHud() {
    hud.className = 'pos-' + S.clockPos + ' size-' + S.clockSize;
    $('clock').classList.toggle('hidden', !S.clock);
    $('date').classList.toggle('hidden', !S.date);
    $('weather').classList.toggle('hidden', !S.weather);
    hud.classList.toggle('hidden', !S.clock && !S.date && !S.weather && player.classList.contains('hidden'));
    applyClockStyle();
    document.body.classList.toggle('cinematic', S.look === 'cinematic');
  }

  // Nudge the overlay a few pixels every minute so nothing sits in one spot for hours.
  function pixelShift() {
    const x = Math.round((Math.random() - 0.5) * 24), y = Math.round((Math.random() - 0.5) * 16);
    hud.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }

  function inNightWindow() {
    if (S.nightDim === 'off') return false;
    const parts = S.nightDim.split('-').map(Number);
    const h = new Date().getHours();
    return parts[0] > parts[1] ? (h >= parts[0] || h < parts[1]) : (h >= parts[0] && h < parts[1]);
  }

  function applyDim() {
    let level = 1 - S.brightness / 100;
    if (inNightWindow()) level = Math.max(level, 0.55);
    dim.style.opacity = level.toFixed(2);
  }

  /* ----------------------------- Weather -------------------------------- */

  const ICONS = {
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    partly: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3.5v1.5M3.5 8H5M4.8 4.8l1 1M11.2 4.8l-1 1"/><path d="M5.6 11a3 3 0 1 1 5.2-2.6"/><path d="M8 19h10a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6 1A3 3 0 0 0 8 19z"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 19h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.2A3.5 3.5 0 0 0 7 19z"/></svg>',
    fog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9h18M5 13h14M3 17h18M7 21h10"/></svg>',
    rain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 15h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.2A3.5 3.5 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/></svg>',
    snow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 15h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.2A3.5 3.5 0 0 0 7 15z"/><path d="M8 19h.01M12 21h.01M16 19h.01M10 22h.01M14 18h.01"/></svg>',
    storm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 15h11a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.2A3.5 3.5 0 0 0 7 15z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/></svg>'
  };

  function describe(code, isDay) {
    if (code === 0) return [isDay ? 'sun' : 'moon', 'Clear'];
    if (code <= 2) return ['partly', 'Partly cloudy'];
    if (code === 3) return ['cloud', 'Cloudy'];
    if (code <= 48) return ['fog', 'Fog'];
    if (code <= 57) return ['rain', 'Drizzle'];
    if (code <= 67) return ['rain', 'Rain'];
    if (code <= 77) return ['snow', 'Snow'];
    if (code <= 82) return ['rain', 'Showers'];
    if (code <= 86) return ['snow', 'Snow showers'];
    return ['storm', 'Thunderstorm'];
  }

  let geo = null, geoCity = '';

  async function updateWeather() {
    if (!S.weather || !S.city) return;
    try {
      if (geoCity !== S.city) {
        const g = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(S.city));
        if (!g.results || !g.results.length) { $('wText').textContent = 'City not found'; return; }
        geo = g.results[0]; geoCity = S.city;
      }
      const unit = S.units === 'f' ? '&temperature_unit=fahrenheit' : '';
      const w = await getJSON('https://api.open-meteo.com/v1/forecast?current=temperature_2m,weather_code,is_day&timezone=auto&latitude=' + geo.latitude + '&longitude=' + geo.longitude + unit);
      const d = describe(w.current.weather_code, w.current.is_day);
      $('wIcon').innerHTML = ICONS[d[0]];
      $('wTemp').textContent = Math.round(w.current.temperature_2m) + '°';
      $('wText').textContent = d[1] + ' · ' + geo.name;
    } catch (e) { /* keep the last reading */ }
  }

  /* ------------------------------ Menu ---------------------------------- */

  const onOff = [[true, 'On'], [false, 'Off']];
  const MENU = [
    { type: 'section', label: 'Look' },
    { label: 'Apply Apple TV style (recommended)', type: 'action', run: () => {
      Object.assign(S, {
        look: 'cinematic', mode: 'mix', interval: 0.25,
        mixAnime: true, mixArt: true, mixNature: true, mixDaily: true, mixWalls: false, mixSongs: false, mixNetflix: false,
        clock: true, clock24: false, seconds: false, date: true, weather: true, caption: true,
        clockFont: 'modern', clockWeight: 'regular', clockColor: 'white', clockStyle: 'inline',
        quality: 'standard', miniPlayer: true
      });
      saveSettings(); applyAll(); restartShow(); renderMenu(); toast('Apple TV style applied');
    } },
    { key: 'look', label: 'Style', options: [['cinematic', 'Cinematic (Netflix / Apple TV)'], ['gallery', 'Gallery (art on a mat)']], restart: true },
    { type: 'section', label: 'What to show' },
    { key: 'mode', label: 'Show', options: [['mix', 'Mix (choose below)'], ['anime', 'Anime scenes'], ['art', 'Paintings'], ['nature', 'Nature photos'], ['daily', 'Daily pictures'], ['walls', 'My wallpapers'], ['pinned', 'My chosen wallpaper'], ['songs', 'Trending songs'], ['netflix', 'Popular on Netflix']], restart: true },
    { label: 'Choose a wallpaper…', type: 'action', run: () => openPicker() },
    { key: 'mixAnime', label: 'Mix: anime scenes', options: onOff, restart: true },
    { key: 'mixArt', label: 'Mix: paintings', options: onOff, restart: true },
    { key: 'mixNature', label: 'Mix: nature photos', options: onOff, restart: true },
    { key: 'mixDaily', label: 'Mix: daily pictures', options: onOff, restart: true },
    { key: 'mixWalls', label: 'Mix: my wallpapers', options: onOff, restart: true },
    { key: 'mixSongs', label: 'Mix: trending songs', options: onOff, restart: true },
    { key: 'mixNetflix', label: 'Mix: Netflix picks', options: onOff, restart: true },
    { key: 'interval', label: 'Change every', options: [[0.05, '3 sec'], [0.25, '15 sec'], [0.5, '30 sec'], [1, '1 min'], [3, '3 min'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 hour']] },
    { type: 'section', label: 'Anime scenes' },
    { key: 'scene', label: 'Scene', options: [['auto', 'Rotate all']].concat(SCENES.map((s) => [s.id, s.name])), restart: true },
    { type: 'section', label: 'Paintings' },
    { key: 'artStyle', label: 'Style', options: [['japanese', 'Japanese prints'], ['impressionism', 'Impressionism'], ['landscapes', 'Landscapes'], ['classics', 'Old masters']], restart: true },
    { key: 'artMat', label: 'Frame mat', options: [['light', 'Gallery white'], ['dark', 'Charcoal'], ['none', 'Full screen']] },
    { key: 'caption', label: 'Show title', options: onOff },
    { type: 'section', label: 'Nature photos' },
    { key: 'natureTopic', label: 'Topic', options: Object.keys(NATURE_CATEGORIES).map((k) => [k, k.charAt(0).toUpperCase() + k.slice(1)]), restart: true },
    { type: 'section', label: 'My wallpapers' },
    { key: 'videos', label: 'Wallpaper links', type: 'text', placeholder: 'Direct .mp4 / .webm / .jpg links, separated by spaces' },
    { key: 'wallList', label: 'Links file', type: 'text', placeholder: 'my-wallpapers.txt or a link to any text file' },
    { type: 'section', label: 'Songs & Netflix' },
    { key: 'songsCountry', label: 'Country', options: MENU_COUNTRIES, restart: true },
    { key: 'tmdbKey', label: 'TMDB key (Netflix)', type: 'text', placeholder: 'Free API key from themoviedb.org' },
    { type: 'section', label: 'Clock & weather' },
    { key: 'clock', label: 'Clock', options: onOff },
    { key: 'clock24', label: 'Format', options: [[false, '12-hour'], [true, '24-hour']] },
    { key: 'seconds', label: 'Seconds', options: onOff },
    { key: 'clockSize', label: 'Size', options: [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] },
    { key: 'clockPos', label: 'Position', options: [['br', 'Bottom right'], ['bl', 'Bottom left'], ['tr', 'Top right'], ['tl', 'Top left'], ['c', 'Centre']] },
    { key: 'clockFont', label: 'Clock font', options: [['modern', 'Modern'], ['classic', 'Classic serif'], ['rounded', 'Rounded'], ['mono', 'Mono'], ['condensed', 'Tall condensed']] },
    { key: 'clockWeight', label: 'Clock weight', options: [['thin', 'Thin'], ['regular', 'Regular'], ['bold', 'Bold']] },
    { key: 'clockColor', label: 'Clock colour', options: [['white', 'White'], ['warm', 'Warm'], ['rose', 'Rose'], ['mint', 'Mint'], ['sky', 'Sky'], ['gold', 'Gold']] },
    { key: 'clockStyle', label: 'Clock layout', options: [['inline', 'Side by side'], ['stacked', 'Stacked']] },
    { key: 'date', label: 'Date', options: onOff },
    { key: 'weather', label: 'Weather', options: onOff },
    { key: 'city', label: 'City', type: 'text', placeholder: 'e.g. Hyderabad' },
    { key: 'units', label: 'Units', options: [['c', '°C'], ['f', '°F']] },
    { type: 'section', label: 'Auto-start' },
    { key: 'autoOn', label: 'Open Ambient by itself', options: onOff },
    { key: 'autoDelay', label: 'When idle for', options: [[5, '5 sec'], [10, '10 sec'], [15, '15 sec'], [30, '30 sec'], [60, '1 min'], [300, '5 min']] },
    { key: 'autoOverSpotify', label: 'Also over Spotify', options: onOff },
    { label: 'Pause auto-start for 30 min', type: 'action', run: () => { fetch(SERVICE + '/config?json=' + encodeURIComponent('{"pause":30}')).catch(() => {}); toast('Auto-start paused for 30 minutes'); } },
    { type: 'section', label: 'Spotify mini player' },
    { key: 'miniPlayer', label: 'Mini player', options: onOff },
    { key: 'spotifyClientId', label: 'Spotify Client ID', type: 'text', placeholder: 'From developer.spotify.com (see guide)' },
    { label: 'Connect Spotify', type: 'action', run: () => { closeMenu(); connectSpotify(); } },
    { label: 'Disconnect Spotify', type: 'action', run: () => { S.spotifyRefresh = ''; spAccess = ''; saveSettings(); pollPlayer(); toast('Spotify disconnected'); } },
    { type: 'section', label: 'Display' },
    { key: 'sleepAfter', label: 'Turn screen off after', options: [[0, 'Never'], [30, '30 min'], [60, '1 hour'], [120, '2 hours'], [240, '4 hours']] },
    { key: 'tone', label: 'Colour tone', options: [['neutral', 'Neutral'], ['warm', 'Warm'], ['cool', 'Cool']] },
    { key: 'motion', label: 'Motion', options: [['full', 'Full'], ['reduced', 'Reduced (no zoom)'], ['still', 'Still (no animation)']], restart: true },
    { key: 'brightness', label: 'Brightness', options: [[100, '100%'], [90, '90%'], [80, '80%'], [70, '70%'], [60, '60%'], [50, '50%'], [40, '40%']] },
    { key: 'nightDim', label: 'Night dimming', options: [['off', 'Off'], ['22-6', '10 PM – 6 AM'], ['23-7', '11 PM – 7 AM'], ['0-6', '12 AM – 6 AM']] },
    { key: 'quality', label: 'Image quality', options: [['standard', 'Standard (faster)'], ['high', 'High (4K, slower)']] },
    { label: 'Reset all settings', type: 'action', run: () => { S = Object.assign({}, DEFAULTS); saveSettings(); applyAll(); restartShow(); renderMenu(); toast('Settings reset'); } }
  ];
  const selectable = MENU.filter((m) => m.type !== 'section');
  let menuSel = 0, editing = null;

  function valueLabel(item) {
    if (item.type === 'text') return S[item.key] ? (item.key === 'tmdbKey' ? 'Saved' : S[item.key]) : 'Not set';
    if (item.type === 'action') return '';
    const opt = item.options.find((o) => o[0] === S[item.key]);
    return opt ? opt[1] : String(S[item.key]);
  }

  function renderMenu() {
    menuList.innerHTML = '';
    let selEl = null;
    MENU.forEach((item) => {
      const li = document.createElement('li');
      if (item.type === 'section') {
        li.className = 'section';
        li.textContent = item.label;
      } else {
        const name = document.createElement('span');
        name.textContent = item.label;
        const val = document.createElement('span');
        val.className = 'val';
        val.textContent = valueLabel(item);
        li.appendChild(name); li.appendChild(val);
        if (item.type) li.classList.add(item.type);
        if (selectable[menuSel] === item) { li.classList.add('sel'); selEl = li; }
      }
      menuList.appendChild(li);
    });
    if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }

  function openMenu() { menu.classList.remove('hidden'); renderMenu(); }
  function closeMenu() { menu.classList.add('hidden'); }
  const menuOpen = () => !menu.classList.contains('hidden');

  function change(dir) {
    const item = selectable[menuSel];
    if (!item.options) return;
    let i = item.options.findIndex((o) => o[0] === S[item.key]);
    i = (i + dir + item.options.length) % item.options.length;
    S[item.key] = item.options[i][0];
    saveSettings();
    applySetting(item);
    renderMenu();
  }

  function activate() {
    const item = selectable[menuSel];
    if (item.type === 'action') { item.run(); return; }
    if (item.type === 'text') {
      editing = item;
      textInput.value = S[item.key] || '';
      textInput.placeholder = item.placeholder || '';
      textInput.classList.add('on');
      textInput.focus();
      return;
    }
    change(1);
  }

  function finishEdit(save) {
    if (!editing) return;
    if (save) {
      S[editing.key] = textInput.value.trim();
      saveSettings();
      applySetting(editing);
    }
    editing = null;
    textInput.classList.remove('on');
    textInput.blur();
    renderMenu();
  }

  function applySetting(item) {
    if (['city', 'units', 'weather'].indexOf(item.key) >= 0) updateWeather();
    if (/^auto/.test(item.key)) sendAutoConfig();
    if (item.key === 'miniPlayer') pollPlayer();
    if (item.key === 'caption' && current) render(current);
    if (item.key === 'artMat' && current && current.kind === 'art') render(current);
    if (item.key === 'interval') scheduleRotate();
    if (['videos', 'wallList'].indexOf(item.key) >= 0) { wallFileAt = 0; if (S.mode === 'walls') restartShow(); }
    if (item.key === 'tmdbKey') { shows = null; if (S.tmdbKey) { S.mixNetflix = true; saveSettings(); } restartShow(); }
    if (item.restart) restartShow();
    applyHud(); applyLook(); tick();
  }

  function applyAll() { applyHud(); applyLook(); tick(); updateWeather(); }

  /* ----------------------------- App dock -------------------------------- */

  // A clean launcher: only the apps the user pins, no ads or suggestions.
  // The TizenBrew service lists installed apps and launches them for us.
  const dock = $('dock'), dockRow = $('dockRow'), grid = $('grid'), gridList = $('gridList');
  const GRID_COLS = 6;
  const DEFAULT_PINS = /netflix|youtube|tizentube|prime|hotstar|spotify|sony ?liv|zee5|disney|apple tv|plex|jellyfin|tizenbrew/i;
  let apps = [], dockSel = 0, gridSel = 0, view = null;

  async function loadApps() {
    apps = await getJSON(SERVICE + '/apps');
    if (!Array.isArray(S.pins)) {
      S.pins = apps.filter((a) => DEFAULT_PINS.test(a.name)).map((a) => a.id).slice(0, 10);
      saveSettings();
    }
  }

  const pinnedApps = () => S.pins.map((id) => apps.find((a) => a.id === id)).filter(Boolean);

  function tileHtml(a, selected, extra) {
    const icon = a.icon ? '<img src="' + esc(SERVICE + a.icon) + '" alt="">' : '<span class="letter">' + esc(a.name.charAt(0)) + '</span>';
    return '<div class="tile' + (selected ? ' sel' : '') + (extra || '') + '"><div class="icon">' + icon + '</div><div class="name">' + esc(a.name) + '</div></div>';
  }

  function renderDock() {
    const items = pinnedApps().concat([{ id: '__all', name: 'All apps' }]);
    dockSel = Math.min(dockSel, items.length - 1);
    dockRow.innerHTML = items.map((a, i) => a.id === '__all'
      ? '<div class="tile all' + (i === dockSel ? ' sel' : '') + '"><div class="icon"><span class="letter">⋯</span></div><div class="name">All apps</div></div>'
      : tileHtml(a, i === dockSel)).join('');
    const sel = dockRow.children[dockSel];
    if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return items;
  }

  function renderGrid() {
    gridList.innerHTML = apps.map((a, i) => tileHtml(a, i === gridSel, S.pins.indexOf(a.id) >= 0 ? ' pinned' : '')).join('');
    const sel = gridList.children[gridSel];
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  async function openDock() {
    try {
      if (!apps.length) await loadApps();
    } catch (e) {
      toast('The app dock needs Ambient to be opened from TizenBrew', 4000);
      return;
    }
    view = 'dock'; dockSel = 0;
    renderDock();
    dock.classList.add('show');
  }

  function closeDock() {
    view = null;
    dock.classList.remove('show');
    grid.classList.remove('show');
  }

  async function launch(a) {
    toast('Opening ' + a.name);
    closeDock();
    try { await getJSON(SERVICE + '/launch?id=' + encodeURIComponent(a.id)); }
    catch (e) { toast('Could not open ' + a.name, 3500); }
  }

  function togglePin(a) {
    const i = S.pins.indexOf(a.id);
    if (i >= 0) S.pins.splice(i, 1); else S.pins.push(a.id);
    saveSettings();
    toast(i >= 0 ? 'Removed from dock' : 'Added to dock');
    renderGrid();
  }

  function dockKey(k) {
    if (view === 'dock') {
      const items = renderDock();
      if (k === K.LEFT) dockSel = (dockSel - 1 + items.length) % items.length;
      else if (k === K.RIGHT) dockSel = (dockSel + 1) % items.length;
      else if (k === K.ENTER) {
        const a = items[dockSel];
        if (a.id === '__all') { view = 'grid'; gridSel = 0; dock.classList.remove('show'); grid.classList.add('show'); renderGrid(); return; }
        launch(a); return;
      } else if (k === K.BACK || k === K.ESC || k === K.BACKSPACE || k === K.UP) { closeDock(); return; }
      renderDock();
    } else if (view === 'grid') {
      if (k === K.LEFT) gridSel = Math.max(0, gridSel - 1);
      else if (k === K.RIGHT) gridSel = Math.min(apps.length - 1, gridSel + 1);
      else if (k === K.UP) gridSel = Math.max(0, gridSel - GRID_COLS);
      else if (k === K.DOWN) gridSel = Math.min(apps.length - 1, gridSel + GRID_COLS);
      else if (k === K.ENTER) { launch(apps[gridSel]); return; }
      else if (k === K.RED || k === K.PLAYPAUSE || k === K.GREEN) { togglePin(apps[gridSel]); return; }
      else if (k === K.BACK || k === K.ESC || k === K.BACKSPACE) { view = 'dock'; grid.classList.remove('show'); dock.classList.add('show'); renderDock(); return; }
      renderGrid();
    }
  }

  /* --------------------- Screensaver behaviour ---------------------------- */

  // When the idle timer opened Ambient, it behaves like a TV screensaver: any
  // button returns to where the viewer was (Samsung home, or Spotify with the
  // music still playing). ▲ controls the music, and holding OK opens settings.
  let screensaver = false, prevApp = '', okDownAt = 0;

  async function checkSession() {
    try {
      const s = await getJSON(SERVICE + '/session');
      if (s.auto) { screensaver = true; prevApp = s.prevApp || ''; lastInput = Date.now(); wake(); }
    } catch (e) { /* helper not running: normal app behaviour */ }
  }

  function dismiss() {
    screensaver = false;
    closeDock(); closePicker(); closeMenu();
    if (prevApp) {
      fetch(SERVICE + '/launch?id=' + encodeURIComponent(prevApp)).catch(() => {});
    } else {
      try { tizen.application.getCurrentApplication().hide(); } catch (e) { toast('Press Back to leave Ambient'); }
    }
  }

  function screensaverKey(e) {
    const k = e.keyCode;
    if (k === K.ENTER) { e.preventDefault(); if (!okDownAt) okDownAt = Date.now(); return true; }
    if (k === K.UP && !player.classList.contains('hidden')) return false; // let ▲ reach the mini player
    e.preventDefault();
    dismiss();
    return true;
  }

  document.addEventListener('keyup', (e) => {
    if (e.keyCode !== K.ENTER || !okDownAt) return;
    const held = Date.now() - okDownAt;
    okDownAt = 0;
    if (!screensaver) return;
    if (held > 700) { screensaver = false; openMenu(); toast('Settings'); } else { dismiss(); }
  });

  /* ------------------ Premium ambient settings ---------------------------- */

  // Turn the screen dark after a while with no button presses, like the
  // "Sleep after" option on Samsung Frame / LG Gallery mode.
  let lastInput = Date.now(), sleeping = false;
  const sleepEl = $('sleep'), toneEl = $('tone');

  function goToSleep() {
    sleeping = true;
    sleepEl.classList.add('on');
    clearTimeout(rotateTimer);
    stopScene();
  }

  function wake() {
    if (!sleeping) return;
    sleeping = false;
    sleepEl.classList.remove('on');
    if (current && current.kind === 'scene') startScene(current.id);
    scheduleRotate();
  }

  function checkSleep() {
    if (!sleeping && S.sleepAfter > 0 && Date.now() - lastInput > S.sleepAfter * 60000) goToSleep();
  }

  function applyLook() {
    toneEl.className = 'tone-' + S.tone;
    document.body.classList.toggle('motion-reduced', S.motion !== 'full');
    document.body.classList.toggle('motion-still', S.motion === 'still');
  }

  /* ------------------------------ Remote -------------------------------- */

  const K = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESC: 27, BACKSPACE: 8,
    IME_DONE: 65376, IME_CANCEL: 65385,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    PLAYPAUSE: 10252, INFO: 457
  };

  function quickMode(mode, label) {
    S.mode = mode; saveSettings(); restartShow(); toast(label);
  }

  document.addEventListener('keydown', (e) => {
    const k = e.keyCode;
    lastInput = Date.now();
    if (sleeping) { e.preventDefault(); wake(); return; }
    if (screensaver && !playerFocus && !menuOpen() && screensaverKey(e)) return;

    if (editing) {
      if (k === K.ENTER || k === K.IME_DONE) { e.preventDefault(); finishEdit(true); }
      else if (k === K.BACK || k === K.ESC || k === K.IME_CANCEL) { e.preventDefault(); finishEdit(false); }
      return;
    }

    if (playerFocus) { e.preventDefault(); playerKey(k); return; }
    if (picking) { e.preventDefault(); pickerKey(k); return; }
    if (view) { e.preventDefault(); dockKey(k); return; }

    if (menuOpen()) {
      e.preventDefault();
      if (k === K.UP) { menuSel = (menuSel - 1 + selectable.length) % selectable.length; renderMenu(); }
      else if (k === K.DOWN) { menuSel = (menuSel + 1) % selectable.length; renderMenu(); }
      else if (k === K.LEFT) change(-1);
      else if (k === K.RIGHT) change(1);
      else if (k === K.ENTER) activate();
      else if (k === K.BACK || k === K.ESC || k === K.BACKSPACE) closeMenu();
      return;
    }

    switch (k) {
      case K.ENTER: e.preventDefault(); openMenu(); break;
      case K.RIGHT: e.preventDefault(); next(); break;
      case K.LEFT: e.preventDefault(); prev(); break;
      case K.UP:
        e.preventDefault();
        if (!player.classList.contains('hidden')) {
          playerFocus = true; renderPlayer();
          toast('◀ previous · OK play/pause · ▶ next · ▼ done', 3500);
        } else {
          S.clock = !S.clock; S.date = S.clock; saveSettings(); applyHud();
        }
        break;
      case K.DOWN: e.preventDefault(); openDock(); break;
      case K.INFO:
        e.preventDefault();
        caption.classList.toggle('show');
        break;
      case K.PLAYPAUSE:
        e.preventDefault();
        paused = !paused; scheduleRotate();
        toast(paused ? 'Paused on this one' : 'Slideshow resumed');
        break;
      case K.RED: quickMode('anime', 'Anime scenes'); break;
      case K.GREEN: quickMode('art', 'Paintings'); break;
      case K.YELLOW: quickMode('nature', 'Nature photos'); break;
      case K.BLUE: quickMode('mix', 'Mix of everything'); break;
      case K.BACK:
        if (standalone()) { e.preventDefault(); try { tizen.application.getCurrentApplication().hide(); } catch (err) { /* ignore */ } }
        break;
      default: break; // other keys keep their normal TV behaviour
    }
  });

  textInput.addEventListener('blur', () => { if (editing) finishEdit(true); });

  /* -------------------------- Keep screen awake ------------------------- */

  function keepAwake() {
    try { if (window.tizen && tizen.power) tizen.power.request('SCREEN', 'SCREEN_NORMAL'); } catch (e) { /* not permitted here */ }
    try {
      if (window.webapis && webapis.appcommon) {
        webapis.appcommon.setScreenSaver(webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF, () => {}, () => {});
      }
    } catch (e) { /* not available here */ }
  }

  // Installed as its own TV app (tizen/config.xml) rather than as a TizenBrew module?
  function standalone() {
    try { return tizen.application.getAppInfo().packageId === 'AmbientTV1'; } catch (e) { return false; }
  }

  // The helper runs as its own Tizen service when Ambient is a standalone app.
  function startHelper() {
    if (!standalone()) return;
    try {
      tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
        'AmbientTV1.AmbientHelper', () => setTimeout(sendAutoConfig, 1500), () => {});
    } catch (e) { /* helper unavailable */ }
  }

  function registerKeys() {
    try {
      if (window.tizen && tizen.tvinputdevice) {
        ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlayPause', 'Info'].forEach((key) => {
          try { tizen.tvinputdevice.registerKey(key); } catch (e) { /* already registered */ }
        });
      }
    } catch (e) { /* not available */ }
  }

  /* ------------------------------- Start -------------------------------- */

  window.addEventListener('resize', () => { if (current && current.kind === 'scene') startScene(current.id); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopScene(); }
    else { keepAwake(); checkSession(); if (current && current.kind === 'scene') startScene(current.id); }
  });

  registerKeys();
  startHelper();
  keepAwake();
  applyAll();
  sendAutoConfig();
  pollPlayer();
  setInterval(pollPlayer, 4000);
  setInterval(checkSleep, 30000);
  checkSession();
  setInterval(tick, 1000);
  setInterval(pixelShift, 60 * 1000);
  setInterval(updateWeather, 15 * 60 * 1000);
  setInterval(keepAwake, 5 * 60 * 1000);
  next();
  setTimeout(() => toast('OK: settings  ·  ▼: your apps  ·  ▲: music  ·  ◀ ▶: change', 5000), 1500);
})();
