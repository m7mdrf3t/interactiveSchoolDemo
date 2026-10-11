/* Virtual school tour — viewer, navigation graph, guided tour.
 * Static site: everything is driven by config/tour.json. See README.md.
 * Developer hotspot editor: add ?edit=1 to the URL (loads js/editor.js).
 */
(function () {
  'use strict';

  var DEG = Math.PI / 180;
  // Config and editor use "pitch up is positive"; Marzipano uses "pitch down is positive". Convert only here.
  function mzPitch(deg) { return -deg * DEG; }
  function cfgPitch(rad) { return -rad / DEG; }
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var DEV = params.has('edit');
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = {
    config: null,
    viewer: null,
    scenes: {},        // id -> Promise<record>
    assets: {},        // id -> { panorama:boolean, manifest:object|null, usable:boolean }
    current: null,     // current scene id
    busy: false,
    gyro: { method: null, on: false },
    tour: { active: false, index: 0, paused: false, timer: null }
  };

  // ------------------------------------------------------------------ utils

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  // Config fov is the vertical field of view for landscape screens. In portrait, widen it so the
  // horizontal view stays roughly as wide as on a landscape screen.
  function fitFov(deg) {
    var el = $('pano'), a = el.clientWidth / Math.max(1, el.clientHeight);
    if (a >= 1) return deg;
    return Math.min(120, 2 * Math.atan(Math.tan(85 * DEG / 2) / a) / DEG);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function dur(ms) { return REDUCED ? Math.min(ms, 150) : ms; }
  function sceneDef(id) { return state.config.scenes.filter(function (s) { return s.id === id; })[0]; }

  var toastTimer;
  function toast(msg, warn) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.toggle('warn', !!warn);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, warn ? 5000 : 2600);
  }

  function tween(ms, step) {
    return new Promise(function (resolve) {
      var t0 = performance.now();
      (function frame(now) {
        var t = clamp((now - t0) / ms, 0, 1);
        step(ease(t));
        if (t < 1) requestAnimationFrame(frame); else resolve();
      })(t0);
    });
  }

  function preloadImage(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      var done = function () { resolve(); };
      img.onload = img.onerror = done;
      img.src = url;
      setTimeout(done, 4000);
    });
  }

  function head(url) {
    return fetch(url, { method: 'HEAD', cache: 'no-cache' }).then(function (r) { return r.ok; }, function () { return false; });
  }

  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return false; }
  }

  function maxTextureSize() {
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      return Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192);
    } catch (e) { return 4096; }
  }

  // ------------------------------------------------------------ config / assets

  function loadConfig() {
    if (location.protocol === 'file:') {
      return Promise.reject(new Error('This page must be served over HTTP (browsers block loading config and images from file://).\nRun:  python3 -m http.server 8080   then open http://localhost:8080'));
    }
    return fetch('config/tour.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('Could not load config/tour.json (HTTP ' + r.status + ').');
      return r.json();
    }).then(function (cfg) {
      // Editor mode keeps an autosaved draft in this browser; ?fresh ignores it.
      if (DEV && !params.has('fresh')) {
        try {
          var d = JSON.parse(localStorage.getItem('tourEditorDraft') || 'null');
          if (d && Array.isArray(d.scenes)) { state.usingDraft = true; return d; }
        } catch (e) { /* storage unavailable or corrupt: use the file */ }
      }
      return cfg;
    });
  }

  function checkAssets() {
    var tileDir = state.config.assets.tileDir;
    return Promise.all(state.config.scenes.map(function (def) {
      return Promise.all([
        head(def.file),
        fetch(tileDir + '/' + def.id + '/manifest.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
      ]).then(function (res) {
        state.assets[def.id] = { panorama: res[0], manifest: res[1], usable: !!(res[0] || res[1]) };
      });
    }));
  }

  function missingScenes() {
    return state.config.scenes.filter(function (s) { return !state.assets[s.id].usable; });
  }

  function showMissing(defs) {
    var old = $('missing'); if (old) old.remove();
    var el = document.createElement('div');
    el.id = 'missing';
    var list = defs.map(function (d) { return '<li><code>' + d.file + '</code> — ' + d.name + ' (' + d.title + ')</li>'; }).join('');
    el.innerHTML = '<div class="card" role="alertdialog" aria-labelledby="miss-h"><h3 id="miss-h">Panorama image' + (defs.length > 1 ? 's' : '') + ' not found</h3>' +
      '<p>These files are listed in <code>config/tour.json</code> but could not be loaded, so those scenes cannot be shown:</p><ul>' + list + '</ul>' +
      '<p>Export each 360° photo from Insta360 as a 2:1 equirectangular JPEG, save it at the path above, and reload. See <code>README.md</code> › “Exporting the panoramas”.</p>' +
      '<button class="btn" id="miss-ok">OK</button></div>';
    document.body.appendChild(el);
    $('miss-ok').onclick = function () { el.remove(); };
  }

  // ------------------------------------------------------------------ scenes

  function createSource(def) {
    var a = state.assets[def.id];
    var cfg = state.config.assets;
    if (a.manifest) {
      var dir = cfg.tileDir + '/' + def.id;
      return Promise.resolve({
        source: Marzipano.ImageUrlSource.fromString(dir + '/{z}/{f}/{y}/{x}.jpg', { cubeMapPreviewUrl: dir + '/preview.jpg' }),
        geometry: new Marzipano.CubeGeometry(a.manifest.levels),
        resolution: a.manifest.levels[a.manifest.levels.length - 1].size * 4,
        preload: dir + '/preview.jpg'
      });
    }
    // Fallback: plain equirect JPEG, downscaled to the GPU's texture limit when needed.
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var max = maxTextureSize(), w = img.naturalWidth, url = def.file;
        if (w > max) {
          var c = document.createElement('canvas');
          c.width = max; c.height = Math.round(max * img.naturalHeight / img.naturalWidth);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (blob) {
            resolve({ source: Marzipano.ImageUrlSource.fromString(URL.createObjectURL(blob)), geometry: new Marzipano.EquirectGeometry([{ width: max }]), resolution: max });
          }, 'image/jpeg', 0.9);
        } else {
          resolve({ source: Marzipano.ImageUrlSource.fromString(url), geometry: new Marzipano.EquirectGeometry([{ width: w }]), resolution: w });
        }
      };
      img.onerror = function () { reject(new Error('Could not load ' + def.file)); };
      img.src = def.file;
    });
  }

  function getScene(id) {
    if (!state.scenes[id]) {
      var def = sceneDef(id);
      state.scenes[id] = createSource(def).then(function (s) {
        var limiter = Marzipano.RectilinearView.limit.traditional(s.resolution, 120 * DEG, 120 * DEG);
        var iv = def.initialView;
        var view = new Marzipano.RectilinearView({ yaw: iv.yaw * DEG, pitch: mzPitch(iv.pitch), fov: fitFov(iv.fov) * DEG }, limiter);
        var scene = state.viewer.createScene({ source: s.source, geometry: s.geometry, view: view, pinFirstLevel: true });
        var rec = { def: def, scene: scene, view: view, preload: s.preload, els: {} };
        buildHotspots(rec);
        return rec;
      });
      state.scenes[id].catch(function () { delete state.scenes[id]; });
    }
    return state.scenes[id];
  }

  // ---------------------------------------------------------------- hotspots

  function linkVisible(h) { return h.status === 'confirmed' || h.status === 'visual' || DEV; }

  function isolate(el) {
    ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel', 'mousewheel', 'mousedown'].forEach(function (ev) {
      el.addEventListener(ev, function (e) { e.stopPropagation(); });
    });
  }

  function hotspotEl(rec, h) {
    var wrap = document.createElement('div');
    wrap.className = 'hs-wrap';
    var b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = h.id;
    var label = document.createElement('span');
    label.className = 'hs-label';
    label.textContent = h.label || (h.type === 'link' ? 'Go' : 'Info');
    if (h.type === 'link') {
      b.className = 'hs hs-link' + (h.status === 'unverified' ? ' unverified' : '');
      b.setAttribute('aria-label', 'Go to ' + (h.label || h.target));
      b.innerHTML = '<span class="ring"></span><svg class="arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7"/></svg>';
    } else {
      b.className = 'hs hs-info';
      b.setAttribute('aria-label', h.label || h.title || 'Information');
      b.textContent = 'i';
    }
    b.appendChild(label);
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (DEV && window.TourEditor && window.TourEditor.onHotspotClick(rec.def.id, h)) return;
      if (h.type === 'link') goTo(h.target, { via: h, entry: h.entry });
      else showInfo(h);
    });
    wrap.appendChild(b);
    isolate(wrap);
    return wrap;
  }

  function buildHotspots(rec) {
    var cont = rec.scene.hotspotContainer();
    cont.listHotspots().slice().forEach(function (hs) { cont.destroyHotspot(hs); });
    rec.els = {};
    (rec.def.hotspots || []).forEach(function (h) {
      if (h.type === 'link' && !linkVisible(h)) return;
      var el = hotspotEl(rec, h);
      rec.els[h.id] = el;
      cont.createHotspot(el, { yaw: h.yaw * DEG, pitch: mzPitch(h.pitch) });
    });
  }

  function rebuildHotspots(id) {
    var p = state.scenes[id];
    if (p) p.then(buildHotspots);
  }

  function showInfo(h) {
    $('info-title').textContent = h.title || h.label || '';
    $('info-text').textContent = h.text || '';
    $('info').hidden = false;
  }
  function hideInfo() { $('info').hidden = true; }

  // -------------------------------------------------------------- navigation

  function currentView() {
    var v = state.viewer.view();
    return { yaw: v.yaw() / DEG, pitch: cfgPitch(v.pitch()), fov: v.fov() / DEG };
  }

  function shortestYaw(from, to) {
    var d = ((to - from + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    return from + d;
  }

  function findLink(fromId, toId) {
    var def = sceneDef(fromId);
    if (!def) return null;
    return (def.hotspots || []).filter(function (h) { return h.type === 'link' && h.target === toId && linkVisible(h); })[0] || null;
  }

  /* Move to a scene. With `via` (a link hotspot) the camera glides to the doorway and the destination opens
   * facing `entry`, so it feels like walking through. Without it (menu / map / tour cut) it is a plain fade. */
  function goTo(id, opts) {
    opts = opts || {};
    if (state.busy || (id === state.current && !opts.force)) return Promise.resolve();
    var def = sceneDef(id);
    if (!def) { toast('Unknown scene: ' + id, true); return Promise.resolve(); }
    if (!state.assets[id].usable) { showMissing([def]); return Promise.resolve(); }

    state.busy = true;
    hideInfo();
    var controls = state.viewer.controls();
    state.viewer.stopMovement();

    return getScene(id).then(function (rec) {
      var entry = opts.entry || def.initialView;
      var target = { yaw: (entry.yaw || 0) * DEG, pitch: mzPitch(entry.pitch || 0), fov: fitFov(entry.fov || def.initialView.fov) * DEG };
      var walking = opts.via && state.current && !opts.instant;
      var warm = rec.preload ? preloadImage(rec.preload) : Promise.resolve();
      var from = state.current && state.scenes[state.current];

      var dive = Promise.resolve();
      if (walking && from) {
        controls.disable();
        dive = from.then(function (fr) {
          var v = fr.view, y0 = v.yaw(), p0 = v.pitch(), f0 = v.fov();
          var y1 = shortestYaw(y0, opts.via.yaw * DEG), p1 = mzPitch(opts.via.pitch), f1 = f0 * 0.6;
          return tween(dur(800), function (t) {
            v.setParameters({ yaw: y0 + (y1 - y0) * t, pitch: p0 + (p1 - p0) * t, fov: f0 + (f1 - f0) * t });
          });
        });
      }

      return Promise.all([warm, dive]).then(function () {
        var arrivalFov = target.fov;
        rec.view.setParameters({ yaw: target.yaw, pitch: target.pitch, fov: walking ? arrivalFov * 0.75 : arrivalFov });
        var fade = (!state.current || opts.instant) ? 0 : dur(walking ? 900 : 650);
        return new Promise(function (resolve) { rec.scene.switchTo({ transitionDuration: fade }, resolve); }).then(function () {
          state.current = id;
          updateChrome(def);
          prefetchNeighbours(def);
          if (walking) {
            return tween(dur(700), function (t) {
              rec.view.setFov(arrivalFov * (0.75 + 0.25 * t));
            });
          }
        });
      }).then(function () {
        controls.enable();
        state.busy = false;
        if (opts.preview && window.TourEditor) window.TourEditor.afterPreview(opts.preview);
      });
    }).catch(function (err) {
      state.busy = false;
      state.viewer.controls().enable();
      toast('Could not load ' + def.name + ': ' + err.message, true);
    });
  }

  function prefetchNeighbours(def) {
    (def.hotspots || []).forEach(function (h) {
      if (h.type === 'link' && linkVisible(h) && state.assets[h.target] && state.assets[h.target].usable) {
        getScene(h.target).then(function (rec) { if (rec.preload) preloadImage(rec.preload); });
      }
    });
  }

  function updateChrome(def) {
    $('scene-title').textContent = def.name + ' · ' + def.title;
    $('scene-chip').hidden = !def.provisional;
    document.title = def.title + ' — ' + state.config.school.name;
    try { history.replaceState(null, '', '#' + def.id); } catch (e) { /* ignore */ }
    Array.prototype.forEach.call(document.querySelectorAll('.loc'), function (b) {
      b.setAttribute('aria-current', String(b.dataset.id === def.id));
    });
    Array.prototype.forEach.call(document.querySelectorAll('#map-svg .node'), function (n) {
      n.classList.toggle('current', n.dataset.id === def.id);
    });
    if (window.TourEditor && window.TourEditor.onSceneChange) window.TourEditor.onSceneChange(def.id);
  }

  // ---------------------------------------------------------------- menu / map

  function buildMenu() {
    var list = $('menu-list');
    list.innerHTML = '';
    state.config.scenes.forEach(function (def) {
      var a = state.assets[def.id];
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.className = 'loc';
      b.dataset.id = def.id;
      b.setAttribute('aria-current', String(def.id === state.current));
      b.innerHTML = '<span class="th"></span><span><span class="num"></span><span class="ttl" style="display:block"></span><span class="miss" hidden>image missing</span></span>';
      b.querySelector('.th').style.backgroundImage = 'url("' + state.config.assets.thumbDir + '/' + def.id + '.jpg")';
      b.querySelector('.num').textContent = def.name + (def.provisional ? ' · provisional' : '');
      b.querySelector('.ttl').textContent = def.title;
      b.querySelector('.miss').hidden = a.usable;
      b.addEventListener('click', function () {
        goTo(def.id);
        if (window.innerWidth < 900) setMenu(false);
      });
      li.appendChild(b);
      list.appendChild(li);
    });
    var miss = missingScenes();
    var btn = $('btn-assets');
    btn.hidden = !miss.length;
    if (miss.length) {
      btn.textContent = '⚠ ' + miss.length + ' of ' + state.config.scenes.length + ' panorama images not found — tap for details';
      btn.onclick = function () { showMissing(miss); };
    }
  }

  function setMenu(open) {
    var m = $('menu');
    if (open) m.hidden = false;
    m.classList.toggle('open', open);
    $('btn-menu').setAttribute('aria-expanded', String(open));
    if (!open) setTimeout(function () { if (!m.classList.contains('open')) m.hidden = true; }, 320);
  }

  function buildMap() {
    var svg = $('map-svg');
    var NS = 'http://www.w3.org/2000/svg';
    svg.innerHTML = '';
    var seen = {};
    var edges = [];
    state.config.scenes.forEach(function (def) {
      (def.hotspots || []).forEach(function (h) {
        if (h.type !== 'link' || !linkVisible(h) || !sceneDef(h.target)) return;
        var key = [def.id, h.target].sort().join('|') + (h.status === 'unverified' ? '|u' : '');
        if (seen[key]) return;
        seen[key] = 1;
        edges.push({ a: def, b: sceneDef(h.target), unverified: h.status === 'unverified' });
      });
    });
    function mk(tag, attrs, text) {
      var e = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (text != null) e.textContent = text;
      return e;
    }
    edges.forEach(function (e) {
      if (!e.a.map || !e.b.map) return;
      svg.appendChild(mk('line', { 'class': 'edge' + (e.unverified ? ' unverified' : ''), x1: e.a.map.x, y1: e.a.map.y, x2: e.b.map.x, y2: e.b.map.y }));
    });
    state.config.scenes.forEach(function (def, i) {
      if (!def.map) return;
      var g = mk('g', { 'class': 'node' + (def.id === state.current ? ' current' : '') + (state.assets[def.id].usable ? '' : ' missing'), 'data-id': def.id, tabindex: 0, role: 'button', 'aria-label': def.name + ' ' + def.title });
      g.appendChild(mk('circle', { cx: def.map.x, cy: def.map.y, r: 6.5 }));
      g.appendChild(mk('text', { x: def.map.x, y: def.map.y }, String(i + 1)));
      g.appendChild(mk('text', { 'class': 'lbl', x: def.map.x, y: def.map.y + 11 }, def.short || def.title));
      var go = function () { goTo(def.id); };
      g.addEventListener('click', go);
      g.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
      svg.appendChild(g);
    });
  }

  // ------------------------------------------------------------- guided tour

  function tourOrder() {
    return state.config.tour.order.filter(function (id) { return sceneDef(id) && state.assets[id].usable; });
  }

  function stopDwell() {
    clearTimeout(state.tour.timer);
    state.viewer.stopMovement();
    var fill = $('tour-bar-fill');
    fill.style.transition = 'none';
    fill.style.width = '0';
  }

  function tourStep(i) {
    var order = tourOrder();
    var t = state.tour;
    if (i < 0) i = 0;
    if (i >= order.length) { exitTour(); toast('That was the whole tour — explore freely from the menu or map.'); return; }
    stopDwell();
    t.index = i;
    var id = order[i];
    var def = sceneDef(id);
    var via = state.current ? findLink(state.current, id) : null;
    $('tour-step').textContent = 'Stop ' + (i + 1) + ' of ' + order.length + ' · ' + def.title;
    $('tour-text').textContent = (def.tour && def.tour.text) || def.description || '';
    $('tour-pause').textContent = 'Pause';
    t.paused = false;
    var go = id === state.current ? Promise.resolve() : goTo(id, via ? { via: via, entry: via.entry } : {});
    go.then(function () { if (t.active && t.index === i) startDwell(def); });
  }

  function startDwell(def) {
    var t = state.tour;
    var secs = (def.tour && def.tour.dwellSeconds) || state.config.tour.defaultDwellSeconds || 12;
    var iv = def.initialView;
    if (!REDUCED) {
      state.viewer.startMovement(Marzipano.autorotate({ yawSpeed: 0.05, targetPitch: mzPitch(iv.pitch), targetFov: fitFov(iv.fov) * DEG }));
    }
    var fill = $('tour-bar-fill');
    fill.style.transition = 'none'; fill.style.width = '0';
    void fill.offsetWidth;
    fill.style.transition = 'width ' + secs + 's linear'; fill.style.width = '100%';
    clearTimeout(t.timer);
    t.timer = setTimeout(function () { if (t.active && !t.paused) tourStep(t.index + 1); }, secs * 1000);
  }

  function startTour() {
    if (!tourOrder().length) { toast('No scenes are available for the tour.', true); return; }
    state.tour.active = true;
    welcomeOut();
    document.body.classList.add('touring');
    $('tourbar').hidden = false;
    $('hint').hidden = true;
    tourStep(0);
  }

  function exitTour() {
    state.tour.active = false;
    stopDwell();
    document.body.classList.remove('touring');
    $('tourbar').hidden = true;
  }

  function toggleTourPause() {
    var t = state.tour;
    t.paused = !t.paused;
    $('tour-pause').textContent = t.paused ? 'Resume' : 'Pause';
    if (t.paused) stopDwell(); else startDwell(sceneDef(state.current));
  }

  // ---------------------------------------------------------------- controls

  function zoom(factor) {
    var v = state.viewer.view();
    var f0 = v.fov(), f1 = f0 * factor;
    tween(dur(220), function (t) { v.setFov(f0 + (f1 - f0) * t); });
  }

  function toggleFullscreen() {
    var d = document, el = d.documentElement;
    var active = d.fullscreenElement || d.webkitFullscreenElement;
    if (active) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }

  function setupGyro() {
    var touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!touch || typeof window.DeviceOrientationEvent === 'undefined') return;
    var btn = $('btn-gyro');
    btn.hidden = false;
    btn.addEventListener('click', function () {
      var g = state.gyro;
      if (g.on) { state.viewer.controls().disableMethod('deviceOrientation'); g.on = false; btn.setAttribute('aria-pressed', 'false'); return; }
      var ask = typeof DeviceOrientationEvent.requestPermission === 'function' ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
      ask.then(function (res) {
        if (res !== 'granted') { toast('Motion access was declined, so the gyroscope is off.', true); return; }
        var got = false;
        var probe = function (e) { if (e.alpha != null || e.beta != null) got = true; };
        window.addEventListener('deviceorientation', probe);
        if (!g.method) {
          g.method = new Marzipano.DeviceOrientationControlMethod();
          state.viewer.controls().registerMethod('deviceOrientation', g.method);
        }
        state.viewer.controls().enableMethod('deviceOrientation');
        g.on = true; btn.setAttribute('aria-pressed', 'true');
        toast('Gyroscope on — move your phone to look around');
        setTimeout(function () {
          window.removeEventListener('deviceorientation', probe);
          if (!got && g.on) {
            state.viewer.controls().disableMethod('deviceOrientation');
            g.on = false; btn.setAttribute('aria-pressed', 'false');
            toast('No gyroscope data from this device.', true);
          }
        }, 1800);
      }, function () { toast('Could not enable the gyroscope.', true); });
    });
  }

  function bindUI() {
    $('btn-menu').onclick = function () { setMenu(!$('menu').classList.contains('open')); };
    $('menu-close').onclick = function () { setMenu(false); };
    $('btn-tour').onclick = function () { state.tour.active ? exitTour() : startTour(); };
    $('btn-map').onclick = function () {
      var m = $('map'); m.hidden = !m.hidden;
      $('btn-map').setAttribute('aria-pressed', String(!m.hidden));
    };
    $('btn-zoom-in').onclick = function () { zoom(0.75); };
    $('btn-zoom-out').onclick = function () { zoom(1.33); };
    var fsOK = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
    $('btn-full').hidden = !fsOK;
    $('btn-full').onclick = toggleFullscreen;
    $('info-close').onclick = hideInfo;
    $('tour-next').onclick = function () { tourStep(state.tour.index + 1); };
    $('tour-prev').onclick = function () { tourStep(state.tour.index - 1); };
    $('tour-pause').onclick = toggleTourPause;
    $('tour-exit').onclick = exitTour;
    document.addEventListener('keydown', function (e) {
      if (/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
      if (e.key === 'Escape') { hideInfo(); setMenu(false); }
      else if (e.key === 'm' || e.key === 'M') setMenu(!$('menu').classList.contains('open'));
      else if (e.key === 'f' || e.key === 'F') { if (!$('btn-full').hidden) toggleFullscreen(); }
    });
    $('pano').addEventListener('pointerdown', function () { hideInfo(); if (window.innerWidth < 900) setMenu(false); state.viewer.breakIdleMovement && state.viewer.breakIdleMovement(); });
    setupGyro();
  }

  // ------------------------------------------------------------------- start

  function welcomeOut() {
    var w = $('welcome');
    if (w.classList.contains('gone')) return;
    state.viewer.stopMovement();
    w.classList.add('gone');
    ['topbar', 'controls'].forEach(function (id) { $(id).hidden = false; });
    $('hint').hidden = state.tour.active;
    setTimeout(function () { w.remove(); }, 700);
    if (!state.tour.active) $('btn-map').click();
    if (window.innerWidth < 700) { $('map').hidden = true; $('btn-map').setAttribute('aria-pressed', 'false'); }
  }

  function fail(err) {
    var box = $('welcome-error');
    box.hidden = false;
    box.textContent = err.message || String(err);
    $('start-explore').textContent = 'Unavailable';
  }

  function init() {
    if (!window.Marzipano || !hasWebGL()) {
      return fail(new Error('This browser does not support WebGL, which the 360° viewer needs. Try a current version of Chrome, Safari, Firefox or Edge.'));
    }
    if (DEV) document.body.classList.add('dev');
    loadConfig().then(function (cfg) {
      state.config = cfg;
      var s = cfg.school;
      $('welcome-name').textContent = s.name;
      $('welcome-sub').textContent = s.subtitle || '';
      $('welcome-tagline').textContent = s.tagline || '';
      $('school-name').textContent = s.name;
      document.title = s.name + ' — Virtual Tour';
      state.viewer = new Marzipano.Viewer($('pano'), { controls: { mouseViewMode: 'drag' } });
      return checkAssets();
    }).then(function () {
      bindUI();
      var miss = missingScenes();
      var wanted = params.get('scene') || location.hash.slice(1);
      var startId = (wanted && sceneDef(wanted) && wanted) || state.config.startScene;
      if (!state.assets[startId].usable) {
        var ok = state.config.scenes.filter(function (d) { return state.assets[d.id].usable; })[0];
        if (!ok) { showMissing(miss); throw new Error('None of the panorama images could be found. See the list above.'); }
        startId = ok.id;
      }
      buildMenu(); buildMap();
      var tourOK = tourOrder().length > 0;
      return getScene(startId).then(function () {
        return goTo(startId, { instant: true });
      }).then(function () {
        if (!REDUCED) state.viewer.startMovement(Marzipano.autorotate({ yawSpeed: 0.035, targetPitch: 0, targetFov: fitFov(80) * DEG }));
        var go = $('start-explore'), tour = $('start-tour');
        go.disabled = false; go.textContent = 'Explore the school';
        tour.disabled = !tourOK;
        go.onclick = function () {
          var pv = params.get('yaw');
          welcomeOut();
          if (pv != null) state.viewer.view().setParameters({ yaw: +pv * DEG, pitch: mzPitch(+(params.get('pitch') || 0)), fov: fitFov(+(params.get('fov') || 80)) * DEG });
        };
        tour.onclick = startTour;
        if (miss.length) toast(miss.length + ' panorama image(s) missing — open the menu for details.', true);
        if (params.has('skip')) go.click();
        if (params.has('tour')) tour.click();
        if (DEV) {
          var s = document.createElement('script');
          s.src = 'js/editor.js';
          s.onload = function () { window.TourEditor.init(window.TourApp); go.click(); };
          document.body.appendChild(s);
        }
      });
    }).catch(fail);
  }

  window.TourApp = {
    state: state, goTo: goTo, toast: toast, sceneDef: sceneDef, getScene: getScene,
    rebuildHotspots: rebuildHotspots, buildMap: buildMap, buildMenu: buildMenu, showInfo: showInfo, hideInfo: hideInfo,
    linkVisible: linkVisible, currentView: currentView, findLink: findLink, DEG: DEG, checkAssets: checkAssets,
    setView: function (v) { state.viewer.view().setParameters({ yaw: v.yaw * DEG, pitch: mzPitch(v.pitch), fov: (v.fov || currentView().fov) * DEG }); },
    pick: function (clientX, clientY) {
      var r = $('pano').getBoundingClientRect();
      var c = state.viewer.view().screenToCoordinates({ x: clientX - r.left, y: clientY - r.top });
      return { yaw: c.yaw / DEG, pitch: cfgPitch(c.pitch) };
    }
  };

  init();
})();
