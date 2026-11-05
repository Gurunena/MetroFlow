// search.js – bus search results page
// ---------------------------------------------------------------------------
// Namespace: MetroFlowSearch. No globals beyond window.MetroFlowSearch.
//
// DELIBERATELY STATIC: no jQuery effect methods are used anywhere in this
// file. Everything appears and disappears with .show()/.hide()/.toggleClass().
//
// One Ajax call fetches the result set; sorting, filtering and pagination then
// run on that array in the browser, so changing a filter never hits the API.
// There is no fixture data: if the request fails the page shows an error with
// a Retry button.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API = '/api/buses';
  var PER_PAGE = 10;

  /* ============================== helpers =============================== */

  // Everything from the API is escaped before it reaches innerHTML.
  function esc(value) {
    return $('<div>').text(value == null ? '' : String(value)).html();
  }

  function money(value) {
    var n = Number(value) || 0;
    return 'LKR ' + n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function iso(date) {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  function today() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function shiftDate(ymd, days) {
    var parts = String(ymd).split('-').map(Number);
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setDate(d.getDate() + days);
    return iso(d);
  }

  // "Tue, 10 Nov 2026"
  function prettyDate(ymd) {
    var parts = String(ymd).split('-').map(Number);
    if (parts.length !== 3) { return ymd; }
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  function minutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  }

  // Wraps past midnight, so 21:00 -> 05:30 reads as 8h 30m rather than negative.
  function durationMins(from, to) {
    var d = minutes(to) - minutes(from);
    if (d < 0) { d += 24 * 60; }
    return d;
  }

  function durationText(from, to) {
    var total = durationMins(from, to);
    var h = Math.floor(total / 60);
    var m = total % 60;
    if (!h) { return m + 'm'; }
    return m ? h + 'h ' + m + 'm' : h + 'h';
  }

  function timeBand(hhmm) {
    var mins = minutes(hhmm);
    if (mins >= 300 && mins < 720) { return 'morning'; }    // 05:00–11:59
    if (mins >= 720 && mins < 1080) { return 'afternoon'; } // 12:00–17:59
    if (mins >= 1080) { return 'evening'; }                 // 18:00–23:59
    return 'night';                                         // 00:00–04:59
  }

  /* =============================== state ================================ */

  var all = [];       // everything the API returned for the current query
  var view = [];      // after filters + sort
  var page = 1;

  var query = { from: '', to: '', date: '', pax: 1 };
  var filters = { sort: 'cheapest', bands: [], min: null, max: null, enough: false, names: [] };

  /* ================================ ajax ================================ */

  // jQuery Use #1 – $.ajax JSON calls to the bus API
  function apiGet(path, data) {
    return $.ajax({
      url: API + path,
      method: 'GET',
      dataType: 'json',
      data: data || {},
      timeout: 12000
    });
  }

  function errorText(xhr) {
    if (!xhr || xhr.status === 0) { return 'Could not reach the server.'; }
    var body = xhr.responseJSON;
    if (body && (body.message || body.error)) { return body.message || body.error; }
    if (xhr.status === 503) { return 'The database is unavailable right now.'; }
    return 'The server returned an error (' + xhr.status + ').';
  }

  /* =============================== loading ============================== */

  function load() {
    // jQuery Use #4 – plain-text loading state, no spinner or shimmer
    $('#srResults').attr('aria-busy', 'true').html(
      '<p class="mf-sr-loading">Loading buses…</p>'
    );
    $('#srPager').empty();

    var params = {};
    if (query.from) { params.from = query.from; }
    if (query.to) { params.to = query.to; }
    if (query.date) { params.date = query.date; }
    if (query.pax > 1) { params.minSeats = 1; }   // seat filtering is a client-side choice

    apiGet('/available', params)
      .done(function (res) {
        all = (res && res.data) || [];
        buildNameFilter();
        applyFilters(true);
      })
      .fail(function (xhr) {
        all = [];
        view = [];
        renderError(xhr);
      });
  }

  /* ============================== filtering ============================= */

  // jQuery Use #5 – client-side .filter() / .sort() over the loaded array
  function applyFilters(resetPage) {
    var list = all.slice();

    if (filters.bands.length) {
      list = $.grep(list, function (b) {
        return $.inArray(timeBand(b.Departure_Time), filters.bands) > -1;
      });
    }
    if (filters.min !== null) {
      list = $.grep(list, function (b) { return (Number(b.Fare) || 0) >= filters.min; });
    }
    if (filters.max !== null) {
      list = $.grep(list, function (b) { return (Number(b.Fare) || 0) <= filters.max; });
    }
    if (filters.enough) {
      list = $.grep(list, function (b) { return (Number(b.Available_Seats) || 0) >= query.pax; });
    }
    if (filters.names.length) {
      list = $.grep(list, function (b) { return $.inArray(b.Bus_Name, filters.names) > -1; });
    }

    list.sort(function (a, b) {
      switch (filters.sort) {
        case 'earliest':
          return (a.Travel_Date + a.Departure_Time).localeCompare(b.Travel_Date + b.Departure_Time);
        case 'latest':
          return (b.Travel_Date + b.Departure_Time).localeCompare(a.Travel_Date + a.Departure_Time);
        case 'seats':
          return (Number(b.Available_Seats) || 0) - (Number(a.Available_Seats) || 0);
        case 'duration':
          return durationMins(a.Departure_Time, a.Arrival_Time) -
                 durationMins(b.Departure_Time, b.Arrival_Time);
        default:
          return (Number(a.Fare) || 0) - (Number(b.Fare) || 0);
      }
    });

    view = list;
    if (resetPage) { page = 1; }
    renderSummary();
    renderResults();
  }

  function buildNameFilter() {
    var names = [];
    $.each(all, function (i, b) {
      if ($.inArray(b.Bus_Name, names) === -1) { names.push(b.Bus_Name); }
    });
    names.sort();

    // Drop any selection that no longer exists in this result set.
    filters.names = $.grep(filters.names, function (n) { return $.inArray(n, names) > -1; });

    var $box = $('#srNames').empty();
    if (!names.length) {
      $('#srNameGroup').hide();
      return;
    }
    $('#srNameGroup').show();

    $.each(names, function (i, name) {
      var count = $.grep(all, function (b) { return b.Bus_Name === name; }).length;
      $box.append(
        '<label class="mf-sr-check"><input type="checkbox" class="sr-name" value="' + esc(name) + '"' +
        ($.inArray(name, filters.names) > -1 ? ' checked' : '') + '> ' +
        esc(name) + '<span class="mf-sr-count">' + count + '</span></label>'
      );
    });
  }

  /* =============================== render =============================== */

  function renderSummary() {
    var bits = [];
    bits.push('<b>' + view.length + '</b> bus' + (view.length === 1 ? '' : 'es') + ' found');
    if (query.from) { bits.push('from <b>' + esc(query.from) + '</b>'); }
    if (query.to) { bits.push('to <b>' + esc(query.to) + '</b>'); }
    if (query.date) { bits.push('on <b>' + esc(prettyDate(query.date)) + '</b>'); }

    var text = bits.join(' ');
    text += ' &middot; ' + query.pax + ' passenger' + (query.pax === 1 ? '' : 's');
    if (!query.from && !query.to && !query.date) {
      text += '<br><span class="mf-sr-hint">Showing all upcoming services — enter your trip to narrow down the results.</span>';
    }
    $('#srSummary').html(text);
  }

  function seatBadge(left, total) {
    if (left <= 0) { return { cls: 'mf-sr-badge-out', label: 'Sold out' }; }
    if (left <= 4) { return { cls: 'mf-sr-badge-low', label: 'Almost full' }; }
    if (left <= 14) { return { cls: 'mf-sr-badge-warn', label: 'Filling fast' }; }
    return { cls: 'mf-sr-badge-ok', label: 'Seats available' };
  }

  function cardHtml(b, index) {
    var left = Number(b.Available_Seats) || 0;
    var total = Number(b.Total_Seats) || 0;
    var fare = Number(b.Fare) || 0;
    var badge = seatBadge(left, total);
    var enough = left >= query.pax && left > 0;
    var pct = total ? Math.round((left / total) * 100) : 0;
    var detailsId = 'srDet' + index;

    var seatsUrl = 'seats.html?busId=' + encodeURIComponent(b.Bus_ID) +
      '&date=' + encodeURIComponent(b.Travel_Date) +
      '&pax=' + encodeURIComponent(query.pax);

    var action = enough
      ? '<a class="mf-sr-btn-primary" href="' + esc(seatsUrl) + '">Select Seats <i class="bi bi-arrow-right" aria-hidden="true"></i></a>'
      : '<button type="button" class="mf-sr-btn-primary is-disabled" disabled>' +
        (left <= 0 ? 'Sold out' : 'Not enough seats') + '</button>';

    return '' +
      '<article class="mf-sr-card">' +
        '<div class="mf-sr-card-top">' +
          '<div><span class="mf-sr-name">' + esc(b.Bus_Name) + '</span> ' +
            '<span class="mf-sr-id">' + esc(b.Bus_ID) + '</span></div>' +
          '<span class="mf-sr-badge ' + badge.cls + '">' + badge.label + '</span>' +
        '</div>' +

        '<div class="mf-sr-leg">' +
          '<div><div class="mf-sr-time">' + esc(b.Departure_Time) + '</div>' +
            '<div class="mf-sr-place">' + esc(b.Departure) + '</div></div>' +
          '<div class="mf-sr-line"><span class="mf-sr-dur">' +
            esc(durationText(b.Departure_Time, b.Arrival_Time)) + '</span></div>' +
          '<div class="text-end"><div class="mf-sr-time">' + esc(b.Arrival_Time) + '</div>' +
            '<div class="mf-sr-place">' + esc(b.Destination) + '</div></div>' +
        '</div>' +

        '<div class="mf-sr-meta">' +
          '<i class="bi bi-signpost-split" aria-hidden="true"></i> ' + esc(b.Route) +
          ' &middot; <i class="bi bi-calendar-event" aria-hidden="true"></i> ' + esc(prettyDate(b.Travel_Date)) +
        '</div>' +

        '<div class="mf-sr-seats-row">' +
          '<div class="mf-sr-bar"><span style="width:' + pct + '%"></span></div>' +
          '<span class="mf-sr-seats-text">' + left + ' of ' + total + ' seats left</span>' +
        '</div>' +

        '<div class="mf-sr-card-foot">' +
          '<div>' +
            '<div class="mf-sr-fare">' + esc(money(fare)) + '<small>per seat</small></div>' +
            (query.pax > 1
              ? '<div class="mf-sr-total">' + esc(money(fare * query.pax)) + ' for ' + query.pax + '</div>'
              : '') +
          '</div>' +
          '<div class="d-flex gap-2">' +
            '<button type="button" class="mf-sr-btn" data-details="' + detailsId + '"' +
              ' aria-expanded="false" aria-controls="' + detailsId + '">Details</button>' +
            action +
          '</div>' +
        '</div>' +

        '<div class="mf-sr-details" id="' + detailsId + '">' +
          '<dl class="mf-sr-dl">' +
            '<dt>Route</dt><dd>' + esc(b.Route) + '</dd>' +
            '<dt>Departs</dt><dd>' + esc(b.Departure) + ' at ' + esc(b.Departure_Time) + '</dd>' +
            '<dt>Arrives</dt><dd>' + esc(b.Destination) + ' at ' + esc(b.Arrival_Time) + '</dd>' +
            '<dt>Duration</dt><dd>' + esc(durationText(b.Departure_Time, b.Arrival_Time)) + '</dd>' +
            '<dt>Travel date</dt><dd>' + esc(b.Travel_Date) + '</dd>' +
            '<dt>Total seats</dt><dd>' + total + '</dd>' +
            '<dt>Available</dt><dd>' + left + '</dd>' +
            '<dt>Fare</dt><dd>' + esc(money(fare)) + ' per seat</dd>' +
          '</dl>' +
        '</div>' +
      '</article>';
  }

  // jQuery Use #4 – dynamic rendering with .empty() / .append() / .html()
  function renderResults() {
    var $out = $('#srResults').attr('aria-busy', 'false').empty();

    if (!view.length) {
      renderEmpty();
      $('#srPager').empty();
      return;
    }

    var pages = Math.ceil(view.length / PER_PAGE);
    if (page > pages) { page = pages; }
    var start = (page - 1) * PER_PAGE;

    $.each(view.slice(start, start + PER_PAGE), function (i, bus) {
      $out.append(cardHtml(bus, start + i));
    });

    renderPager(pages);
  }

  function renderPager(pages) {
    var $p = $('#srPager').empty();
    if (pages <= 1) { return; }

    $p.append('<button type="button" data-page="' + (page - 1) + '"' +
      (page === 1 ? ' disabled' : '') + ' aria-label="Previous page">&lsaquo;</button>');

    for (var n = 1; n <= pages; n++) {
      $p.append('<button type="button" data-page="' + n + '"' +
        (n === page ? ' aria-current="page"' : '') + '>' + n + '</button>');
    }

    $p.append('<button type="button" data-page="' + (page + 1) + '"' +
      (page === pages ? ' disabled' : '') + ' aria-label="Next page">&rsaquo;</button>');
  }

  function renderEmpty() {
    var filtersOn = filters.bands.length || filters.names.length || filters.enough ||
      filters.min !== null || filters.max !== null;

    var html =
      '<div class="mf-sr-state">' +
        '<i class="bi bi-bus-front" aria-hidden="true"></i>' +
        '<h2>No buses match your search.</h2>' +
        '<p>' + (filtersOn
          ? 'Your filters may be too narrow, or nothing runs on this date.'
          : 'Nothing runs on that route and date yet.') + '</p>' +
        '<div class="mf-sr-state-actions">' +
          (filtersOn ? '<button type="button" class="mf-sr-btn" id="srClearFilters">Clear filters</button>' : '') +
          '<a class="mf-sr-btn" href="index.html">Back to home</a>' +
        '</div>' +
        (query.date ? '<div id="srNearbyWrap"><p class="mf-sr-hint mt-3 mb-0">Try another date:</p>' +
          '<div class="mf-sr-nearby" id="srNearby"></div></div>' : '') +
      '</div>';

    $('#srResults').html(html);
    if (query.date) { loadNearbyDates(); }
  }

  // Extra request only for the empty state: which nearby dates do run?
  function loadNearbyDates() {
    var offsets = [-2, -1, 1, 2, 3];
    var $box = $('#srNearby');
    var minDate = iso(today());

    $.each(offsets, function (i, off) {
      var date = shiftDate(query.date, off);
      if (date < minDate) { return; }

      var params = { date: date };
      if (query.from) { params.from = query.from; }
      if (query.to) { params.to = query.to; }

      apiGet('/available', params).done(function (res) {
        var n = (res && res.data && res.data.length) || 0;
        if (!n) { return; }
        $box.append('<button type="button" data-date="' + esc(date) + '">' +
          esc(prettyDate(date)) + ' <span class="mf-sr-count">' + n + '</span></button>');
      });
    });
  }

  function renderError(xhr) {
    $('#srResults').attr('aria-busy', 'false').html(
      '<div class="mf-sr-state">' +
        '<i class="bi bi-wifi-off" aria-hidden="true"></i>' +
        '<h2>Could not load buses</h2>' +
        '<p>' + esc(errorText(xhr)) + '</p>' +
        '<div class="mf-sr-state-actions">' +
          '<button type="button" class="mf-sr-btn-primary" id="srRetry">' +
            '<i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Retry</button>' +
        '</div>' +
      '</div>'
    );
    $('#srPager').empty();
    $('#srSummary').text('');
  }

  /* ============================== the form ============================== */

  function setField($input, valid, message) {
    $input.toggleClass('is-invalid', !valid);
    if (!valid && message) { $input.siblings('.mf-sr-msg').text(message); }
    return valid;
  }

  // jQuery Use #3 – validation, then .serializeArray() into query params
  function readForm() {
    var values = {};
    $.each($('#srForm').serializeArray(), function (i, f) { values[f.name] = f.value; });
    return {
      from: $.trim(values.from || ''),
      to: $.trim(values.to || ''),
      date: values.date || '',
      pax: parseInt(values.pax, 10) || 1
    };
  }

  function validate(v) {
    var ok = true;
    var minDate = iso(today());

    // From/To are optional (a bare search lists everything), but if both are
    // given they must differ.
    if (v.from && v.to && v.from.toLowerCase() === v.to.toLowerCase()) {
      ok = setField($('#srTo'), false, 'Destination must differ from departure.') && ok;
      ok = false;
    } else {
      setField($('#srTo'), true);
    }

    if (v.date && v.date < minDate) {
      setField($('#srDate'), false, 'Pick today or a later date.');
      ok = false;
    } else {
      setField($('#srDate'), true);
    }

    if (!(v.pax >= 1 && v.pax <= 6)) {
      setField($('#srPax'), false, 'Between 1 and 6 passengers.');
      ok = false;
    } else {
      setField($('#srPax'), true);
    }

    setField($('#srFrom'), true);
    return ok;
  }

  function writeUrl() {
    var parts = [];
    if (query.from) { parts.push('from=' + encodeURIComponent(query.from)); }
    if (query.to) { parts.push('to=' + encodeURIComponent(query.to)); }
    if (query.date) { parts.push('date=' + encodeURIComponent(query.date)); }
    if (query.pax !== 1) { parts.push('pax=' + query.pax); }
    try {
      window.history.replaceState(null, '',
        parts.length ? '?' + parts.join('&') : window.location.pathname);
    } catch (err) {
      // Some embedded contexts refuse replaceState; searching still works.
    }
  }

  function readUrl() {
    var q = window.location.search;
    function get(key) {
      var m = new RegExp('[?&]' + key + '=([^&]*)').exec(q);
      return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
    }
    query.from = get('from');
    query.to = get('to');
    query.date = get('date');
    var pax = parseInt(get('pax'), 10);
    query.pax = (pax >= 1 && pax <= 6) ? pax : 1;

    $('#srFrom').val(query.from);
    $('#srTo').val(query.to);
    $('#srDate').val(query.date);
    $('#srPax').val(String(query.pax));
  }

  /* =============================== binding ============================== */

  function bind() {
    // jQuery Use #2 – handlers and delegation for form, filters and pager
    $('#srForm').on('submit', function (e) {
      e.preventDefault();
      var v = readForm();
      if (!validate(v)) { return; }
      query = v;
      writeUrl();
      load();
    });

    $('#srForm').on('input change', 'input, select', function () {
      $(this).removeClass('is-invalid');
    });

    $('#srSwap').on('click', function () {
      var from = $('#srFrom').val();
      $('#srFrom').val($('#srTo').val());
      $('#srTo').val(from);
      $('#srFrom, #srTo').removeClass('is-invalid');
    });

    // Filters re-render from the array already in memory – no new request.
    $('#srSort').on('change', function () {
      filters.sort = $(this).val();
      applyFilters(true);
    });

    $(document).on('change', '.sr-time', function () {
      filters.bands = $('.sr-time:checked').map(function () { return this.value; }).get();
      applyFilters(true);
    });

    $(document).on('change', '.sr-name', function () {
      filters.names = $('.sr-name:checked').map(function () { return this.value; }).get();
      applyFilters(true);
    });

    $('#srMin, #srMax').on('input', function () {
      var min = parseInt($('#srMin').val(), 10);
      var max = parseInt($('#srMax').val(), 10);
      filters.min = isNaN(min) ? null : min;
      filters.max = isNaN(max) ? null : max;
      applyFilters(true);
    });

    $('#srEnough').on('change', function () {
      filters.enough = $(this).is(':checked');
      applyFilters(true);
    });

    $('#srReset').on('click', resetFilters);
    $(document).on('click', '#srClearFilters', resetFilters);

    $(document).on('click', '#srRetry', load);

    // Pagination
    $(document).on('click', '#srPager button[data-page]', function () {
      var n = parseInt($(this).attr('data-page'), 10);
      if (!n || n < 1) { return; }
      page = n;
      renderResults();
      // Jump, not scroll-animate.
      window.scrollTo(0, $('#srResults').offset().top - 90);
    });

    // Details toggle – display only, no slide.
    $(document).on('click', '[data-details]', function () {
      var $btn = $(this);
      var $panel = $('#' + $btn.attr('data-details'));
      var open = $panel.hasClass('is-open');
      $panel.toggleClass('is-open', !open);
      $btn.attr('aria-expanded', open ? 'false' : 'true');
    });

    // Nearby-date suggestion in the empty state
    $(document).on('click', '#srNearby button[data-date]', function () {
      query.date = $(this).attr('data-date');
      $('#srDate').val(query.date);
      writeUrl();
      load();
    });

    // Mobile filters panel – toggled by class, not slid.
    $('#srFilterToggle').on('click', function () {
      var open = $('#srFilters').hasClass('is-open');
      $('#srFilters').toggleClass('is-open', !open);
      $(this).attr('aria-expanded', open ? 'false' : 'true');
    });
  }

  function resetFilters() {
    filters = { sort: 'cheapest', bands: [], min: null, max: null, enough: false, names: [] };
    $('#srSort').val('cheapest');
    $('.sr-time, .sr-name').prop('checked', false);
    $('#srMin, #srMax').val('');
    $('#srEnough').prop('checked', false);
    applyFilters(true);
  }

  // Fill the datalist from the API so it reflects what is actually seeded.
  function loadPlaces() {
    apiGet('/locations').done(function (res) {
      var places = (res && res.data) || [];
      if (!places.length) { return; }
      var $list = $('#srPlaces').empty();
      $.each(places, function (i, place) {
        $list.append('<option value="' + esc(place) + '"></option>');
      });
    });
    // No .fail handler: the markup already ships a sensible baseline list.
  }

  /* ================================ boot ================================ */

  var MetroFlowSearch = {
    reload: load,
    getResults: function () { return view.slice(); },
    getFilters: function () { return $.extend({}, filters); }
  };
  window.MetroFlowSearch = MetroFlowSearch;

  $(function () {
    if (!$('#srForm').length) { return; }

    $('#srDate').attr('min', iso(today()));
    readUrl();
    bind();
    loadPlaces();
    load();
  });

}(window, jQuery));
