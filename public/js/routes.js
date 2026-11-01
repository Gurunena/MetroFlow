// routes.js – front-end logic for the Routes & Timetable page (Route & Schedule Management)
(function ($) {
  'use strict';

  var API = '/api/schedules';
  var rows = []; // last search result (used by the live filter)

  // escape API data before it is put into HTML
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) {
    return Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function errorText(xhr) {
    var body = xhr && xhr.responseJSON;
    return (body && body.error) || 'Could not reach the server. Please try again.';
  }
  function messageRow(cols, text) {
    return '<tr><td colspan="' + cols + '"><div class="mf-state">' + esc(text) + '</div></td></tr>';
  }

  /* ---------- route summary ---------- */

  // jQuery Use #2 – Ajax: $.getJSON, JSON in and out
  function loadRoutes() {
    $.getJSON(API + '/routes')
      .done(function (res) {
        var list = res.data || [];
        if (!list.length) { $('#routeBody').html(messageRow(5, 'No upcoming routes.')); return; }
        // jQuery Use #3 – dynamic DOM building
        var html = $.map(list, function (r) {
          var fare = r.minFare === r.maxFare ? money(r.minFare) : money(r.minFare) + ' – ' + money(r.maxFare);
          return '<tr>' +
            '<td class="fw-semibold">' + esc(r.Route) +
              '<div class="small text-muted">' + esc(r.Departure) + ' → ' + esc(r.Destination) + '</div></td>' +
            '<td class="num text-end">' + esc(r.trips) + '</td>' +
            '<td class="num text-end">' + fare + '</td>' +
            '<td class="num text-end">' + esc(r.seatsLeft) + '</td>' +
            '<td class="num">' + esc(r.nextDeparture) + '</td></tr>';
        }).join('');
        $('#routeBody').html(html);
      })
      .fail(function (xhr) { $('#routeBody').html(messageRow(5, errorText(xhr))); });
  }

  /*--- timetable --*/

  function renderTimetable() {
    var q = $.trim($('#ttLive').val()).toLowerCase();
    // jQuery Use #6 – live filtering without a reload
    var shown = $.grep(rows, function (b) {
      return !q || [b.Bus_ID, b.Bus_Name, b.Route, b.Departure, b.Destination].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    $('#ttCount').text(shown.length);
    if (!shown.length) { $('#ttBody').html(messageRow(7, 'No trips match your search.')); return; }
    var html = $.map(shown, function (b) {
      var open = b.Status === 'Available' && b.Available_Seats > 0;
      var action = open
        ? '<a class="btn btn-sm mf-btn-red" href="seats.html?bus=' + encodeURIComponent(b.Bus_ID) + '">Book</a>'
        : '<span class="badge text-bg-secondary">' + (b.Status === 'Available' ? 'Full' : 'Unavailable') + '</span>';
      return '<tr>' +
        '<td class="num">' + esc(b.Travel_Date) + '</td>' +
        '<td class="num">' + esc(b.Departure_Time) + ' – ' + esc(b.Arrival_Time) + '</td>' +
        '<td>' + esc(b.Bus_Name) + '<div class="small text-muted">' + esc(b.Bus_ID) + ' · ' + esc(b.Bus_Type) + '</div></td>' +
        '<td>' + esc(b.Route) + '<div class="small text-muted">' + esc(b.Departure) + ' → ' + esc(b.Destination) + '</div></td>' +
        '<td class="num text-end">' + esc(b.Available_Seats) + ' / ' + esc(b.Total_Seats) + '</td>' +
        '<td class="num text-end">' + money(b.Fare) + '</td>' +
        '<td class="text-end">' + action + '</td></tr>';
    }).join('');
    $('#ttBody').hide().html(html).fadeIn(150); // jQuery Use #5 – effects
  }

  function searchTimetable() {
    // jQuery Use #4 – form serialisation: .serializeArray() -> query string (blank fields skipped)
    var params = {};
    $.each($('#ttForm').serializeArray(), function (_, f) {
      var v = $.trim(f.value);
      if (v) params[f.name] = v;
    });
    $('#ttBody').html(messageRow(7, 'Loading…'));
    $.getJSON(API, params)
      .done(function (res) { rows = res.data || []; renderTimetable(); })
      .fail(function (xhr) { rows = []; $('#ttCount').text(0); $('#ttBody').html(messageRow(7, errorText(xhr))); });
  }

  function loadLocations() {
    $.getJSON('/api/buses/locations').done(function (res) {
      $('#locationList').html($.map(res.data || [], function (p) { return '<option value="' + esc(p) + '">'; }).join(''));
    });
  }

  /* ---------- start ---------- */

  $(function () { // jQuery Use #7 – $(document).ready + partials via .load()
    $('#navbar').load('partials/navbar.html');
    $('#footer').load('partials/footer.html');

    $('#ttForm').on('submit', function (e) { e.preventDefault(); searchTimetable(); });
    $('#ttReset').on('click', function () { $('#ttForm')[0].reset(); $('#ttLive').val(''); searchTimetable(); });
    $('#ttLive').on('input', renderTimetable);

    loadRoutes();
    loadLocations();
    searchTimetable();
  });
})(jQuery);
