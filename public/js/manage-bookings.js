// manage-bookings.js – Seat selection page (Member 3)
// ---------------------------------------------------------------------------
// Shows the real seat layout of a bus with available / booked seats loaded
// from the server, lets the passenger pick one seat per passenger (1–6) and
// continue to booking.
//   GET /api/buses                      – buses for the picker (fallback only)
//   GET /api/buses/:busId               – bus + journey details
//   GET /api/bookings/bus/:busId/seats  – seats already booked on that bus
// Seat availability is updated by the booking API itself (a booking takes a
// seat, a cancellation frees it); this page re-checks every 20 seconds and on
// "Refresh", so it always shows the latest state.
// Opened from the search results as manage-bookings.html?busId=MB1002&pax=2
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API = '/api';
  var REFRESH_MS = 20000;
  var MAX_PAX = 6; // one booking can be for up to 6 passengers

  var params = new URLSearchParams(window.location.search);
  var busId = (params.get('busId') || params.get('bus') || '').toUpperCase();
  // number of passengers = number of seats that must be selected (1–6, from the search page)
  var pax = Math.min(Math.max(parseInt(params.get('pax'), 10) || 1, 1), MAX_PAX);
  var bus = null;
  var booked = [];
  var selected = [];
  var timer = null;
  var lastRefresh = null;

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

  function api(path) {
    return $.ajax({ url: API + path, method: 'GET', dataType: 'json', timeout: 10000 })
      .then(function (payload) { return payload && payload.data !== undefined ? payload.data : payload; });
  }

  function money(n) {
    return 'LKR ' + Math.round(Number(n) || 0).toLocaleString();
  }

  function showMessage(message, type) {
    $('#seatMessage').stop(true, true)
      .attr('class', 'alert ' + (type === 'error' ? 'alert-danger' : type === 'warning' ? 'alert-warning' : 'alert-success'))
      .text(message).hide().fadeIn(200);
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Counts the total price up/down to its new value
  function animateTotal(to) {
    var $el = $('#totalPrice');
    var from = Number($el.data('value')) || 0;
    $el.data('value', to).stop(true);
    if (reducedMotion()) { $el.text(money(to)); return; }
    $({ n: from }).animate({ n: to }, {
      duration: 450,
      step: function (n) { $el.text(money(n)); },
      complete: function () { $el.text(money(to)); }
    });
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function nowTime() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function hasDeparted() {
    return bus.Travel_Date < today() || (bus.Travel_Date === today() && bus.Departure_Time <= nowTime());
  }

  function canBook() {
    return bus && bus.Status !== 'Unavailable' && !hasDeparted();
  }

  function niceDate(iso) {
    var d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  /* ============================== bus picker ============================= */

  // Only used when the page is opened without a bus from the search results
  function loadBusPicker() {
    api('/buses').done(function (buses) {
      var $picker = $('#busPicker').empty().append('<option value="">— Choose a bus —</option>');
      $.each(buses || [], function (i, b) {
        $('<option>').val(b.Bus_ID).text(
          b.Bus_ID + ' · ' + b.Departure + ' → ' + b.Destination + ' · ' + b.Travel_Date + ' ' + b.Departure_Time
        ).appendTo($picker);
      });
      $picker.val(busId);
    }).fail(function () {
      $('#busPicker').html('<option value="">Could not load buses</option>');
    });
  }

  /* =========================== journey details =========================== */

  function showJourney() {
    $('#busName').text(bus.Bus_Name + ' · ' + bus.Bus_ID);
    $('#busTags').html(
      (bus.Bus_Type ? '<span class="sm-tag">' + esc(bus.Bus_Type) + '</span>' : '') +
      '<span class="sm-tag">' + esc(bus.Total_Seats) + ' seats</span>' +
      (bus.Route ? '<span class="sm-tag">' + esc(bus.Route) + '</span>' : '')
    );
    $('#depTime').text(bus.Departure_Time);
    $('#arrTime').text(bus.Arrival_Time);
    $('#depCity').text(bus.Departure);
    $('#arrCity').text(bus.Destination);
    $('#busRoute').text(bus.Departure + ' → ' + bus.Destination);
    $('#busDate').text(niceDate(bus.Travel_Date));
    $('#busTime').text(bus.Departure_Time + ' – ' + bus.Arrival_Time);
    $('#fareChip').text(money(bus.Fare) + ' / seat');
    $('#farePer').text(money(bus.Fare));
  }

  function showNoBus(message) {
    bus = null;
    booked = [];
    $('#seatGrid').html(
      '<p class="sm-empty">' + message + '</p>' +
      '<p class="sm-empty mt-0"><a class="mf-btn-red btn-sm text-decoration-none" href="search.html">' +
      '<i class="bi bi-search" aria-hidden="true"></i> Find a bus</a></p>'
    );
    $('#lastUpdated').text('waiting for a bus');
    updateSeatAvailability();
  }

  function loadBus() {
    window.clearInterval(timer);
    selected = [];
    if (!busId) {
      $('#busName').text('Choose a bus');
      showNoBus('Search for your journey first, then choose <strong>Select Seats</strong> on a bus.');
      return;
    }

    api('/buses/' + encodeURIComponent(busId))
      .done(function (data) {
        bus = data;
        showJourney();
        loadSeats(false);
        timer = window.setInterval(function () { loadSeats(false); }, REFRESH_MS);
      })
      .fail(function () {
        $('#busName').text('Bus ' + busId + ' not found');
        showNoBus('We could not find bus <strong>' + esc(busId) + '</strong>.');
      });
  }

  /* ============================== seat layout ============================ */

  // Seat labels in a 2 + 2 layout: row A = A1 A2 | A3 A4, row B …, up to the bus capacity
  function seatRows(total) {
    var rows = [];
    for (var i = 0; i < total; i++) {
      var r = Math.floor(i / 4);
      rows[r] = rows[r] || [];
      rows[r].push(String.fromCharCode(65 + r) + (i % 4 + 1));
    }
    return rows;
  }

  // Fetches the booked seats and redraws the map, keeping the user's selection
  function loadSeats(announce) {
    if (!bus) { return; }
    api('/bookings/bus/' + encodeURIComponent(bus.Bus_ID) + '/seats')
      .done(function (seats) {
        var before = booked;
        booked = seats || [];
        var lost = $.grep(selected, function (s) { return booked.indexOf(s) !== -1; });
        selected = $.grep(selected, function (s) { return booked.indexOf(s) === -1; });
        var newlyTaken = $.grep(booked, function (s) { return before.indexOf(s) === -1; });

        renderSeats(before.length ? newlyTaken : [], !before.length && !announce);
        lastRefresh = Date.now();
        tickUpdated();

        if (lost.length) {
          showMessage('Sorry – ' + lost.join(', ') + ' was just booked by someone else and has been removed.', 'warning');
        } else if (announce) {
          showMessage('Seat availability refreshed – ' + (bus.Total_Seats - booked.length) + ' seats free.', 'success');
        }
      })
      .fail(function () {
        showMessage('Could not load seat availability – please try again.', 'error');
      });
  }

  // firstDraw: seats pop in row by row; justTaken: seats that someone else just booked shake
  function renderSeats(justTaken, firstDraw) {
    var $grid = $('#seatGrid').empty();
    var open = canBook();

    $.each(seatRows(bus.Total_Seats), function (r, row) {
      $.each(row, function (i, label) {
        if (i === 2) {
          $('<span class="sm-row-no" aria-hidden="true">').text(label.charAt(0)).appendTo($grid);
        }
        var isBooked = booked.indexOf(label) !== -1;
        var isSelected = selected.indexOf(label) !== -1;
        var $seat = $('<button type="button" class="seat">')
          .text(label)
          .attr('data-seat', label)
          .attr('aria-label', 'Seat ' + label + (isBooked ? ', booked' : isSelected ? ', selected' : ', available'))
          .attr('aria-pressed', isSelected)
          .addClass(isBooked ? 'booked' : isSelected ? 'selected' : 'available')
          .toggleClass('just-taken', justTaken.indexOf(label) !== -1)
          .prop('disabled', isBooked || !open)
          .css('animation-delay', firstDraw ? (r * 0.05 + i * 0.02) + 's' : '0s');
        if (!firstDraw && !isSelected && justTaken.indexOf(label) === -1) {
          $seat.css('animation', 'none'); // no pop-in on silent refreshes
        }
        $seat.appendTo($grid);
      });
      // last row with fewer than 3 seats still needs the aisle column
      if (row.length <= 2) {
        $('<span class="sm-row-no" aria-hidden="true">').text(row[0].charAt(0)).appendTo($grid);
      }
    });

    if (!open) {
      showMessage(bus.Status === 'Unavailable'
        ? 'This bus is not taking bookings right now.'
        : 'This bus has already departed – please choose a later bus.', 'warning');
    }
    updateSeatAvailability();
  }

  // "Live · updated 12s ago"
  function tickUpdated() {
    if (!lastRefresh) { return; }
    var s = Math.round((Date.now() - lastRefresh) / 1000);
    $('#lastUpdated').text(s < 5 ? 'updated just now' : 'updated ' + s + 's ago');
  }

  /* ============================ summary panel ============================ */

  // Updates counts, chips, progress bar, fare and the continue button
  function updateSeatAvailability() {
    var total = bus ? bus.Total_Seats : 0;
    $('#availableSeatCount').text(Math.max(total - booked.length - selected.length, 0));
    $('#occupiedSeatCount').text(bus ? booked.length : 0);
    $('#selectedSeatCount').text(selected.length);

    $('.sm-pax-pills button').each(function () {
      $(this).toggleClass('active', Number($(this).data('pax')) === pax)
        .attr('aria-pressed', Number($(this).data('pax')) === pax);
    });

    var $list = $('#selectedSeatsList');
    var shown = $list.find('.sm-seat-chip').map(function () { return $(this).data('seat'); }).get();
    if (!selected.length) {
      $list.html('<p class="sm-muted mb-0">No seats selected yet.</p>');
    } else {
      if (!shown.length) { $list.empty(); }
      // remove chips for seats no longer selected, add new ones (they pop in)
      $list.find('.sm-seat-chip').each(function () {
        if (selected.indexOf($(this).data('seat')) === -1) { $(this).remove(); }
      });
      $.each(selected, function (i, s) {
        if (shown.indexOf(s) === -1) {
          $('<span class="sm-seat-chip">').attr('data-seat', s)
            .html('<i class="bi bi-check2-circle" aria-hidden="true"></i>' + esc(s) +
              ' <button type="button" aria-label="Remove seat ' + esc(s) + '">&times;</button>')
            .appendTo($list);
        }
      });
    }

    $('#paxNote').text('Select ' + pax + ' seat' + (pax === 1 ? '' : 's'));
    $('#progressBar').css('width', Math.min(selected.length / pax, 1) * 100 + '%')
      .parent().toggleClass('is-done', selected.length === pax);
    $('#fareCount').text(selected.length + ' × ' + (bus ? money(bus.Fare) : '—'));
    animateTotal(bus ? bus.Fare * selected.length : 0);

    // Continue only when exactly one seat per passenger has been selected
    $('#continueBooking').prop('disabled', !bus || selected.length !== pax);
  }

  function toggleSeat(label) {
    var i = selected.indexOf(label);
    var $seat = $('#seatGrid .seat[data-seat="' + label + '"]');

    if (i !== -1) {
      selected.splice(i, 1);
      $seat.removeClass('selected').addClass('available').attr('aria-pressed', false);
      showMessage(label + ' removed.', 'success');
    } else if (selected.length >= pax) {
      showMessage('You have ' + pax + ' passenger' + (pax === 1 ? '' : 's') + ' – remove a seat first, or add a passenger.', 'warning');
      $seat.removeClass('just-taken');
      void $seat[0].offsetWidth; // restart the shake
      $seat.addClass('just-taken');
      return;
    } else {
      selected.push(label);
      $seat.removeClass('available').addClass('selected').attr('aria-pressed', true).css('animation', '');
      showMessage(label + ' selected.', 'success');
    }
    updateSeatAvailability();
  }

  function setPax(n) {
    pax = Math.min(Math.max(n, 1), MAX_PAX);
    $('#paxSelect').val(String(pax));
    if (selected.length > pax) {
      var dropped = selected.splice(pax);
      $.each(dropped, function (i, s) {
        $('#seatGrid .seat[data-seat="' + s + '"]').removeClass('selected').addClass('available').attr('aria-pressed', false);
      });
      showMessage('Removed ' + dropped.join(', ') + ' – ' + pax + ' passenger' + (pax === 1 ? '' : 's') + ' now.', 'warning');
    }
    if (busId) {
      window.history.replaceState(null, '', '?busId=' + encodeURIComponent(busId) + '&pax=' + pax);
    }
    updateSeatAvailability();
  }

  /* ================================ events =============================== */

  function bind() {
    // Pick / remove a seat (event delegation – the map is rebuilt on refresh)
    $('#seatGrid').on('click', '.seat.available, .seat.selected', function () {
      toggleSeat($(this).data('seat'));
    });

    // × on a seat chip removes that seat
    $('#selectedSeatsList').on('click', '.sm-seat-chip button', function () {
      toggleSeat($(this).closest('.sm-seat-chip').data('seat'));
    });

    // Passengers 1–6 (pill buttons, kept in step with the hidden select)
    $('.sm-pax-pills').on('click', 'button', function () { setPax(Number($(this).data('pax'))); });
    $('#paxSelect').on('change', function () { setPax(parseInt($(this).val(), 10) || 1); });

    $('#refreshSeatAvailability').on('click', function () {
      var $btn = $(this).removeClass('is-spinning');
      void $btn[0].offsetWidth;
      $btn.addClass('is-spinning');
      loadSeats(true);
    });

    $('#busPicker').on('change', function () {
      busId = $(this).val();
      var url = busId ? '?busId=' + encodeURIComponent(busId) + '&pax=' + pax : window.location.pathname;
      window.history.replaceState(null, '', url);
      $('#seatMessage').empty().attr('class', '');
      loadBus();
    });

    // Continue to the booking page with the chosen seats (Member 4)
    $('#continueBooking').on('click', function () {
      window.location.href = 'booking.html?bus=' + encodeURIComponent(bus.Bus_ID) +
        '&seats=' + encodeURIComponent(selected.join(','));
    });

    window.setInterval(tickUpdated, 1000);
  }

  /* ================================= init ================================ */

  $(function () {
    MF.loadPartial('#navbar', 'partials/navbar.html');
    MF.loadPartial('#footer', 'partials/footer.html');

    $('#paxSelect').val(String(pax));
    bind();
    // A bus normally arrives from the search results (?busId=…). The picker is
    // only a fallback for when the page is opened without one.
    if (busId) {
      $('#busPicker').hide();
    } else {
      loadBusPicker();
    }
    loadBus();
  });
})(window, jQuery);
