/* Developer hotspot editor — only loaded with ?edit=1. Entirely in the browser; no backend.
 * Edits a live copy of config/tour.json, autosaves a draft to localStorage, exports a JSON file.
 * Pitch is "up is positive" here and in the config.
 */
(function () {
  'use strict';

  var DRAFT_KEY = 'tourEditorDraft';
  var app, cfg, panel, sceneId = null, selId = null, mode = 'select', previewFrom = null, counter = 0;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var r1 = function (n) { return Math.round(n * 10) / 10; };
  var norm = function (y) { return ((y + 180) % 360 + 360) % 360 - 180; };

  function def() { return app.sceneDef(sceneId); }
  function hs(id) { return (def().hotspots || []).filter(function (h) { return h.id === id; })[0]; }
  function others() { return cfg.scenes.filter(function (s) { return s.id !== sceneId; }); }

  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(cfg)); } catch (e) { /* private mode etc. */ }
  }

  function changed(opts) {
    saveDraft();
    app.rebuildHotspots(sceneId);
    app.buildMap();
    renderList(); renderForm(); renderChecks();
    setTimeout(markSelected, 60);
    if (opts && opts.toast) app.toast(opts.toast);
  }

  function markSelected() {
    Array.prototype.forEach.call(document.querySelectorAll('.hs'), function (b) { b.classList.toggle('selected', b.dataset.id === selId); });
  }

  // ------------------------------------------------------------------ UI

  function build() {
    panel = document.createElement('aside');
    panel.id = 'editor';
    panel.innerHTML =
      '<h2>Hotspot editor <span class="tag">development only</span></h2>' +
      '<p class="tag" id="ed-draft"></p>' +
      '<h4>Scene</h4>' +
      '<label>Open panorama<select id="ed-scene"></select></label>' +
      '<div class="row"><button class="btn ghost" id="ed-startview">Set start view = camera</button></div>' +
      '<div class="grid2"><label>Map x<input id="ed-mapx" type="number" step="1"></label><label>Map y<input id="ed-mapy" type="number" step="1"></label></div>' +
      '<h4>Place hotspots</h4>' +
      '<div class="row" id="ed-modes"><button class="btn ghost on" data-mode="select">Select</button><button class="btn ghost" data-mode="link">+ Link</button><button class="btn ghost" data-mode="info">+ Info</button></div>' +
      '<p class="tag" id="ed-modehint"></p>' +
      '<div class="hslist" id="ed-list"></div>' +
      '<div id="ed-form"></div>' +
      '<h4>Checks</h4><div id="ed-checks"></div>' +
      '<h4>Export</h4>' +
      '<div class="row"><button class="btn" id="ed-download">Download tour.json</button><button class="btn ghost" id="ed-copy">Copy JSON</button></div>' +
      '<div class="row" style="margin-top:6px"><button class="btn ghost" id="ed-import">Import JSON…</button><button class="btn ghost" id="ed-discard">Discard draft</button></div>' +
      '<input type="file" id="ed-file" accept="application/json,.json" hidden>' +
      '<p class="tag">Replace <code>config/tour.json</code> with the downloaded file to publish your changes. Drafts are kept in this browser until discarded.</p>';
    document.body.appendChild(panel);

    var cross = document.createElement('div'); cross.id = 'cross'; document.body.appendChild(cross);
    var ro = document.createElement('div'); ro.id = 'readout'; document.body.appendChild(ro);
    setInterval(function () {
      var v = app.currentView();
      ro.textContent = 'yaw ' + r1(norm(v.yaw)) + '°  pitch ' + r1(v.pitch) + '°  fov ' + r1(v.fov) + '°';
    }, 100);

    var sel = $('ed-scene');
    sel.innerHTML = cfg.scenes.map(function (s) { return '<option value="' + s.id + '">' + esc(s.name + ' — ' + s.title) + '</option>'; }).join('');
    sel.onchange = function () { app.goTo(sel.value, { force: false }); };
    $('ed-startview').onclick = function () {
      var v = app.currentView();
      def().initialView = { yaw: r1(norm(v.yaw)), pitch: r1(v.pitch), fov: r1(v.fov) };
      saveDraft(); app.toast('Start view for ' + def().name + ' updated');
    };
    ['x', 'y'].forEach(function (k) {
      $('ed-map' + k).onchange = function () { def().map = def().map || { x: 50, y: 50 }; def().map[k] = +this.value; saveDraft(); app.buildMap(); };
    });
    Array.prototype.forEach.call($('ed-modes').querySelectorAll('button'), function (b) { b.onclick = function () { setMode(b.dataset.mode); }; });
    $('ed-download').onclick = download;
    $('ed-copy').onclick = function () {
      var t = JSON.stringify(cfg, null, 2);
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { app.toast('Config JSON copied'); }, function () { app.toast('Copy blocked by the browser — use Download instead', true); });
    };
    $('ed-import').onclick = function () { $('ed-file').click(); };
    $('ed-file').onchange = importFile;
    $('ed-discard').onclick = function () {
      if (!confirm('Discard the saved draft and reload the original config/tour.json?')) return;
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
      var u = new URL(location.href); u.searchParams.set('fresh', '1'); location.href = u.toString();
    };
    $('ed-draft').textContent = app.state.usingDraft ? 'Editing the saved draft from this browser (not config/tour.json).' : 'Editing config/tour.json. Changes autosave as a local draft.';
    setMode('select');
  }

  function setMode(m) {
    mode = m;
    Array.prototype.forEach.call($('ed-modes').querySelectorAll('button'), function (b) { b.classList.toggle('on', b.dataset.mode === m); });
    document.body.classList.toggle('editing-place', m !== 'select');
    $('ed-modehint').textContent = {
      select: 'Click a hotspot (in the view or the list) to edit it.',
      link: 'Click in the panorama where the new navigation arrow should go.',
      info: 'Click in the panorama where the new information point should go.',
      move: 'Click the new position for the selected hotspot.'
    }[m];
  }

  function renderList() {
    var el = $('ed-list');
    var list = def().hotspots || [];
    el.innerHTML = list.length ? '' : '<p class="tag">No hotspots in this scene yet.</p>';
    list.forEach(function (h) {
      var b = document.createElement('button');
      b.className = 'hsrow' + (h.id === selId ? ' sel' : '');
      b.innerHTML = '<span>' + (h.type === 'link' ? '→ ' : 'ⓘ ') + esc(h.label || h.id) + '</span><span class="tag">' + (h.type === 'link' ? esc(h.status) : 'info') + '</span>';
      b.onclick = function () { select(h.id); };
      el.appendChild(b);
    });
  }

  function field(label, id, val, attrs) { return '<label>' + label + '<input id="' + id + '" value="' + esc(val) + '" ' + (attrs || '') + '></label>'; }

  function renderForm() {
    var el = $('ed-form');
    var h = selId && hs(selId);
    if (!h) { el.innerHTML = ''; return; }
    var html = '<h4>' + (h.type === 'link' ? 'Link' : 'Info point') + ': ' + esc(h.id) + '</h4>' +
      field('Label (shown on hover)', 'f-label', h.label) +
      '<div class="grid2"><label>Yaw °<input id="f-yaw" type="number" step="0.1" value="' + r1(h.yaw) + '"></label><label>Pitch °<input id="f-pitch" type="number" step="0.1" value="' + r1(h.pitch) + '"></label><span></span></div>' +
      '<div class="row"><button class="btn ghost" id="f-move">Click to re-place</button><button class="btn ghost" id="f-cross">Move to crosshair</button><button class="btn ghost" id="f-look">Look at it</button></div>';
    if (h.type === 'link') {
      var e = h.entry || (h.entry = { yaw: 0, pitch: 0, fov: 78 });
      html += '<label>Destination<select id="f-target">' + others().map(function (s) { return '<option value="' + s.id + '"' + (s.id === h.target ? ' selected' : '') + '>' + esc(s.name + ' — ' + s.title) + '</option>'; }).join('') + '</select></label>' +
        '<div class="grid2"><label>Status<select id="f-status">' + ['confirmed', 'visual', 'unverified'].map(function (v) { return '<option' + (v === h.status ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></label>' +
        '<label>Placement<select id="f-place">' + ['exact', 'approximate'].map(function (v) { return '<option' + (v === h.placement ? ' selected' : '') + '>' + v + '</option>'; }).join('') + '</select></label><span></span></div>' +
        '<h4>Arrival view in destination</h4>' +
        '<div class="grid2"><label>Yaw °<input id="f-eyaw" type="number" step="0.1" value="' + r1(e.yaw) + '"></label><label>Pitch °<input id="f-epitch" type="number" step="0.1" value="' + r1(e.pitch) + '"></label><label>Fov °<input id="f-efov" type="number" step="1" value="' + r1(e.fov) + '"></label></div>' +
        '<div class="row"><button class="btn ghost" id="f-preview">Preview transition</button></div>' +
        '<p class="tag">To set the arrival view: press Preview, look in the direction a visitor should face on arrival, then press “Save current view as arrival view”.</p>' +
        '<label>Evidence / notes<textarea id="f-evidence">' + esc(h.evidence) + '</textarea></label>';
    } else {
      html += field('Title', 'f-title', h.title) + '<label>Text<textarea id="f-text">' + esc(h.text) + '</textarea></label>';
    }
    html += '<div class="row"><button class="btn ghost" id="f-delete" style="color:#ff9b9b">Delete hotspot</button></div>';
    el.innerHTML = html;

    var bind = function (id, fn) { var n = $(id); if (n) n.onchange = n.oninput = function () { fn(this.value); }; };
    bind('f-label', function (v) { h.label = v; commitSoft(); });
    bind('f-yaw', function (v) { h.yaw = norm(+v); commitSoft(); });
    bind('f-pitch', function (v) { h.pitch = Math.max(-90, Math.min(90, +v)); commitSoft(); });
    bind('f-target', function (v) { h.target = v; changed(); });
    bind('f-status', function (v) { h.status = v; changed(); });
    bind('f-place', function (v) { h.placement = v; changed(); });
    bind('f-eyaw', function (v) { h.entry.yaw = norm(+v); saveDraft(); });
    bind('f-epitch', function (v) { h.entry.pitch = +v; saveDraft(); });
    bind('f-efov', function (v) { h.entry.fov = +v; saveDraft(); });
    bind('f-evidence', function (v) { h.evidence = v; saveDraft(); });
    bind('f-title', function (v) { h.title = v; saveDraft(); });
    bind('f-text', function (v) { h.text = v; saveDraft(); });
    $('f-move').onclick = function () { setMode('move'); };
    $('f-cross').onclick = function () { var v = app.currentView(); h.yaw = r1(norm(v.yaw)); h.pitch = r1(v.pitch); changed(); };
    $('f-look').onclick = function () { app.setView({ yaw: h.yaw, pitch: h.pitch }); };
    $('f-delete').onclick = function () {
      def().hotspots = def().hotspots.filter(function (x) { return x.id !== h.id; });
      selId = null; changed({ toast: 'Hotspot deleted' });
    };
    if (h.type === 'link') {
      $('f-preview').onclick = function () {
        previewFrom = { scene: sceneId, hotspot: h.id };
        app.goTo(h.target, { via: h, entry: h.entry, preview: previewFrom });
      };
    }
  }

  // Edits that move/relabel a hotspot: rebuild the scene's hotspots but keep the form focused.
  var softTimer;
  function commitSoft() {
    saveDraft();
    clearTimeout(softTimer);
    softTimer = setTimeout(function () { app.rebuildHotspots(sceneId); renderList(); renderChecks(); setTimeout(markSelected, 60); }, 120);
  }

  function select(id) {
    selId = id;
    setMode('select');
    renderList(); renderForm(); markSelected();
    var h = hs(id);
    if (h) app.setView({ yaw: h.yaw, pitch: h.pitch });
  }

  // --------------------------------------------------------------- placing

  function onPanoClick(e) {
    if (mode === 'select') return;
    var p = app.pick(e.clientX, e.clientY);
    var pos = { yaw: r1(norm(p.yaw)), pitch: r1(p.pitch) };
    if (mode === 'move') {
      var h = selId && hs(selId);
      if (h) { h.yaw = pos.yaw; h.pitch = pos.pitch; setMode('select'); changed({ toast: 'Hotspot moved' }); }
      return;
    }
    var n = ++counter, id;
    do { id = sceneId + '-' + mode + '-' + (n++); } while (hs(id));
    var nh = mode === 'link'
      ? { id: id, type: 'link', yaw: pos.yaw, pitch: pos.pitch, label: 'New link', target: others()[0].id, status: 'unverified', placement: 'exact', entry: { yaw: 0, pitch: 0, fov: 78 }, evidence: '' }
      : { id: id, type: 'info', yaw: pos.yaw, pitch: pos.pitch, label: 'New info point', title: 'New info point', text: '' };
    (def().hotspots = def().hotspots || []).push(nh);
    selId = id;
    setMode('select');
    changed({ toast: (nh.type === 'link' ? 'Link' : 'Info point') + ' placed at yaw ' + pos.yaw + '°, pitch ' + pos.pitch + '°' });
  }

  // ---------------------------------------------------------------- checks

  function renderChecks() {
    var issues = [];
    var links = [];
    cfg.scenes.forEach(function (s) { (s.hotspots || []).forEach(function (h) { if (h.type === 'link') links.push({ from: s.id, h: h }); }); });
    links.forEach(function (l) {
      var tgt = app.sceneDef(l.h.target);
      if (!tgt) { issues.push(l.from + ': link “' + l.h.label + '” points to missing scene ' + l.h.target); return; }
      if (l.h.target === l.from) issues.push(l.from + ': link “' + l.h.label + '” points to itself');
      if (!links.some(function (m) { return m.from === l.h.target && m.h.target === l.from; })) issues.push(l.from + ' → ' + l.h.target + ' has no return link');
      if (l.h.status === 'unverified') issues.push(l.from + ' → ' + l.h.target + ' is unverified (hidden from visitors)');
      else if (l.h.status === 'visual') issues.push(l.from + ' → ' + l.h.target + ' is visually supported but not confirmed on site');
      if (l.h.placement === 'approximate') issues.push(l.from + ' → ' + l.h.target + ' position is approximate');
    });
    cfg.scenes.forEach(function (s) {
      if (!links.some(function (l) { return (l.from === s.id || l.h.target === s.id) && l.h.status !== 'unverified'; })) issues.push(s.id + ' has no walkable link (menu access only)');
      var a = app.state.assets[s.id];
      if (a && !a.usable) issues.push(s.id + ': panorama image missing (' + s.file + ')');
    });
    $('ed-checks').innerHTML = issues.length
      ? '<ul class="issues">' + issues.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'
      : '<p class="ok">No issues found.</p>';
  }

  // ------------------------------------------------------------ import/export

  function download() {
    var blob = new Blob([JSON.stringify(cfg, null, 2) + '\n'], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tour.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    app.toast('Exported tour.json');
  }

  function importFile() {
    var f = this.files && this.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (!d || !Array.isArray(d.scenes) || !d.scenes.length) throw new Error('no scenes array');
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
        location.reload();
      } catch (e) { app.toast('Import failed: ' + e.message, true); }
    };
    rd.readAsText(f);
  }

  // ------------------------------------------------------------------ API

  window.TourEditor = {
    init: function (App) {
      app = App; cfg = app.state.config;
      document.body.classList.add('dev');
      build();
      sceneId = app.state.current;
      $('ed-scene').value = sceneId;
      this.onSceneChange(sceneId);
      var down = null;
      $('pano').addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
      $('pano').addEventListener('pointerup', function (e) {
        if (down && Math.abs(e.clientX - down.x) < 6 && Math.abs(e.clientY - down.y) < 6 && Date.now() - down.t < 600) onPanoClick(e);
        down = null;
      });
      app.buildMap();
      app.rebuildHotspots(sceneId);
      renderChecks();
    },
    onSceneChange: function (id) {
      sceneId = id;
      if (!panel) return;
      $('ed-scene').value = id;
      var d = def();
      d.map = d.map || { x: 50, y: 50 };
      $('ed-mapx').value = d.map.x; $('ed-mapy').value = d.map.y;
      // Keep a selected link selected when the user hops to its destination to capture an arrival view.
      if (selId && !hs(selId) && !(previewFrom)) selId = null;
      renderList();
      if (!selId || hs(selId)) renderForm();
      setTimeout(markSelected, 80);
    },
    onHotspotClick: function (scene, h) { if (scene === sceneId) { select(h.id); return true; } return false; },
    afterPreview: function (ctx) {
      var el = $('ed-form');
      var bar = document.createElement('div');
      bar.innerHTML = '<p class="ok">Preview finished — you are now in ' + esc(app.sceneDef(app.state.current).name) + '.</p>' +
        '<div class="row"><button class="btn" id="f-savearr">Save current view as arrival view</button><button class="btn ghost" id="f-back">Return to ' + esc(app.sceneDef(ctx.scene).name) + '</button></div>';
      el.prepend(bar);
      $('f-savearr').onclick = function () {
        var src = (app.sceneDef(ctx.scene).hotspots || []).filter(function (x) { return x.id === ctx.hotspot; })[0];
        if (!src) return;
        var v = app.currentView();
        src.entry = { yaw: r1(norm(v.yaw)), pitch: r1(v.pitch), fov: r1(v.fov) };
        saveDraft(); app.toast('Arrival view saved: yaw ' + src.entry.yaw + '°, pitch ' + src.entry.pitch + '°');
      };
      $('f-back').onclick = function () { previewFrom = null; app.goTo(ctx.scene, {}); };
    }
  };
})();
