// trips.js – front-end logic for the my-trips page
// ---------------------------------------------------------------------------
// Booking Search (6 modes) + view, update and cancel.
// All server calls are jQuery Ajax with JSON. Responses use the shared shape
// { success, message?, count?, data } / { success: false, error }.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API_BASE = '/api';

  var searchType = 'id';  // current search-mode pill
  var lastSearch = null;  // repeated after an update / cancel so the list stays fresh
  var editModal = null;

  /* ===================== shared namespace & tiny helpers ================= */

  var MF = window.MetroFlow = window.MetroFlow || {};

  if (typeof MF.escape !== 'function') {
    MF.escape = function (value) {
      return $('<div>').text(value == null ? '' : String(value)).html();
    };
  }

  if (typeof MF.loadPartial !== 'function') {
    MF.loadPartial = function (selector, url) {
      var $host = $(selector);
      if (!$host.length || $.trim($host.html()) !== '') {
        return $.Deferred().resolve(false).promise();
      }
      return $.get(url).done(function (html) {
        $host.html(html);
      }).fail(function () {
        $host.attr('data-partial-failed', url);
      });
    };
  }

  var esc = MF.escape;
  var extras = MF.bookingExtras;
  var busMap = null; // Bus_ID -> bus, used for departure times and CO2 estimates

  function api(method, path, body) {
    return $.ajax({
      url: API_BASE + path,
      method: method,
      dataType: 'json',
      contentType: body ? 'application/json' : undefined,
      data: body ? JSON.stringify(body) : undefined,
      timeout: 10000
    });
  }

  function errorMessage(xhr) {
    var r = xhr && xhr.responseJSON;
    return (r && (r.error || r.message)) || 'Could not reach the server – please try again';
  }

  function showToast(message, type) {
    var icon = type === 'success' ? 'bi-check-circle-fill' : 'bi-exclamation-circle-fill';
    $('#toast').stop(true, true).attr('class', 'bk-toast ' + type)
      .html('<i class="bi ' + icon + ' me-2" aria-hidden="true"></i>' + esc(message))
      .fadeIn(200).delay(3500).fadeOut(400);
  }

  function niceDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  function money(n) {
    return MF.formatFare ? MF.formatFare(n) : 'LKR ' + Number(n).toLocaleString('en-LK', { maximumFractionDigits: 2 });
  }

  function formToObject($form) {
    var data = {};
    $.each($form.serializeArray(), function (i, field) {
      data[field.name] = $.trim(field.value);
    });
    return data;
  }

  function kv(label, value) {
    return '<div class="col-6 bk-kv"><small>' + label + '</small><strong>' + value + '</strong></div>';
  }

  /* ======================= results (one card per booking) ================ */

  // Loads the timetable once (Bus service: GET /api/buses) – the cards still work without it
  function loadBuses() {
    if (busMap) { return $.Deferred().resolve(busMap).promise(); }
    return api('GET', '/buses').then(function (payload) {
      busMap = {};
      $.each(payload && payload.data ? payload.data : [], function (i, bus) { busMap[bus.Bus_ID] = bus; });
      return busMap;
    }, function () {
      return $.Deferred().resolve({}).promise();
    });
  }

  // MetroMiles + total CO2 saved, only when every result belongs to the same passenger
  function showMiles(bookings, buses) {
    var $panel = $('#milesPanel');
    var phones = {};
    $.each(bookings, function (i, b) { phones[String(b.Phone).replace(/^\+94/, '0')] = true; });
    if (!bookings.length || Object.keys(phones).length !== 1) {
      $panel.slideUp(200);
      return;
    }

    var mm = extras.metroMiles(bookings);
    var co2 = 0;
    $.each(bookings, function (i, b) {
      if (b.Booking_Status === 'Confirmed' && buses[b.Bus_ID]) { co2 += extras.co2Saved(buses[b.Bus_ID]); }
    });

    $panel.html(
      '<div class="row g-3 align-items-center">' +
        '<div class="col-md-5 d-flex align-items-center gap-3">' +
          '<span class="bk-miles-badge is-' + esc(mm.level.name.toLowerCase()) + '"><i class="bi ' + esc(mm.level.icon) + '" aria-hidden="true"></i></span>' +
          '<div><small class="mf-eyebrow">MetroMiles &middot; ' + esc(bookings[0].Passenger_Name) + '</small>' +
            '<div class="h4 mb-0">' + esc(mm.miles.toLocaleString()) + ' <span class="fs-6 fw-semibold mf-muted">miles</span></div>' +
            '<span class="fw-bold mf-text-red">' + esc(mm.level.name) + ' member</span></div>' +
        '</div>' +
        '<div class="col-md-4">' +
          '<div class="bk-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + mm.progress + '">' +
            '<span style="width:' + mm.progress + '%"></span></div>' +
          '<small class="mf-muted">' + (mm.next
            ? esc((mm.next.min - mm.miles).toLocaleString()) + ' miles to ' + esc(mm.next.name)
            : 'Top level reached – thank you!') + '</small>' +
        '</div>' +
        '<div class="col-md-3 text-md-end">' +
          '<div class="bk-co2-total"><i class="bi bi-tree-fill" aria-hidden="true"></i> ' + esc(Math.round(co2 * 10) / 10) + ' kg</div>' +
          '<small class="mf-muted">CO&#8322; saved on ' + mm.trips + ' trip' + (mm.trips === 1 ? '' : 's') + '</small>' +
        '</div>' +
      '</div>'
    ).slideDown(250);
    $panel.find('.bk-progress span').css('width', 0).animate({ width: mm.progress + '%' }, 800);
  }

  function showResults(bookings) {
    loadBuses().always(function (buses) { renderResults(bookings, buses || {}); });
  }

  function renderResults(bookings, buses) {
    showMiles(bookings, buses);
    var $results = $('#results').empty();
    $('#resultCount').text(bookings.length + ' booking' + (bookings.length === 1 ? '' : 's') + ' found');

    if (!bookings.length) {
      $results.append('<div class="col-12 mf-state"><i class="bi bi-search" aria-hidden="true"></i>' +
        'No bookings found. Check the details and try again.</div>');
      return;
    }

    $.each(bookings, function (i, b) {
      var cancelled = b.Booking_Status === 'Cancelled';
      var bus = buses[b.Bus_ID];
      var $col = $('<div class="col-md-6 col-xl-4 trip-col">').toggleClass('cancelled', cancelled).html(
        '<article class="bk-ticket bk-trip' + (cancelled ? ' is-cancelled' : '') + '">' +
          '<div class="bk-ticket-head">' +
            '<div><small>' + esc(b.Booking_ID) + '</small><h3>' + esc(b.Boarding_Point) + ' → ' + esc(b.Destination) + '</h3></div>' +
            '<span class="bk-status' + (cancelled ? ' is-cancelled' : '') + '">' +
              '<i class="bi ' + (cancelled ? 'bi-x-circle-fill' : 'bi-check-circle-fill') + '" aria-hidden="true"></i> ' +
              esc(b.Booking_Status) + '</span>' +
          '</div>' +
          '<div class="bk-ticket-body"><div class="row g-3">' +
            kv('Passenger', esc(b.Passenger_Name)) +
            kv('Date', esc(niceDate(b.Travel_Date))) +
            kv('Bus', esc(b.Bus_ID)) +
            kv('Seat', esc(b.Seat_Number)) +
            kv('Phone', esc(b.Phone)) +
            kv('Fare', '<span class="mf-text-red">' + esc(money(b.Fare)) + '</span>') +
          '</div>' +
          (bus && !cancelled
            ? '<div class="d-flex flex-wrap gap-2 mt-3">' + extras.countdownHtml(b.Travel_Date, bus.Departure_Time) +
              '<span class="bk-countdown bk-co2-chip"><i class="bi bi-tree" aria-hidden="true"></i> ' +
              esc(extras.co2Saved(bus)) + ' kg CO&#8322; saved</span></div>'
            : '') +
          '</div>' +
          '<div class="bk-tear"></div>' +
          '<div class="bk-ticket-body d-flex gap-2">' +
            '<button type="button" class="btn btn-sm mf-btn-outline-red edit-btn"><i class="bi ' +
              (cancelled ? 'bi-eye' : 'bi-pencil') + '" aria-hidden="true"></i> ' + (cancelled ? 'View' : 'Edit') + '</button>' +
            (cancelled ? '' : '<a class="btn btn-sm bk-btn-whatsapp" href="' + esc(extras.shareUrl(b, bus)) +
              '" target="_blank" rel="noopener" aria-label="Share on WhatsApp"><i class="bi bi-whatsapp" aria-hidden="true"></i></a>') +
            (cancelled ? '' : '<button type="button" class="btn btn-sm mf-btn-ghost cancel-btn ms-auto">' +
              '<i class="bi bi-x-circle" aria-hidden="true"></i> Cancel booking</button>') +
          '</div>' +
        '</article>'
      );
      $col.data('booking', b); // keep the full booking object on the card
      $results.append($col);
    });

    applyHideCancelled();
    $results.children().hide().fadeIn(250);
  }

  // Live filter: hide cancelled cards without asking the server again
  function applyHideCancelled() {
    var hide = $('#hideCancelled').hasClass('active');
    $('#results .trip-col.cancelled').toggle(!hide);
  }

  /* ================================ search =============================== */

  // Booking ID -> GET /api/bookings/:id, others -> GET /api/bookings/<type>/<value>, all -> GET /api/bookings
  function searchBookings(type, value) {
    lastSearch = { type: type, value: value };
    var path = '/bookings';
    if (type === 'id') { path += '/' + encodeURIComponent(value); }
    else if (type !== 'all') { path += '/' + type + '/' + encodeURIComponent(value); }

    api('GET', path)
      .done(function (payload) {
        var data = payload && payload.data !== undefined ? payload.data : payload;
        showResults($.isArray(data) ? data : [data]); // "by ID" returns a single booking
      })
      .fail(function (xhr) {
        if (xhr.status === 404) { showResults([]); }
        else { showToast(errorMessage(xhr), 'danger'); }
      });
  }

  function refresh() {
    if (lastSearch) { searchBookings(lastSearch.type, lastSearch.value); }
  }

  /* ================================ events =============================== */

  function bind() {
    // Search-mode pills: change the field icon, label, placeholder and input type
    $('#searchModes').on('click', '.bk-pill', function () {
      var $pill = $(this);
      $pill.addClass('active').attr('aria-pressed', 'true')
        .siblings().removeClass('active').attr('aria-pressed', 'false');
      searchType = $pill.data('type');

      $('#searchIcon').attr('class', 'bi ' + $pill.data('icon'));
      $('#searchLabel').text($pill.data('label'));
      $('#searchValue')
        .attr('type', searchType === 'date' ? 'date' : 'text')
        .attr('placeholder', $pill.data('ph'))
        .val('').trigger('focus');
      $('#searchField').removeClass('is-invalid');
    });

    $('#searchForm').on('submit', function (e) {
      e.preventDefault();
      var value = $.trim($('#searchValue').val());
      $('#searchField').toggleClass('is-invalid', value === '');
      if (value) { searchBookings(searchType, value); }
    });

    $('#showAllBtn').on('click', function () { searchBookings('all'); });

    $('#hideCancelled').on('click', function () {
      $(this).toggleClass('active').attr('aria-pressed', $(this).hasClass('active'));
      applyHideCancelled();
    });

    // ---------- view / update ----------
    $('#results').on('click', '.edit-btn', function () {
      var b = $(this).closest('.trip-col').data('booking');
      var cancelled = b.Booking_Status === 'Cancelled';
      var $form = $('#editForm');

      $('#editId').text(b.Booking_ID);
      $('#editInfo').text(b.Bus_ID + ' · ' + niceDate(b.Travel_Date) + ' · to ' + b.Destination + ' · ' +
        money(b.Fare) + ' · ' + b.Booking_Status);
      $.each(['Passenger_Name', 'Phone', 'Email', 'Boarding_Point', 'Seat_Number'], function (i, field) {
        $form.find('[name=' + field + ']').val(b[field]).prop('disabled', cancelled)
          .closest('.bk-field').removeClass('is-invalid');
      });
      $('#saveBtn').toggle(!cancelled);
      $form.data('id', b.Booking_ID);
      editModal.show();
    });

    $('#editForm').on('submit', function (e) {
      e.preventDefault();
      var $form = $(this);

      var valid = true;
      $form.find('[required]').each(function () {
        var empty = $.trim($(this).val()) === '';
        $(this).closest('.bk-field').toggleClass('is-invalid', empty);
        if (empty) { valid = false; }
      });
      if (!valid) { return; }

      api('PUT', '/bookings/' + encodeURIComponent($form.data('id')), formToObject($form))
        .done(function (payload) {
          editModal.hide();
          showToast(payload.message || 'Booking updated', 'success');
          refresh();
        })
        .fail(function (xhr) { showToast(errorMessage(xhr), 'danger'); });
    });

    // ---------- cancel ----------
    $('#results').on('click', '.cancel-btn', function () {
      var $col = $(this).closest('.trip-col');
      var b = $col.data('booking');
      if (!window.confirm('Cancel booking ' + b.Booking_ID + ' for ' + b.Passenger_Name +
          ' (seat ' + b.Seat_Number + ')? The seat will be released.')) { return; }

      api('PATCH', '/bookings/' + encodeURIComponent(b.Booking_ID) + '/cancel')
        .done(function (payload) {
          showToast(payload.message || 'Booking cancelled', 'success');
          $col.fadeOut(300, refresh);
        })
        .fail(function (xhr) { showToast(errorMessage(xhr), 'danger'); });
    });
  }

  /* ================================= init ================================ */

  $(function () {
    $.when(
      MF.loadPartial('#navbar', 'partials/navbar.html'),
      MF.loadPartial('#footer', 'partials/footer.html')
    ).always(function () {
      $('.mf-nav .nav-link[data-page="my-trips"]').addClass('active').attr('aria-current', 'page');
    });

    editModal = new window.bootstrap.Modal('#editModal');
    bind();

    // Links like my-trips.html?id=BK20261015001 (used by "Manage booking" on the e-ticket)
    var id = new URLSearchParams(window.location.search).get('id');
    if (id) {
      $('#searchValue').val(id);
      searchBookings('id', id);
    }
  });
})(window, jQuery);
