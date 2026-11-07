// manage-bookings.js – Seat Management page (Member 3)
// ---------------------------------------------------------------------------
// Shows the real seat layout of a bus, with available / occupied seats loaded
// from the server, lets the passenger select seats and continue to booking.
//   GET /api/buses                      – buses for the picker
//   GET /api/buses/:busId               – bus + journey details
//   GET /api/bookings/bus/:busId/seats  – seats already booked on that bus
// Seat availability is updated by the booking API itself (a booking takes a
// seat, a cancellation frees it); this page refreshes every 20 seconds and on
// "Refresh Seat Availability" so it always shows the latest state.
// Opened from search as manage-bookings.html?busId=MB1002&pax=2
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API = '/api';
  var REFRESH_MS = 20000;
  var MAX_SEATS = 6; // limit when no passenger count was given

  var params = new URLSearchParams(window.location.search);
  var busId = (params.get('busId') || params.get('bus') || '').toUpperCase();
  var pax = parseInt(params.get('pax'), 10) || 0; // 0 = not set
  var bus = null;
  var booked = [];
  var selected = [];
  var timer = null;

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

  function showMessage(message, type) {
    $('#seatMessage').stop(true, true)
      .attr('class', 'alert mt-3 ' + (type === 'error' ? 'alert-danger' : type === 'warning' ? 'alert-warning' : 'alert-success'))
      .text(message).hide().fadeIn(200);
  }

  // Seat labels in a 2 + 2 layout: A1 A2 A3 A4, B1 ... up to the bus capacity
  function seatLabels(total) {
    var labels = [];
    for (var i = 0; i < total; i++) {
      labels.push(String.fromCharCode(65 + Math.floor(i / 4)) + (i % 4 + 1));
    }
    return labels;
  }

  function limit() {
    return pax || MAX_SEATS;
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function canBook() {
    return bus && bus.Status !== 'Unavailable' && bus.Travel_Date >= today();
  }

  /* ============================== bus picker ============================= */

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
    $('#busName').text(bus.Bus_Name + ' (' + bus.Bus_ID + ')');
    $('#busTags').html(
      (bus.Bus_Type ? '<span class="journey-tag">' + esc(bus.Bus_Type) + '</span>' : '') +
      '<span class="journey-tag">' + esc(bus.Total_Seats) + ' seats</span>' +
      '<span class="journey-tag">LKR ' + esc(Number(bus.Fare).toLocaleString()) + ' / seat</span>'
    );
    $('#busRoute').text(bus.Departure + ' → ' + bus.Destination);
    $('#busDate').text(bus.Travel_Date);
    $('#busTime').text(bus.Departure_Time + ' – ' + bus.Arrival_Time);
  }

  function loadBus() {
    window.clearInterval(timer);
    selected = [];
    if (!busId) {
      bus = null;
      $('#busName').text('Choose a bus');
      $('#busTags').empty();
      $('#busRoute, #busDate').text('—');
      $('#busTime').text('');
      $('#seatGrid').html('<p class="seat-note" style="grid-column:1/-1">Choose a bus above to see its seats.</p>');
      updateSeatAvailability();
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
        bus = null;
        $('#busName').text('Bus ' + busId + ' not found');
        $('#seatGrid').html('<p class="seat-note" style="grid-column:1/-1">No bus with ID ' + esc(busId) + '.</p>');
        updateSeatAvailability();
      });
  }

  /* ============================== seat layout ============================ */

  // Fetches the booked seats and redraws the grid, keeping the user's selection
  function loadSeats(announce) {
    if (!bus) { return; }
    api('/bookings/bus/' + encodeURIComponent(bus.Bus_ID) + '/seats')
      .done(function (seats) {
        booked = seats || [];
        var lost = $.grep(selected, function (s) { return booked.indexOf(s) !== -1; });
        selected = $.grep(selected, function (s) { return booked.indexOf(s) === -1; });
        renderSeats();
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

  function renderSeats() {
    var $grid = $('#seatGrid').empty();
    var open = canBook();

    $.each(seatLabels(bus.Total_Seats), function (i, label) {
      var isBooked = booked.indexOf(label) !== -1;
      var isSelected = selected.indexOf(label) !== -1;
      $('<button type="button" class="seat">')
        .text(label)
        .attr('data-seat', label)
        .addClass(isBooked ? 'booked' : isSelected ? 'selected' : 'available')
        .prop('disabled', isBooked || !open)
        .appendTo($grid);
    });
    $grid.children().hide().fadeIn(200);

    if (!open) {
      showMessage(bus.Status === 'Unavailable'
        ? 'This bus is not taking bookings right now.'
        : 'This bus has already departed.', 'warning');
    }
    updateSeatAvailability();
  }

  // Updates the counts, the selected seat list and the continue button
  function updateSeatAvailability() {
    var total = bus ? bus.Total_Seats : 0;
    $('#availableSeatCount').text(Math.max(total - booked.length - selected.length, 0));
    $('#occupiedSeatCount').text(bus ? booked.length : 0);
    $('#selectedSeatCount').text(selected.length);

    var $list = $('#selectedSeatsList').empty();
    if (!selected.length) {
      $list.html('<p class="empty-seats">No seats selected yet.</p>');
    } else {
      $.each(selected, function (i, s) {
        $('<span class="selected-seat-item">').text(s).appendTo($list);
      });
      if (bus) {
        $list.append('<p class="mt-2 mb-0 fw-bold">Total: LKR ' +
          esc((bus.Fare * selected.length).toLocaleString()) + '</p>');
      }
    }

    $('#paxNote').text(pax
      ? 'Select ' + pax + ' seat' + (pax === 1 ? '' : 's') + ' – ' + selected.length + ' of ' + pax + ' chosen.'
      : 'Select up to ' + MAX_SEATS + ' available seats.');
    $('#continueBooking').prop('disabled', !selected.length || (pax && selected.length !== pax));
  }

  /* ================================ events =============================== */

  function bind() {
    // Select / deselect a seat (event delegation – the grid is rebuilt on refresh)
    $('#seatGrid').on('click', '.seat.available, .seat.selected', function () {
      var label = $(this).data('seat');
      var i = selected.indexOf(label);

      if (i !== -1) {
        selected.splice(i, 1);
        $(this).removeClass('selected').addClass('available');
        showMessage(label + ' deselected.', 'success');
      } else if (selected.length >= limit()) {
        showMessage('You can select ' + limit() + ' seat' + (limit() === 1 ? '' : 's') + ' – deselect one first.', 'warning');
        return;
      } else {
        selected.push(label);
        $(this).removeClass('available').addClass('selected');
        showMessage(label + ' selected.', 'success');
      }
      updateSeatAvailability();
    });

    $('#refreshSeatAvailability').on('click', function () { loadSeats(true); });

    $('#busPicker').on('change', function () {
      busId = $(this).val();
      var url = busId ? '?busId=' + encodeURIComponent(busId) + (pax ? '&pax=' + pax : '') : window.location.pathname;
      window.history.replaceState(null, '', url);
      $('#seatMessage').empty().attr('class', '');
      loadBus();
    });

    // Continue to the booking page with the chosen seats (Member 4)
    $('#continueBooking').on('click', function () {
      window.location.href = 'booking.html?bus=' + encodeURIComponent(bus.Bus_ID) +
        '&seats=' + encodeURIComponent(selected.join(','));
    });
  }

  /* ================================= init ================================ */

  $(function () {
    $.when(
      MF.loadPartial('#navbar', 'partials/navbar.html'),
      MF.loadPartial('#footer', 'partials/footer.html')
    ).always(function () {
      $('.mf-nav .nav-link[data-page="manage-bookings"]').addClass('active').attr('aria-current', 'page');
    });
    bind();
    loadBusPicker();
    loadBus();
  });
})(window, jQuery);
