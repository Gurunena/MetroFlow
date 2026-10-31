// booking.js – front-end logic for the booking confirmation page
// ---------------------------------------------------------------------------
// Flow: seats.html sends the passenger here as booking.html?bus=MB1002&seats=A1,A2
//   -> passenger details -> one booking per seat (POST /api/bookings)
//   -> printable e-ticket(s).
// All server calls are jQuery Ajax with JSON. Responses use the shared shape
// { success, message?, data } / { success: false, error }.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API_BASE = '/api';
  var PHONE_RE = /^(\+94\d{9}|0\d{9})$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var currentBus = null; // bus shown in the trip summary

  /* ===================== shared namespace & tiny helpers ================= */

  var MF = window.MetroFlow = window.MetroFlow || {};

  // Escape anything that ends up in innerHTML – API text is never trusted.
  if (typeof MF.escape !== 'function') {
    MF.escape = function (value) {
      return $('<div>').text(value == null ? '' : String(value)).html();
    };
  }

  // Inject a partial once (same loader as home.js – whichever runs first wins).
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

  function api(method, path, body) {
    return $.ajax({
      url: API_BASE + path,
      method: method,
      dataType: 'json',
      contentType: body ? 'application/json' : undefined,
      data: body ? JSON.stringify(body) : undefined,
      timeout: 10000
    }).then(function (payload) {
      return payload && payload.data !== undefined ? payload.data : payload;
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
      .fadeIn(200).delay(4500).fadeOut(400);
  }

  // "2026-10-17" -> "Sat, 17 Oct 2026"
  function niceDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  function money(n) {
    return MF.formatFare ? MF.formatFare(n) : 'LKR ' + Number(n).toLocaleString('en-LK', { maximumFractionDigits: 2 });
  }

  // "A1, a2 ,B3" -> ["A1", "A2", "B3"] (duplicates removed)
  function parseSeats(text) {
    var seen = {};
    return $.map(String(text).split(','), function (s) {
      s = $.trim(s).toUpperCase();
      if (s === '' || seen[s]) { return null; }
      seen[s] = true;
      return s;
    });
  }

  function kv(label, value) {
    return '<div class="col-6 col-md-4 bk-kv"><small>' + label + '</small><strong>' + value + '</strong></div>';
  }

  /* ============== trip summary (Bus service: GET /api/buses/:busId) ======= */

  function loadTripSummary() {
    var busId = $.trim($('#busId').val()).toUpperCase();
    var seats = parseSeats($('#seats').val());

    if (!busId) {
      currentBus = null;
      $('#sumRoute').text('Choose a bus');
      $('#tripSummary').html('<p class="mf-muted mb-0">Enter a Bus ID to see the trip details.</p>');
      return;
    }
    $('#seatsLink').attr('href', 'seats.html?bus=' + encodeURIComponent(busId));

    api('GET', '/buses/' + encodeURIComponent(busId))
      .done(function (bus) {
        currentBus = bus;
        var count = seats.length || 1;
        $('#searchLink').attr('href', 'search.html?from=' + encodeURIComponent(bus.Departure) +
          '&to=' + encodeURIComponent(bus.Destination) + '&date=' + encodeURIComponent(bus.Travel_Date));
        $('#sumRoute').text(bus.Departure + ' → ' + bus.Destination);
        $('#routeLine').html(esc(bus.Departure) + ' <i class="bi bi-arrow-right" aria-hidden="true"></i> ' +
          esc(bus.Destination) + ' &middot; ' + esc(niceDate(bus.Travel_Date)));
        $('#tripSummary').html(
          '<div class="row g-3">' +
            kv('Bus', esc(bus.Bus_Name) + ' &middot; ' + esc(bus.Bus_ID)) +
            kv('Date', esc(niceDate(bus.Travel_Date))) +
            kv('Seats', seats.length ? esc(seats.join(', ')) : '&mdash;') +
            kv('Departs', esc(bus.Departure_Time)) +
            kv('Arrives', esc(bus.Arrival_Time)) +
            kv('Fare / seat', esc(money(bus.Fare))) +
          '</div>' +
          '<div class="bk-tear my-3 mx-0"></div>' +
          '<div class="d-flex justify-content-between align-items-end">' +
            '<div class="bk-kv"><small>Total to pay at boarding</small><span class="bk-price">' + esc(money(bus.Fare * count)) + '</span></div>' +
            '<span class="small mf-muted">' + count + ' &times; ' + esc(money(bus.Fare)) + '</span>' +
          '</div>' +
          (bus.Available_Seats < count
            ? '<p class="small mf-text-red mt-3 mb-0"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i> Only ' +
              esc(bus.Available_Seats) + ' seat(s) left on this bus.</p>'
            : '')
        ).hide().fadeIn(200);
      })
      .fail(function () {
        currentBus = null;
        $('#sumRoute').text('Bus not found');
        $('#tripSummary').html('<p class="mf-text-red mb-0"><i class="bi bi-exclamation-circle" aria-hidden="true"></i> No bus with ID ' +
          esc(busId) + '.</p>');
      });
  }

  /* ============================== validation ============================= */

  function validateForm() {
    var checks = {
      '#name': $.trim($('#name').val()).length >= 2,
      '#phone': PHONE_RE.test($('#phone').val().replace(/[\s-]/g, '')),
      '#email': EMAIL_RE.test($.trim($('#email').val()))
    };
    var valid = true;
    $.each(checks, function (selector, ok) {
      $(selector).attr('aria-invalid', !ok).closest('.bk-field').toggleClass('is-invalid', !ok).toggleClass('is-valid', ok);
      if (!ok) { valid = false; }
    });
    if (!valid) { $('#bookingForm .is-invalid input').first().trigger('focus'); }
    return valid;
  }

  // Turns the form into { Passenger_Name, Phone, Email, Boarding_Point }
  function formToObject($form) {
    var data = {};
    $.each($form.serializeArray(), function (i, field) {
      data[field.name] = $.trim(field.value);
    });
    return data;
  }

  /* ============================ create booking(s) ======================== */

  // POST one booking per seat, one after another, so every seat gets its own Booking ID
  function createBookings(passenger, busId, seats) {
    var created = [];
    var failed = [];

    function next(i) {
      if (i === seats.length) { return finish(created, failed); }
      api('POST', '/bookings', $.extend({}, passenger, { Bus_ID: busId, Seat_Number: seats[i] }))
        .done(function (booking) { created.push(booking); })
        .fail(function (xhr) { failed.push(seats[i] + ': ' + errorMessage(xhr)); })
        .always(function () { next(i + 1); });
    }
    next(0);
  }

  // One e-ticket, same layout as the MetroFlow design
  function ticketHtml(b) {
    var bus = currentBus || {};
    return '<article class="bk-ticket mb-4">' +
      '<div class="bk-ticket-head">' +
        '<div><small>MetroFlow e-ticket</small><h3>' + esc(b.Boarding_Point) + ' → ' + esc(b.Destination) + '</h3></div>' +
        '<span class="bk-status"><i class="bi bi-check-circle-fill" aria-hidden="true"></i> ' + esc(b.Booking_Status) + '</span>' +
      '</div>' +
      '<div class="bk-ticket-body"><div class="row g-3">' +
        kv('Passenger', esc(b.Passenger_Name)) +
        kv('Bus', (bus.Bus_Name ? esc(bus.Bus_Name) + ' &middot; ' : '') + esc(b.Bus_ID)) +
        kv('Date', esc(niceDate(b.Travel_Date))) +
        kv('Departs', esc(bus.Departure_Time || '—')) +
        kv('Arrives', esc(bus.Arrival_Time || '—')) +
        kv('Phone', esc(b.Phone)) +
      '</div></div>' +
      '<div class="bk-tear"></div>' +
      '<div class="bk-ticket-body d-flex justify-content-between align-items-end flex-wrap gap-3">' +
        '<div>' +
          '<div class="bk-kv mb-2"><small>Seat ' + esc(b.Seat_Number) + '</small><strong class="fs-5">' + esc(b.Booking_ID) + '</strong></div>' +
          '<div class="bk-kv"><small>Total paid at boarding</small><span class="bk-price">' + esc(money(b.Fare)) + '</span></div>' +
        '</div>' +
        '<div class="bk-barcode" aria-hidden="true"></div>' +
      '</div>' +
    '</article>';
  }

  function finish(created, failed) {
    $('#confirmBtn').prop('disabled', false).html('Confirm Booking <i class="bi bi-arrow-right" aria-hidden="true"></i>');

    if (!created.length) {
      showToast('Booking failed – ' + failed.join(' | '), 'danger');
      loadTripSummary(); // seat counts may have changed
      return;
    }
    if (failed.length) {
      showToast('Some seats could not be booked – ' + failed.join(' | '), 'warning');
    }

    var firstName = created[0].Passenger_Name.split(' ')[0];
    $('#confirmHello').text('You\'re all set, ' + firstName + '!');
    $('#titleScript').text('confirmed');
    $('#manageLink').attr('href', 'my-trips.html?id=' + encodeURIComponent(created[0].Booking_ID));
    $('#tickets').html($.map(created, ticketHtml).join(''));

    $('#detailsSection').slideUp(300, function () {
      $('#confirmSection').fadeIn(400);
      $('html, body').animate({ scrollTop: 0 }, 300);
    });
  }

  /* ================================ events =============================== */

  function bind() {
    // Live feedback while typing, but only once a field has been marked wrong
    $('#bookingForm').on('input', 'input[required]', function () {
      if ($(this).closest('.bk-field').hasClass('is-invalid')) { validateForm(); }
    });

    $('#busId, #seats').on('change', loadTripSummary);

    $('#bookingForm').on('submit', function (e) {
      e.preventDefault();
      var busId = $.trim($('#busId').val()).toUpperCase();
      var seats = parseSeats($('#seats').val());

      if (!validateForm()) { return; }
      if (!busId || !seats.length) {
        showToast('Please choose a bus and at least one seat', 'warning');
        return;
      }
      $('#confirmBtn').prop('disabled', true)
        .html('<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Booking...');
      createBookings(formToObject($(this)), busId, seats);
    });

    $('#printBtn').on('click', function () { window.print(); });
  }

  /* ================================= init ================================ */

  $(function () {
    // The booking page is not in the main menu, so no nav link is marked active here
    MF.loadPartial('#navbar', 'partials/navbar.html');
    MF.loadPartial('#footer', 'partials/footer.html');

    var params = new URLSearchParams(window.location.search);
    $('#busId').val(params.get('bus') || '');
    $('#seats').val(params.get('seats') || '');

    bind();
    loadTripSummary();
  });
})(window, jQuery);
