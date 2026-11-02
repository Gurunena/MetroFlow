// explore.js – front-end logic for the Explore page
// ---------------------------------------------------------------------------
// Namespace: MetroFlowExplore. No globals beyond window.MetroFlowExplore.
//
// Every destination comes from /api/destinations (MongoDB). There is no local
// fallback data on purpose: if the API cannot be reached the page shows an
// error state with a Retry button rather than inventing places that do not
// exist in the database.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API = '/api/destinations';

  var CATEGORIES = [
    { name: 'All', icon: 'bi-compass' },
    { name: 'Culture', icon: 'bi-bank' },
    { name: 'Beach', icon: 'bi-umbrella' },
    { name: 'Nature', icon: 'bi-tree' },
    { name: 'Hill Country', icon: 'bi-triangle' },
    { name: 'City', icon: 'bi-buildings' },
    { name: 'Wildlife', icon: 'bi-binoculars' }
  ];

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ============================== helpers =============================== */

  // Everything from the API is escaped before it reaches innerHTML.
  function esc(value) {
    return $('<div>').text(value == null ? '' : String(value)).html();
  }

  function money(value) {
    var n = Number(value) || 0;
    return 'LKR ' + n.toLocaleString('en-LK', { maximumFractionDigits: 0 });
  }

  function stars(rating) {
    var r = Math.max(0, Math.min(5, Number(rating) || 0));
    var full = Math.floor(r);
    var half = r - full >= 0.5;
    var out = '';
    for (var i = 0; i < 5; i++) {
      if (i < full) { out += '<i class="bi bi-star-fill" aria-hidden="true"></i>'; }
      else if (i === full && half) { out += '<i class="bi bi-star-half" aria-hidden="true"></i>'; }
      else { out += '<i class="bi bi-star" aria-hidden="true"></i>'; }
    }
    return out;
  }

  function searchUrl(name) {
    return 'search.html?to=' + encodeURIComponent(name);
  }

  var FALLBACK_IMG = 'images/placeholder.svg';
  function imgAttrs(url, alt) {
    return 'src="' + esc(url) + '" alt="' + esc(alt) + '" loading="lazy"' +
      ' onerror="this.onerror=null;this.src=\'' + FALLBACK_IMG + '\'"';
  }

  /* =============================== state ================================ */

  var state = {
    category: 'All',
    search: '',
    popular: false,
    sort: 'rating',
    vibe: null
  };

  var all = [];          // every destination, for chip counts and the map
  var shown = [];        // what is currently rendered
  var busCache = {};     // slug -> summary, so cards are not refetched

  /* ================================ ajax ================================ */

  // jQuery Use #1 – $.ajax / $.getJSON calls to /api/destinations...
  function fetchDestinations(params) {
    return $.ajax({
      url: API,
      method: 'GET',
      dataType: 'json',
      data: params || {},
      timeout: 12000
    });
  }

  function fetchBuses(slug) {
    if (busCache[slug]) { return $.Deferred().resolve(busCache[slug]).promise(); }
    return $.getJSON(API + '/' + encodeURIComponent(slug) + '/buses')
      .then(function (res) {
        busCache[slug] = res;
        return res;
      });
  }

  function errorMessage(xhr) {
    if (!xhr || xhr.status === 0) { return 'Could not reach the server.'; }
    if (xhr.responseJSON && xhr.responseJSON.message) { return xhr.responseJSON.message; }
    if (xhr.status === 503) { return 'The database is unavailable right now.'; }
    return 'The server returned an error (' + xhr.status + ').';
  }

  /* ============================== rendering ============================= */

  function skeletons(n) {
    var one =
      '<div class="col-md-6 col-lg-4">' +
        '<div class="mf-ex-skel">' +
          '<div class="mf-ex-skel-media mf-ex-shimmer"></div>' +
          '<div class="p-3">' +
            '<div class="mf-ex-shimmer mb-2" style="height:18px;width:60%;border-radius:6px"></div>' +
            '<div class="mf-ex-shimmer mb-2" style="height:13px;border-radius:6px"></div>' +
            '<div class="mf-ex-shimmer" style="height:13px;width:75%;border-radius:6px"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    var html = '';
    for (var i = 0; i < n; i++) { html += one; }
    return html;
  }

  function cardHtml(d) {
    return '' +
      '<div class="col-md-6 col-lg-4">' +
        '<article class="mf-ex-card" data-slug="' + esc(d.Slug) + '">' +
          '<div class="mf-ex-card-media">' +
            '<img ' + imgAttrs(d.Image_URL, d.Name + ' – ' + d.Tagline) + '>' +
            '<span class="mf-ex-badge">' + esc(d.Category) + '</span>' +
            '<span class="mf-ex-fav"><i class="bi bi-star-fill" aria-hidden="true"></i> ' + esc(d.Rating) + '</span>' +
            '<button class="mf-ex-peek" type="button" data-open="' + esc(d.Slug) + '">Explore <i class="bi bi-arrow-right" aria-hidden="true"></i></button>' +
            '<div class="mf-ex-card-caption">' +
              '<div class="mf-ex-card-name">' + esc(d.Name) + '</div>' +
              '<div class="mf-ex-card-prov">' + esc(d.Province) + ' Province</div>' +
            '</div>' +
          '</div>' +
          '<div class="mf-ex-card-body">' +
            '<p class="mf-ex-card-tag">' + esc(d.Tagline) + '</p>' +
            '<div class="mf-ex-card-foot">' +
              '<span class="mf-ex-from" data-fare="' + esc(d.Slug) + '">' +
                '<small>From</small><span class="mf-ex-shimmer d-inline-block" style="width:62px;height:14px;border-radius:5px"></span>' +
              '</span>' +
              '<span class="mf-ex-seats" data-seats="' + esc(d.Slug) + '">checking…</span>' +
            '</div>' +
            '<div class="mf-ex-card-actions">' +
              '<button class="mf-ex-btn" type="button" data-open="' + esc(d.Slug) + '">Quick view</button>' +
              '<a class="mf-ex-btn mf-ex-btn-primary" href="' + esc(searchUrl(d.Name)) + '">Find buses</a>' +
            '</div>' +
          '</div>' +
        '</article>' +
      '</div>';
  }

  // jQuery Use #5 – dynamic DOM templating with .empty()/.append()/.html()
  function renderGrid(list) {
    var $grid = $('#exGrid');
    $grid.attr('aria-busy', 'false').empty();

    if (!list.length) {
      $grid.append(
        '<div class="col-12"><div class="mf-ex-state">' +
          '<i class="bi bi-compass" aria-hidden="true"></i>' +
          '<h3>Nothing matches those filters</h3>' +
          '<p>Try a different category, or clear the search.</p>' +
          '<button class="btn mf-btn-red btn-sm" type="button" id="exReset">Reset filters</button>' +
        '</div></div>'
      );
      return;
    }

    $.each(list, function (i, d) { $grid.append(cardHtml(d)); });

    // jQuery Use #4 – fade the fresh cards in
    if (!reduceMotion) {
      $grid.children().css('opacity', 0).each(function (i) {
        $(this).delay(i * 45).animate({ opacity: 1 }, 260);
      });
    }

    observeReveals();
    list.forEach(function (d) { paintCardFooter(d.Slug); });
  }

  // Fill in "From LKR x" / "x seats left" from the per-destination endpoint.
  function paintCardFooter(slug) {
    fetchBuses(slug)
      .done(function (res) {
        var s = (res && res.summary) || {};
        var $fare = $('[data-fare="' + slug + '"]');
        var $seats = $('[data-seats="' + slug + '"]');

        if (s.cheapestFare === null || s.cheapestFare === undefined) {
          $fare.html('<small>Fare</small>—');
          $seats.addClass('is-none').text('no direct bus yet');
          return;
        }
        $fare.html('<small>From</small>' + esc(money(s.cheapestFare)));
        $seats.removeClass('is-none').text(s.seatsLeft + ' seat' + (s.seatsLeft === 1 ? '' : 's') + ' left');
      })
      .fail(function () {
        $('[data-fare="' + slug + '"]').html('<small>Fare</small>—');
        $('[data-seats="' + slug + '"]').addClass('is-none').text('unavailable');
      });
  }

  function renderError(xhr) {
    $('#exGrid').attr('aria-busy', 'false').empty().append(
      '<div class="col-12"><div class="mf-ex-state">' +
        '<i class="bi bi-wifi-off" aria-hidden="true"></i>' +
        '<h3>Could not load destinations</h3>' +
        '<p>' + esc(errorMessage(xhr)) + '</p>' +
        '<button class="btn mf-btn-red btn-sm" type="button" id="exRetry">' +
          '<i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Retry</button>' +
      '</div></div>'
    );
    $('#exCount').text('');
  }

  /* ============================== the chips ============================= */

  function renderChips() {
    var counts = { All: all.length };
    $.each(all, function (i, d) { counts[d.Category] = (counts[d.Category] || 0) + 1; });

    var $chips = $('#exChips').empty();
    $.each(CATEGORIES, function (i, cat) {
      var n = counts[cat.name] || 0;
      $chips.append(
        '<button class="mf-ex-chip" type="button" data-cat="' + esc(cat.name) + '"' +
        ' aria-pressed="' + (state.category === cat.name ? 'true' : 'false') + '">' +
          '<i class="bi ' + cat.icon + '" aria-hidden="true"></i> ' + esc(cat.name) +
          '<span class="mf-ex-chip-count">' + n + '</span>' +
        '</button>'
      );
    });
  }

  function syncChipState() {
    $('#exChips .mf-ex-chip').each(function () {
      $(this).attr('aria-pressed', $(this).data('cat') === state.category ? 'true' : 'false');
    });
    $('#exPopular').attr('aria-pressed', state.popular ? 'true' : 'false');
    $('#exSort').val(state.sort);
    $('#exVibes .mf-ex-vibe').each(function () {
      $(this).attr('aria-pressed', $(this).data('vibe') === state.vibe ? 'true' : 'false');
    });
  }

  /* ============================== the map =============================== */
  // Real Leaflet map. Markers sit at each destination's actual Lat/Lng, so
  // nothing on this page is an approximate projection any more.

  var map = null;
  var markers = {};          // slug -> L.Marker
  var busMarker = null;
  var busRaf = null;
  var scrollZoomOn = false;

  var HUBS = ['colombo', 'kandy', 'galle', 'jaffna'];   // always labelled
  var LABEL_ZOOM = 9;                                   // others label from here

  var CAT_ICON = {
    'Culture': 'bi-bank', 'Beach': 'bi-umbrella', 'Nature': 'bi-tree',
    'Hill Country': 'bi-triangle', 'City': 'bi-buildings', 'Wildlife': 'bi-binoculars'
  };

  // Main corridors, drawn from real coordinates.
  var CORRIDORS = [
    [[6.9271, 79.8612], [7.2906, 80.6337]],                       // Colombo-Kandy
    [[6.9271, 79.8612], [6.0535, 80.2210], [5.9549, 80.5550]],    // Colombo-Galle-Matara
    [[6.9271, 79.8612], [8.3114, 80.4037], [9.6615, 80.0255]]     // Colombo-Anuradhapura-Jaffna
  ];

  function markerHtml(d, dim) {
    return '<span class="mf-ex-marker' + (dim ? ' is-dim' : '') + '">' +
      '<i class="bi ' + (CAT_ICON[d.Category] || 'bi-geo-alt-fill') + '" aria-hidden="true"></i></span>';
  }

  function initMap() {
    // Leaflet blocked or failed to parse: go straight to the list.
    if (typeof window.L === 'undefined') {
      mapFallback('Map unavailable, showing list');
      return;
    }

    var L = window.L;
    map = L.map('exLeaflet', {
      center: [7.8731, 80.7718],
      zoom: 7,
      minZoom: 7,
      maxZoom: 12,
      maxBounds: [[5.6, 79.3], [10.1, 82.2]],
      maxBoundsViscosity: 1.0,
      scrollWheelZoom: false,          // enabled on first click, see below
      zoomControl: true,
      attributionControl: true
    });

    // Standard OpenStreetMap tiles: free and keyless. CARTO's Voyager style
    // would suit the palette better, but it now answers HTTP 200 with an
    // "API KEY REQUIRED" watermark instead of map imagery, which no
    // tileerror handler can detect.
    var tiles = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        subdomains: 'abc',
        maxZoom: 12,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }
    );

    // A stray failed tile at the edges is normal; failing before anything has
    // loaded means the host is unreachable, so show the list instead.
    var tilesLoaded = false;
    tiles.on('load', function () { tilesLoaded = true; });
    tiles.on('tileerror', function () {
      if (!tilesLoaded) { mapFallback('Map unavailable, showing list'); }
    });
    tiles.addTo(map);

    // Never trap the page scroll: wheel zoom only after a deliberate click.
    map.on('click', function () {
      if (scrollZoomOn) { return; }
      map.scrollWheelZoom.enable();
      scrollZoomOn = true;
      $('#exMapHint').addClass('is-off');
    });

    map.on('zoomend', syncLabels);
    map.on('move', hideTip);

    drawCorridors();
  }

  function drawCorridors() {
    if (!map) { return; }
    var L = window.L;
    $.each(CORRIDORS, function (i, line) {
      L.polyline(line, {
        color: '#D80F1E',
        weight: 3,
        opacity: 0.75,
        dashArray: '6 8',
        interactive: false
      }).addTo(map);
    });
    startBus();
  }

  /* ---------------------- the bus that rides the line ------------------- */

  function startBus() {
    if (!map || reduceMotion) { return; }
    var L = window.L;
    var path = CORRIDORS[0];     // Colombo -> Kandy

    busMarker = L.marker(path[0], {
      icon: L.divIcon({
        className: '',
        html: '<span class="mf-ex-busicon" aria-hidden="true">\ud83d\ude8c</span>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      }),
      interactive: false,
      keyboard: false
    }).addTo(map);

    var DURATION = 9000;         // one leg, then loop
    var started = null;

    function frame(now) {
      if (!busMarker || !map) { return; }
      if (started === null) { started = now; }
      var t = ((now - started) % DURATION) / DURATION;
      var lat = path[0][0] + (path[1][0] - path[0][0]) * t;
      var lng = path[0][1] + (path[1][1] - path[0][1]) * t;
      busMarker.setLatLng([lat, lng]);
      busRaf = window.requestAnimationFrame(frame);
    }
    busRaf = window.requestAnimationFrame(frame);
  }

  /* ------------------------------ markers ------------------------------- */

  function labelMarker(m) {
    var el = m.getElement();
    if (!el) { return; }
    var d = m.destination;
    el.setAttribute('aria-label', d.Name + ' \u2014 ' + d.Category + ', ' + d.Province + ' Province');
    el.setAttribute('role', 'button');
  }

  function renderMarkers() {
    if (!map) { return; }
    var L = window.L;

    $.each(markers, function (slug, m) { map.removeLayer(m); });
    markers = {};

    $.each(all, function (i, d) {
      var m = L.marker([d.Lat, d.Lng], {
        icon: L.divIcon({
          className: '',
          html: markerHtml(d, false),
          iconSize: [30, 30],
          iconAnchor: [15, 30]
        }),
        keyboard: true,
        // Mirissa/Matara and Kandy/Nuwara Eliya sit ~8px apart at zoom 7, so
        // let the hovered pin rise above its neighbour. Leaflet built-in, no
        // clustering library needed.
        riseOnHover: true,
        riseOffset: 400,
        title: d.Name,
        alt: d.Name
      });

      m.destination = d;
      m.addTo(map);

      // Permanent name label: hubs always, the rest from LABEL_ZOOM up.
      m.bindTooltip(esc(d.Name), {
        permanent: true,
        direction: 'right',
        offset: [12, -14],
        className: 'mf-ex-label'
      });

      m.on('mouseover focus', function () { showTip(m); });
      m.on('mouseout blur', hideTip);
      m.on('click', function () {
        openDetail(d.Slug, m.getElement());
        hideTip();
      });
      m.on('keypress', function (e) {
        var key = e.originalEvent && e.originalEvent.key;
        if (key === 'Enter' || key === ' ') { openDetail(d.Slug, m.getElement()); }
      });

      // Leaflet builds a fresh icon element every time the marker is added,
      // so the accessible name has to be re-applied on each add, not just once.
      m.on('add', function () { labelMarker(m); });
      labelMarker(m);

      markers[d.Slug] = m;
    });

    syncLabels();
    dimMarkers();
  }

  function syncLabels() {
    if (!map) { return; }
    var z = map.getZoom();
    $.each(markers, function (slug, m) {
      var tip = m.getTooltip();
      if (!tip) { return; }
      var el = tip.getElement();
      if (el) { $(el).toggle(HUBS.indexOf(slug) > -1 || z >= LABEL_ZOOM); }
    });
  }

  /* -------------------- category filter <-> map sync -------------------- */

  function dimMarkers() {
    if (!map) { return; }
    var visible = [];

    $.each(markers, function (slug, m) {
      var match = state.category === 'All' || m.destination.Category === state.category;
      var el = m.getElement();
      if (el) { $(el).find('.mf-ex-marker').toggleClass('is-dim', !match); }
      if (match) { visible.push([m.destination.Lat, m.destination.Lng]); }

      // With a category selected, non-matching pins are removed, not just dimmed.
      if (state.category === 'All' || match) {
        if (!map.hasLayer(m)) { m.addTo(map); }
      } else if (map.hasLayer(m)) {
        map.removeLayer(m);
      }
    });

    syncLabels();

    if (state.category !== 'All' && visible.length) {
      map.flyToBounds(window.L.latLngBounds(visible).pad(0.35), { duration: 0.8, maxZoom: 10 });
    }
  }

  function resetMapView() {
    if (!map) { return; }
    map.flyTo([7.8731, 80.7718], 7, { duration: 0.8 });
  }

  // Grid card -> fly the map to that pin and bounce it.
  function flyToDestination(slug) {
    var m = markers[slug];
    if (!map || !m) { return; }
    if (!map.hasLayer(m)) { m.addTo(map); }
    map.flyTo(m.getLatLng(), 10, { duration: 1 });
    window.setTimeout(function () {
      var $pin = $(m.getElement()).find('.mf-ex-marker');
      $pin.removeClass('is-bounce');
      // reflow so the animation restarts even on a repeat click
      if ($pin.length) { void $pin[0].offsetWidth; }
      $pin.addClass('is-bounce');
    }, 1000);
  }

  /* ---------------------------- hover card ------------------------------ */

  function showTip(m) {
    if (!map) { return; }
    var d = m.destination;
    // Container points are relative to #exLeaflet, but the tip lives in the
    // padded wrapper, so shift by the map element's offset inside it.
    var pt = map.latLngToContainerPoint(m.getLatLng());
    var mapEl = document.getElementById('exLeaflet');
    pt = { x: pt.x + mapEl.offsetLeft, y: pt.y + mapEl.offsetTop };
    $('#exTip')
      .html('<div class="mf-ex-tip-name">' + esc(d.Name) + '</div>' +
            '<div class="mf-ex-tip-meta">' + esc(d.Category) + ' \u00b7 ' + esc(d.Province) + ' Province</div>' +
            '<div class="mf-ex-tip-stars">' + stars(d.Rating) +
            ' <span class="mf-ex-tip-meta">' + esc(d.Rating) + '</span></div>')
      .css({ left: pt.x + 'px', top: pt.y + 'px' })
      .removeAttr('hidden');
  }

  function hideTip() { $('#exTip').attr('hidden', true); }

  /* ---------------------------- list fallback --------------------------- */

  var fallbackNotice = null;    // set while the list fallback is on screen

  function mapFallback(notice) {
    fallbackNotice = notice;
    if (busRaf) { window.cancelAnimationFrame(busRaf); busRaf = null; }
    busMarker = null;
    if (map) { map.remove(); map = null; }

    $('#exLeaflet').attr('hidden', true);
    $('#exMapHint').attr('hidden', true);
    $('#exMapReset').attr('hidden', true);

    var $list = $('#exMapList').removeAttr('hidden').empty();
    $list.append('<div class="mf-ex-map-notice"><i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>' +
      esc(notice) + '</div>');

    if (!all.length) {
      $list.append('<p class="small mf-muted mb-0">Destinations will appear here once they load.</p>');
      return;
    }
    $.each(all, function (i, d) {
      $list.append(
        '<button class="mf-ex-map-item" type="button" data-open="' + esc(d.Slug) + '">' +
          '<i class="bi ' + (CAT_ICON[d.Category] || 'bi-geo-alt-fill') + '" aria-hidden="true"></i>' +
          '<span><span class="mf-ex-map-item-name">' + esc(d.Name) + '</span>' +
          '<span class="mf-ex-map-item-meta d-block">' + esc(d.Category) + ' \u00b7 ' + esc(d.Province) +
          ' \u00b7 ' + esc(Number(d.Lat).toFixed(4)) + ', ' + esc(Number(d.Lng).toFixed(4)) + '</span></span>' +
        '</button>'
      );
    });
  }

  /* ============================== the modal ============================= */

  var modal = null;
  var lastTrigger = null;

  function openDetail(slug, trigger) {
    lastTrigger = trigger || null;

    var $hero = $('#exModalHero');
    var $body = $('#exModalBody');
    $hero.find('.carousel').remove();
    $body.html('<div class="mf-ex-shimmer" style="height:22px;width:45%;border-radius:6px"></div>' +
      '<div class="mf-ex-shimmer mt-3" style="height:13px;border-radius:6px"></div>' +
      '<div class="mf-ex-shimmer mt-2" style="height:13px;width:80%;border-radius:6px"></div>');

    if (!modal) { modal = new window.bootstrap.Modal(document.getElementById('exModal')); }
    modal.show();

    $.getJSON(API + '/' + encodeURIComponent(slug))
      .done(function (res) { paintDetail(res.data); })
      .fail(function (xhr) {
        $body.html('<div class="mf-ex-state"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i>' +
          '<h3>Could not load this destination</h3><p>' + esc(errorMessage(xhr)) + '</p></div>');
      });
  }

  function paintDetail(d) {
    // ---- gallery carousel ----
    var images = (d.Gallery && d.Gallery.length ? d.Gallery : [d.Image_URL]);
    var slides = '';
    $.each(images, function (i, url) {
      slides += '<div class="carousel-item' + (i === 0 ? ' active' : '') + '">' +
        '<img ' + imgAttrs(url, d.Name + ' photo ' + (i + 1)) + '></div>';
    });

    var carousel =
      '<div id="exGallery" class="carousel slide" data-bs-ride="false">' +
        '<div class="carousel-inner">' + slides + '</div>' +
        (images.length > 1
          ? '<button class="carousel-control-prev" type="button" data-bs-target="#exGallery" data-bs-slide="prev">' +
              '<span class="carousel-control-prev-icon" aria-hidden="true"></span>' +
              '<span class="visually-hidden">Previous photo</span></button>' +
            '<button class="carousel-control-next" type="button" data-bs-target="#exGallery" data-bs-slide="next">' +
              '<span class="carousel-control-next-icon" aria-hidden="true"></span>' +
              '<span class="visually-hidden">Next photo</span></button>'
          : '') +
      '</div>';
    $('#exModalHero').prepend(carousel);

    // ---- body ----
    var highlights = '';
    $.each(d.Highlights || [], function (i, h) {
      highlights += '<li><i class="bi bi-check-circle-fill" aria-hidden="true"></i><span>' + esc(h) + '</span></li>';
    });

    $('#exModalBody').html(
      '<div class="d-flex flex-wrap align-items-start justify-content-between gap-2">' +
        '<div>' +
          '<h2 class="h4 mb-1" id="exModalTitle">' + esc(d.Name) + '</h2>' +
          '<div class="small mf-muted">' + esc(d.Category) + ' · ' + esc(d.Province) + ' Province</div>' +
        '</div>' +
        '<div class="text-end"><div class="mf-text-red">' + stars(d.Rating) + '</div>' +
          '<div class="small mf-muted">' + esc(d.Rating) + ' / 5</div></div>' +
      '</div>' +
      '<p class="mt-3">' + esc(d.Description) + '</p>' +
      '<div class="row g-3 mt-1">' +
        '<div class="col-sm-6">' +
          '<div class="mf-eyebrow">Best season</div>' +
          '<div class="fw-bold mt-1">' + esc(d.Best_Season) + '</div>' +
        '</div>' +
        '<div class="col-sm-6">' +
          '<div class="mf-eyebrow">Highlights</div>' +
          '<ul class="mf-ex-hl mt-1">' + highlights + '</ul>' +
        '</div>' +
      '</div>' +
      '<div class="mt-4">' +
        '<div class="mf-eyebrow">Next buses</div>' +
        '<div class="d-grid gap-2 mt-2" id="exModalBuses">' +
          '<div class="mf-ex-shimmer" style="height:44px;border-radius:12px"></div>' +
        '</div>' +
      '</div>' +
      '<div class="d-grid gap-2 mt-4">' +
        '<a class="btn mf-btn-red" href="' + esc(searchUrl(d.Name)) + '">' +
          'Book now <i class="bi bi-arrow-right" aria-hidden="true"></i></a>' +
      '</div>'
    );

    // Prefill the trip planner's "To" with whatever was opened.
    $('#exTo').val(d.Name);

    // ---- next buses (top 3) ----
    fetchBuses(d.Slug)
      .done(function (res) {
        var $list = $('#exModalBuses').empty();
        var buses = (res && res.data) || [];
        if (!buses.length) {
          $list.append('<p class="small mf-muted mb-0">No direct MetroFlow service to ' +
            esc(d.Name) + ' yet — try the full search for connections.</p>');
          return;
        }
        $.each(buses.slice(0, 3), function (i, b) {
          $list.append(
            '<div class="mf-ex-bus">' +
              '<div>' +
                '<div class="mf-ex-bus-main">' + esc(b.Departure) + ' → ' + esc(b.Destination) + '</div>' +
                '<div class="mf-ex-bus-meta">' + esc(b.Travel_Date) + ' · ' + esc(b.Departure_Time) +
                  '–' + esc(b.Arrival_Time) + ' · ' + esc(b.Available_Seats) + ' seats</div>' +
              '</div>' +
              '<div class="mf-ex-bus-fare">' + esc(money(b.Fare)) + '</div>' +
            '</div>'
          );
        });
      })
      .fail(function () {
        $('#exModalBuses').html('<p class="small mf-muted mb-0">Could not load live buses.</p>');
      });
  }

  /* ============================== URL sync ============================== */

  function writeUrl() {
    var parts = [];
    if (state.category !== 'All') { parts.push('category=' + encodeURIComponent(state.category)); }
    if (state.search) { parts.push('q=' + encodeURIComponent(state.search)); }
    if (state.popular) { parts.push('popular=true'); }
    if (state.sort !== 'rating') { parts.push('sort=' + state.sort); }
    var query = parts.length ? '?' + parts.join('&') : window.location.pathname;
    try {
      window.history.replaceState(null, '', parts.length ? query : window.location.pathname);
    } catch (err) {
      // Some embedded/file contexts refuse replaceState – filtering still works.
    }
  }

  function readUrl() {
    var q = window.location.search;
    var get = function (key) {
      var m = new RegExp('[?&]' + key + '=([^&]*)').exec(q);
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
    };
    var cat = get('category');
    if (cat && CATEGORIES.some(function (c) { return c.name === cat; })) { state.category = cat; }
    var search = get('q');
    if (search) { state.search = search; $('#exSearch').val(search); }
    if (get('popular') === 'true') { state.popular = true; }
    var sort = get('sort');
    if (sort === 'name' || sort === 'rating') { state.sort = sort; }
  }

  /* ============================== loading =============================== */

  function load(showSkeletons) {
    if (showSkeletons !== false) {
      $('#exGrid').attr('aria-busy', 'true').html(skeletons(6));
    }

    var params = { sort: state.sort };
    if (state.category !== 'All') { params.category = state.category; }
    if (state.search) { params.search = state.search; }
    if (state.popular) { params.popular = 'true'; }

    return fetchDestinations(params)
      .done(function (res) {
        shown = res.data || [];

        // A "vibe" maps to several categories, so it is applied client-side
        // over the API result rather than as another query parameter.
        if (state.vibe) {
          var cats = ($('#exVibes [data-vibe="' + state.vibe + '"]').data('cats') || '').split(',');
          shown = shown.filter(function (d) { return cats.indexOf(d.Category) > -1; });
        }

        renderGrid(shown);
        $('#exCount').text(shown.length + ' destination' + (shown.length === 1 ? '' : 's') +
          (state.category !== 'All' ? ' in ' + state.category : ''));
        writeUrl();
        dimMarkers();
      })
      .fail(renderError);
  }

  // The full list is fetched once for chip counts, map pins and Surprise me.
  function loadAll() {
    return fetchDestinations({})
      .done(function (res) {
        all = res.data || [];
        renderChips();
        renderMarkers();
        syncChipState();
        paintStats();
        // Tiles can fail before the API responds, which would otherwise leave
        // an empty fallback list behind.
        if (fallbackNotice) { mapFallback(fallbackNotice); }
      });
  }

  /* =============================== stats ================================ */

  function countUp($el, target, suffix) {
    if (reduceMotion) { $el.text(target + (suffix || '')); return; }
    // jQuery Use #4 – .animate() drives the counters
    $({ n: 0 }).animate({ n: target }, {
      duration: 1100,
      easing: 'swing',
      step: function () { $el.text(Math.round(this.n) + (suffix || '')); },
      complete: function () { $el.text(target + (suffix || '')); }
    });
  }

  function paintStats() {
    var provinces = {};
    $.each(all, function (i, d) { provinces[d.Province] = true; });

    var $band = $('#exStats');
    if (!$band.length || $band.data('counted')) { return; }

    function run() {
      if ($band.data('counted')) { return; }
      $band.data('counted', true);
      countUp($('#exStatDest'), all.length);
      countUp($('#exStatProv'), Object.keys(provinces).length);
      // Daily buses: sum of services across destinations, filled in as the
      // per-destination summaries arrive.
      $.when.apply($, all.map(function (d) { return fetchBuses(d.Slug); }))
        .always(function () {
          var total = 0;
          $.each(busCache, function (slug, res) { total += (res.summary && res.summary.services) || 0; });
          countUp($('#exStatBuses'), total, '+');
        });
    }

    if (!window.IntersectionObserver) { run(); return; }
    new window.IntersectionObserver(function (entries, obs) {
      if (entries[0].isIntersecting) { run(); obs.disconnect(); }
    }, { threshold: 0.3 }).observe($band[0]);
  }

  /* ============================ scroll reveal =========================== */

  var revealObserver = null;
  function observeReveals() {
    var $items = $('.mf-ex-reveal').not('.is-in');
    if (reduceMotion || !window.IntersectionObserver) { $items.addClass('is-in'); return; }
    if (!revealObserver) {
      revealObserver = new window.IntersectionObserver(function (entries) {
        $.each(entries, function (i, entry) {
          if (entry.isIntersecting) {
            $(entry.target).addClass('is-in');
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1 });
    }
    $items.each(function () { revealObserver.observe(this); });
  }

  /* ============================== confetti ============================== */

  function confetti() {
    if (reduceMotion) { return; }
    var colors = ['#D80F1E', '#0F1B33', '#FFB457', '#1F8A70'];
    var $holder = $('<div class="mf-ex-confetti" aria-hidden="true"></div>').appendTo('body');
    for (var i = 0; i < 30; i++) {
      $('<span class="mf-ex-scrap"></span>').css({
        left: Math.random() * 100 + '%',
        background: colors[i % colors.length],
        animationDelay: (Math.random() * 0.4) + 's'
      }).appendTo($holder);
    }
    window.setTimeout(function () { $holder.remove(); }, 2800);
  }

  /* =============================== search =============================== */

  // jQuery Use #3 – live search with debounce + suggestion dropdown
  function initSearch() {
    var timer = null;
    var $input = $('#exSearch');
    var $list = $('#exSuggest');

    function closeSuggest() {
      $list.attr('hidden', true).empty();
      $input.attr('aria-expanded', 'false');
    }

    function openSuggest(term) {
      var needle = term.toLowerCase();
      var matches = all.filter(function (d) {
        return d.Name.toLowerCase().indexOf(needle) > -1 ||
          d.Province.toLowerCase().indexOf(needle) > -1 ||
          d.Category.toLowerCase().indexOf(needle) > -1;
      }).slice(0, 6);

      $list.empty();
      if (!matches.length) {
        $list.append('<li class="mf-ex-suggest-empty">No destination matches &ldquo;' + esc(term) + '&rdquo;</li>');
      } else {
        $.each(matches, function (i, d) {
          $list.append(
            '<li role="presentation"><button class="mf-ex-suggest-item" type="button" role="option"' +
            ' aria-selected="false" data-slug="' + esc(d.Slug) + '">' +
              '<img ' + imgAttrs(d.Image_URL, '') + '>' +
              '<span><span class="mf-ex-suggest-name">' + esc(d.Name) + '</span>' +
              '<span class="mf-ex-suggest-meta d-block">' + esc(d.Category) + ' · ' + esc(d.Province) + '</span></span>' +
            '</button></li>'
          );
        });
      }
      $list.removeAttr('hidden');
      $input.attr('aria-expanded', 'true');
    }

    $input.on('input', function () {
      var term = $.trim($input.val());
      $('#exSearchClear').prop('hidden', !term);

      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        state.search = term;
        if (term) { openSuggest(term); } else { closeSuggest(); }
        load(false);
      }, 280);
    });

    $input.on('keydown', function (e) {
      var $items = $list.find('.mf-ex-suggest-item');
      var idx = $items.index($items.filter('.is-active'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!$items.length) { return; }
        e.preventDefault();
        var next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
        if (next >= $items.length) { next = 0; }
        if (next < 0) { next = $items.length - 1; }
        $items.removeClass('is-active').attr('aria-selected', 'false');
        $items.eq(next).addClass('is-active').attr('aria-selected', 'true');
      } else if (e.key === 'Enter' && idx > -1) {
        e.preventDefault();
        openDetail($items.eq(idx).data('slug'), $items.eq(idx)[0]);
        closeSuggest();
      } else if (e.key === 'Escape') {
        closeSuggest();
      }
    });

    $('#exSearchClear').on('click', function () {
      $input.val('').trigger('focus');
      $(this).prop('hidden', true);
      state.search = '';
      closeSuggest();
      load();
    });

    // Close when the click lands outside the search box.
    $(document).on('click', function (e) {
      if (!$(e.target).closest('.mf-ex-search').length) { closeSuggest(); }
    });

    $list.on('click', '.mf-ex-suggest-item', function () {
      openDetail($(this).data('slug'), this);
      closeSuggest();
    });
  }

  /* ================================ boot ================================ */

  function bind() {
    // jQuery Use #2 – event delegation for chips, cards, pins and modal
    $(document).on('click', '#exChips .mf-ex-chip', function () {
      state.category = $(this).data('cat');
      state.vibe = null;
      syncChipState();
      load();
    });

    $('#exPopular').on('click', function () {
      state.popular = !state.popular;
      syncChipState();
      load();
    });

    $('#exSort').on('change', function () {
      state.sort = $(this).val();
      load();
    });

    $(document).on('click', '#exVibes .mf-ex-vibe', function () {
      var vibe = $(this).data('vibe');
      state.vibe = state.vibe === vibe ? null : vibe;
      state.category = 'All';
      syncChipState();
      load();
    });

    // Cards: Quick view / Explore
    $(document).on('click', '[data-open]', function () {
      openDetail($(this).data('open'), this);
    });

    // Clicking the card itself (not one of its buttons) flies the map there.
    $(document).on('click', '.mf-ex-card', function (e) {
      if ($(e.target).closest('button, a').length) { return; }
      flyToDestination($(this).data('slug'));
    });

    $('#exMapReset').on('click', resetMapView);

    // Reset / retry from the empty and error states
    $(document).on('click', '#exReset', function () {
      state = { category: 'All', search: '', popular: false, sort: 'rating', vibe: null };
      $('#exSearch').val('');
      $('#exSearchClear').prop('hidden', true);
      syncChipState();
      load();
    });
    $(document).on('click', '#exRetry', function () {
      loadAll().always(function () { load(); });
    });

    // Map pins
    $(document).on('mouseenter focus', '#exMap .mf-ex-pin', function () { showTip($(this)); });
    $(document).on('mouseleave blur', '#exMap .mf-ex-pin', hideTip);
    $(document).on('click', '#exMap .mf-ex-pin', function () {
      openDetail($(this).data('slug'), this);
      hideTip();
    });

    // Surprise me
    $('#exSurprise').on('click', function () {
      if (!all.length) { return; }
      var pick = all[Math.floor(Math.random() * all.length)];
      var $card = $('.mf-ex-card[data-slug="' + pick.Slug + '"]');
      if ($card.length) {
        $('html, body').animate({ scrollTop: $card.offset().top - 110 }, reduceMotion ? 0 : 500);
      }
      confetti();
      window.setTimeout(function () { openDetail(pick.Slug, document.getElementById('exSurprise')); },
        reduceMotion ? 0 : 520);
    });

    // Return focus to whatever opened the modal.
    $('#exModal').on('hidden.bs.modal', function () {
      if (lastTrigger && document.body.contains(lastTrigger)) { $(lastTrigger).trigger('focus'); }
      lastTrigger = null;
    });

    // Trip planner -> search.html
    $('#exPlanForm').on('submit', function (e) {
      e.preventDefault();
      var from = $.trim($('#exFrom').val());
      var to = $.trim($('#exTo').val());
      var date = $('#exDate').val();
      var qs = [];
      if (from) { qs.push('from=' + encodeURIComponent(from)); }
      if (to) { qs.push('to=' + encodeURIComponent(to)); }
      if (date) { qs.push('date=' + encodeURIComponent(date)); }
      qs.push('pax=1');
      window.location.href = 'search.html?' + qs.join('&');
    });
  }

  var MetroFlowExplore = {
    reload: function () { return load(); },
    open: openDetail,
    getState: function () { return $.extend({}, state); }
  };
  window.MetroFlowExplore = MetroFlowExplore;

  $(function () {
    if (!$('#exGrid').length) { return; }

    // Today as the minimum travel date in the planner.
    var d = new Date();
    var today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
    $('#exDate').attr('min', today).val(today);

    readUrl();
    bind();
    initSearch();
    observeReveals();
    initMap();          // tiles start loading while the API call is in flight

    $('#exGrid').attr('aria-busy', 'true').html(skeletons(6));
    loadAll()
      .done(function () { load(false); })
      .fail(renderError);
  });

}(window, jQuery));
