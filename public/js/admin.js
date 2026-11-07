/* admin.js — operator dashboard: login gate, stats, bus CRUD, schedules, bookings.
 * ---------------------------------------------------------------------------
 * This file used to call `MF.*` (js/main.js) and `Api.*` (js/api.js). Both of
 * those are still one-line empty stubs owned by teammates, so the very first
 * statement of the login handler threw `ReferenceError: MF is not defined`
 * and the form silently did nothing. Everything this page needs is therefore
 * defined privately below — no cross-file dependency, and nothing here will
 * collide when a teammate eventually fills those stubs in.
 *
 * The ONE thing it does reuse is the session layer in js/auth.js:
 * MetroFlowAuth.adminLogin() / isAdmin() / logout(), the mf_token + mf_user
 * keys, and the $.ajaxPrefilter that attaches `Authorization: Bearer <token>`
 * to every /api/ call. Credentials are never handled here.
 * ---------------------------------------------------------------------------
 */
/* global jQuery, bootstrap */
(function (window, $) {
  'use strict';

  var API = '/api';
  var Auth = window.MetroFlowAuth || null;

  /* ========================== private helpers ========================== */

  // Everything written into innerHTML goes through this first.
  function esc(value) {
    return $('<div>').text(value == null ? '' : String(value)).html();
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }

  function addDays(ymd, days) {
    var p = String(ymd).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }

  function lkr(amount) {
    var n = Number(amount) || 0;
    return 'LKR ' + n.toLocaleString('en-LK', { maximumFractionDigits: 0 });
  }

  // Compact money for the stat tile, so 1,284,500 does not wrap the card.
  function lkrShort(amount) {
    var n = Number(amount) || 0;
    if (n >= 1000000) { return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M'; }
    if (n >= 1000) { return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'K'; }
    return String(n);
  }

  function fmtDate(ymd, opts) {
    var p = String(ymd || '').split('-');
    if (p.length !== 3) { return esc(ymd); }
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(d.getTime())) { return esc(ymd); }
    return d.toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short' });
  }

  function formToJSON($form) {
    var out = {};
    $.each($form.serializeArray(), function (i, pair) { out[pair.name] = pair.value; });
    return out;
  }

  // Bootstrap validation state on one control. Returns the boolean it was given.
  function setValid($field, ok) {
    $field.toggleClass('is-invalid', !ok).attr('aria-invalid', ok ? 'false' : 'true');
    return !!ok;
  }

  var $toasts = null;
  function toast(message, kind) {
    if (!$toasts) { $toasts = $('#adminToasts'); }
    if (!$toasts.length) { return; }
    var $t = $('<div class="mf-admin-toast"></div>')
      .addClass('is-' + (kind || 'ok'))
      .text(String(message == null ? '' : message));   // .text(): never innerHTML
    $toasts.append($t);
    window.setTimeout(function () { $t.remove(); }, 4200);
  }

  /* ================================ ajax =============================== */
  // auth.js's $.ajaxPrefilter adds the bearer header, so nothing to do here.
  function api(path, method, body) {
    var opts = {
      url: API + path,
      method: method || 'GET',
      dataType: 'json',
      timeout: 15000
    };
    if (body !== undefined) {
      opts.contentType = 'application/json';
      opts.data = JSON.stringify(body);
    }
    return $.ajax(opts);
  }

  function toArray(payload) {
    if ($.isArray(payload)) { return payload; }
    if (payload && $.isArray(payload.data)) { return payload.data; }
    return [];
  }

  // Turn a jqXHR into something worth showing an operator.
  function errorFrom(xhr, what) {
    if (!xhr || xhr.status === 0) {
      return 'Server unreachable, please try again.';
    }
    if (xhr.status === 404 || xhr.status === 405) {
      // The write endpoints live in the team's busRoutes.js, which currently
      // fails to mount, so /api/buses is served by the read-only fallback.
      return (what || 'That action') + ' is not available yet — the API does ' +
        'not expose this endpoint (HTTP ' + xhr.status + ').';
    }
    if (xhr.status === 503) { return 'The database is unavailable right now.'; }
    var body = xhr.responseJSON || {};
    return body.error || body.message || ('Request failed (HTTP ' + xhr.status + ').');
  }

  /* ========================== state + elements ========================= */

  var buses = [];
  var bookings = [];
  var busSort = { key: 'Travel_Date', dir: 1 };
  var bookingLimit = 50;
  var confirmAction = null;
  var editingBus = null;
  var modals = {};

  /* ============================ login gate ============================ */

  function showAlert(message) {
    $('#gateAlertText').text(message || '');
    $('#gateAlert').toggleClass('d-none', !message);
  }

  function gateBusy(busy) {
    $('#aSubmit')
      .prop('disabled', !!busy)
      .attr('aria-busy', busy ? 'true' : 'false')
      .find('.mf-admin-submit-label')
      .text(busy ? 'Signing in…' : 'Log in');
    $('#adminLogin').data('busy', !!busy);
  }

  function showGate(loggedIn) {
    $('#loginGate').toggleClass('d-none', !!loggedIn);
    $('#dashboard').toggleClass('d-none', !loggedIn);

    if (loggedIn) {
      var user = (Auth && Auth.getUser && Auth.getUser()) || {};
      $('#adminName').text(user.Full_Name || user.Email || 'operator');
      loadAll();
    } else {
      $('#aPass').val('');
      gateBusy(false);
    }

    // Keep the shared navbar's right-hand side in step with the session.
    if (Auth && typeof Auth.paintNavbar === 'function') { Auth.paintNavbar(); }
  }

  /**
   * The single sign-out path. Auth.logout() posts to /api/auth/logout and
   * only clears mf_token / mf_user when that settles, so the gate is shown
   * (and the navbar repainted) from its promise rather than immediately —
   * otherwise paintNavbar() reads a session that is still there and leaves
   * the operator pill up after logging out.
   */
  function signOut(message) {
    var finish = function () {
      showGate(false);
      showAlert(message || '');
    };

    if (Auth && typeof Auth.logout === 'function') {
      var pending;
      try { pending = Auth.logout(true); } catch (e) { pending = null; }
      if (pending && typeof pending.always === 'function') {
        pending.always(finish);
        return;
      }
    }
    finish();
  }

  // A 401 from any admin call means the 2-hour token expired mid-session.
  function guard(xhr) {
    if (xhr && xhr.status === 401) {
      signOut('Your session expired. Please sign in again.');
      return true;
    }
    return false;
  }

  function initGate() {
    // Show / hide password.
    $('#aPassEye').on('click', function () {
      var $btn = $(this);
      var show = $('#aPass').attr('type') === 'password';
      $('#aPass').attr('type', show ? 'text' : 'password');
      $btn.attr('aria-pressed', show ? 'true' : 'false')
        .attr('aria-label', show ? 'Hide password' : 'Show password')
        .find('i').toggleClass('bi-eye', !show).toggleClass('bi-eye-slash', show);
    });

    $('#adminLogin').on('input', 'input', function () {
      if ($(this).hasClass('is-invalid')) {
        setValid($(this), true);
        $('#' + this.id + 'Msg').text('');
      }
      showAlert('');
    });

    // Enter inside either field submits, because the button is type="submit"
    // and lives inside this form.
    $('#adminLogin').on('submit', function (event) {
      event.preventDefault();

      var $form = $(this);
      if ($form.data('busy')) { return; }

      var user = $.trim($('#aUser').val());
      var password = $('#aPass').val() || '';

      var userOk = setValid($('#aUser'), !!user);
      var passOk = setValid($('#aPass'), !!password);
      $('#aUserMsg').text(userOk ? '' : 'Enter your username.');
      $('#aPassMsg').text(passOk ? '' : 'Enter your password.');

      if (!userOk || !passOk) {
        $(userOk ? '#aPass' : '#aUser').trigger('focus');
        return;
      }

      if (!Auth || typeof Auth.adminLogin !== 'function') {
        showAlert('Sign-in is unavailable: js/auth.js did not load.');
        return;
      }

      showAlert('');
      gateBusy(true);

      // auth.js owns the request shape and stores mf_token / mf_user.
      Auth.adminLogin(user, password)
        .done(function () {
          gateBusy(false);
          $('#aPass').val('');
          showGate(true);
          toast('Signed in as ' + user);
        })
        .fail(function (xhr) {
          gateBusy(false);
          // Username stays, password is cleared and refocused.
          $('#aPass').val('').trigger('focus');
          showAlert(
            (xhr && (xhr.status === 401 || xhr.status === 403))
              ? 'Invalid username or password'
              : errorFrom(xhr, 'Sign in')
          );
        });
    });

    $('#adminLogout').on('click', function () {
      $(this).prop('disabled', true);
      signOut();
      $('#adminLogout').prop('disabled', false);
      $('#aUser').trigger('focus');
    });
  }

  /* ============================== loading ============================= */

  function loadAll() { loadBuses(); loadBookings(); }

  function skeletonRow(cols, text) {
    return '<tr><td colspan="' + cols + '"><div class="mf-admin-state">' + text + '</div></td></tr>';
  }

  function loadBuses() {
    $('#busRows').html(skeletonRow(8, 'Loading buses…'));
    api('/buses')
      .done(function (res) {
        buses = toArray(res);
        renderBuses();
        renderRoutes();
        renderStats();
      })
      .fail(function (xhr) {
        if (guard(xhr)) { return; }
        buses = [];
        $('#busRows').html(skeletonRow(8,
          '<i class="bi bi-exclamation-triangle" aria-hidden="true"></i>' + esc(errorFrom(xhr, 'Loading buses'))));
        renderStats();
      });
  }

  function loadBookings() {
    $('#bookingRows').html(skeletonRow(9, 'Loading bookings…'));
    api('/bookings')
      .done(function (res) {
        bookings = toArray(res);
        renderBookings();
        renderStats();
      })
      .fail(function (xhr) {
        if (guard(xhr)) { return; }
        bookings = [];
        $('#bookingRows').html(skeletonRow(9,
          '<i class="bi bi-exclamation-triangle" aria-hidden="true"></i>' + esc(errorFrom(xhr, 'Loading bookings'))));
        renderStats();
      });
  }

  /* =============================== stats ============================== */
  /**
   * There is no GET /api/stats on this API, so the four figures are derived
   * from the two collections the dashboard already has.
   */
  function renderStats() {
    var ymd = today();
    var confirmed = $.grep(bookings, function (b) {
      return b && b.Booking_Status !== 'Cancelled';
    });

    var todays = $.grep(confirmed, function (b) { return b && b.Travel_Date === ymd; });

    var revenue = 0;
    $.each(confirmed, function (i, b) { revenue += Number(b.Fare) || 0; });

    var stats = {
      totalBuses: buses.length,
      todaysBookings: todays.length,
      seatsSold: confirmed.length,
      revenue: lkrShort(revenue)
    };

    $('[data-stat]').each(function () {
      var key = $(this).attr('data-stat');
      $(this).text(stats[key] === undefined ? '–' : String(stats[key]));
    });

    $('[data-stat="revenue"]').attr('title', lkr(revenue));
  }

  /* ============================ buses table =========================== */

  function seatBar(b) {
    var total = Number(b.Total_Seats) || 0;
    var left = Number(b.Available_Seats) || 0;
    var soldPct = total ? Math.round(((total - left) / total) * 100) : 0;
    var cls = left === 0 ? ' is-full' : (left <= 10 ? ' is-low' : '');
    return '<div class="mf-admin-bar' + cls + '"><span style="width:' + soldPct + '%"></span></div>';
  }

  function renderBuses() {
    var q = $.trim(String($('#busFilter').val() || '')).toLowerCase();

    var list = $.grep(buses, function (b) {
      if (!q) { return true; }
      return [b.Bus_ID, b.Bus_Name, b.Route, b.Departure, b.Destination]
        .join(' ').toLowerCase().indexOf(q) > -1;
    }).sort(function (a, b) {
      var x = a[busSort.key];
      var y = b[busSort.key];
      return (x > y ? 1 : (x < y ? -1 : 0)) * busSort.dir;
    });

    var $tb = $('#busRows').empty();
    if (!list.length) {
      $tb.html(skeletonRow(8, buses.length ? 'No buses match that filter.' : 'No buses yet.'));
      return;
    }

    var ymd = today();
    $.each(list, function (i, b) {
      var past = String(b.Travel_Date) < ymd;
      $tb.append(
        '<tr data-id="' + esc(b.Bus_ID) + '"' + (past ? ' class="opacity-50"' : '') + '>' +
          '<td class="fw-bold">' + esc(b.Bus_ID) + '</td>' +
          '<td>' + esc(b.Bus_Name) + '</td>' +
          '<td>' + esc(b.Route) + '</td>' +
          '<td class="mf-admin-num">' + esc(fmtDate(b.Travel_Date)) + '</td>' +
          '<td class="mf-admin-num">' + esc(b.Departure_Time) + '–' + esc(b.Arrival_Time) + '</td>' +
          '<td class="mf-admin-num">' +
            '<span' + (Number(b.Available_Seats) === 0 ? ' class="mf-text-red fw-bold"' : '') + '>' +
            esc(b.Available_Seats) + '</span>/' + esc(b.Total_Seats) + seatBar(b) +
          '</td>' +
          '<td class="mf-admin-num">' + esc(lkr(b.Fare)) + '</td>' +
          '<td class="text-end text-nowrap">' +
            '<button class="mf-admin-ic-btn" type="button" data-act="sched" ' +
              'aria-label="Update schedule for ' + esc(b.Bus_ID) + '">' +
              '<i class="bi bi-clock-history" aria-hidden="true"></i></button> ' +
            '<button class="mf-admin-ic-btn" type="button" data-act="edit" ' +
              'aria-label="Edit ' + esc(b.Bus_ID) + '">' +
              '<i class="bi bi-pencil" aria-hidden="true"></i></button> ' +
            '<button class="mf-admin-ic-btn is-danger" type="button" data-act="delete" ' +
              'aria-label="Delete ' + esc(b.Bus_ID) + '">' +
              '<i class="bi bi-trash" aria-hidden="true"></i></button>' +
          '</td>' +
        '</tr>'
      );
    });
  }

  /* ============================ bus add/edit ========================== */

  function openBusForm(bus) {
    editingBus = bus || null;
    var $f = $('#busForm');
    $f[0].reset();
    $f.find('.is-invalid').removeClass('is-invalid').removeAttr('aria-invalid');

    $('#busModalTitle').text(bus ? 'Edit ' + bus.Bus_ID : 'Add bus');
    $('#fBus_ID').prop('readonly', !!bus);

    if (bus) {
      $('#fTravel_Date').removeAttr('min');
      $.each(bus, function (k, v) { $f.find('[name="' + k + '"]').val(v); });
      $('#fAvail').val(bus.Available_Seats + ' / ' + bus.Total_Seats);
    } else {
      $('#fTravel_Date').attr('min', today()).val(addDays(today(), 1));
      $('#fAvail').val('= Total seats');

      var highest = 1000;
      $.each(buses, function (i, b) {
        var n = Number(String(b.Bus_ID).slice(2)) || 0;
        if (n > highest) { highest = n; }
      });
      $('#fBus_ID').val('MB' + (highest + 1));
    }
    modals.bus.show();
  }

  function initBusForm() {
    $('#addBusBtn').on('click', function () { openBusForm(null); });

    $('#busRows').on('click', '[data-act]', function () {
      var id = $(this).closest('tr').attr('data-id');
      var bus = null;
      $.each(buses, function (i, b) { if (b.Bus_ID === id) { bus = b; return false; } return true; });
      if (!bus) { return; }

      var act = $(this).attr('data-act');
      if (act === 'edit') { openBusForm(bus); return; }
      if (act === 'sched') { openSchedule(bus); return; }

      askConfirm('Delete bus ' + bus.Bus_ID + '?',
        'This removes ' + bus.Bus_Name + ' (' + bus.Route + ', ' + bus.Travel_Date +
        '). Buses with confirmed bookings cannot be deleted.',
        function () {
          return api('/buses/' + encodeURIComponent(bus.Bus_ID), 'DELETE')
            .done(function () { toast('Bus ' + bus.Bus_ID + ' deleted'); loadBuses(); });
        });
    });

    // Route auto-fills from the two place fields.
    $('#fDeparture, #fDestination').on('input', function () {
      var a = $.trim(String($('#fDeparture').val() || '')).replace(' Fort', '');
      var b = $.trim(String($('#fDestination').val() || '')).replace(' Fort', '');
      if (a && b) { $('#fRoute').val(a + ' - ' + b); }
    });

    $('#busForm').on('submit', function (event) {
      event.preventDefault();

      var d = formToJSON($(this));
      d.Bus_ID = String(d.Bus_ID || '').toUpperCase();
      d.Total_Seats = Number(d.Total_Seats);
      d.Fare = Number(d.Fare);

      var ok = setValid($('#fBus_ID'), /^[A-Z]{2}\d{3,6}$/.test(d.Bus_ID));
      $.each(['Bus_Name', 'Departure', 'Destination', 'Route', 'Travel_Date', 'Departure_Time'],
        function (i, k) { ok = setValid($('#f' + k), !!d[k]) && ok; });
      ok = setValid($('#fArrival_Time'), !!d.Arrival_Time && d.Arrival_Time > d.Departure_Time) && ok;
      ok = setValid($('#fTotal_Seats'), d.Total_Seats >= 1 && d.Total_Seats <= 52) && ok;
      ok = setValid($('#fFare'), $('#fFare').val() !== '' && d.Fare >= 0) && ok;
      if (!ok) { return; }

      var $btn = $('#saveBus').prop('disabled', true);
      var request = editingBus
        ? api('/buses/' + encodeURIComponent(editingBus.Bus_ID), 'PUT', d)
        : api('/buses', 'POST', d);

      request
        .done(function () {
          modals.bus.hide();
          toast('Bus ' + d.Bus_ID + (editingBus ? ' updated' : ' added'));
          loadBuses();
        })
        .fail(function (xhr) {
          if (guard(xhr)) { return; }
          var details = (xhr.responseJSON || {}).details || (xhr.responseJSON || {}).errors;
          if (details) {
            $.each(details, function (k) { setValid($('#f' + k), false); });
          }
          toast(errorFrom(xhr, editingBus ? 'Updating a bus' : 'Adding a bus'), 'error');
        })
        .always(function () { $btn.prop('disabled', false); });
    });
  }

  /* ============================= schedules ============================ */

  function openSchedule(bus) {
    $('#sBus').val(bus.Bus_ID);
    $('#sDate').val(bus.Travel_Date);
    $('#sDep').val(bus.Departure_Time);
    $('#sArr').val(bus.Arrival_Time).removeClass('is-invalid');
    $('#schedTitle').text('Schedule · ' + bus.Bus_ID + ' (' + bus.Route + ')');
    modals.sched.show();
  }

  function initSchedule() {
    $('#schedForm').on('submit', function (event) {
      event.preventDefault();

      var d = formToJSON($(this));
      var id = d.Bus_ID;
      delete d.Bus_ID;

      if (!setValid($('#sArr'), d.Arrival_Time > d.Departure_Time)) { return; }

      api('/buses/' + encodeURIComponent(id) + '/schedule', 'PATCH', d)
        .done(function () {
          modals.sched.hide();
          toast('Schedule updated for ' + id);
          loadBuses();
          loadBookings();
        })
        .fail(function (xhr) {
          if (guard(xhr)) { return; }
          toast(errorFrom(xhr, 'Updating a schedule'), 'error');
        });
    });

    $('#routeCards').on('click', '[data-sched]', function () {
      var id = $(this).attr('data-sched');
      $.each(buses, function (i, b) {
        if (b.Bus_ID === id) { openSchedule(b); return false; }
        return true;
      });
    });
  }

  // Schedules tab: buses grouped by route.
  function renderRoutes() {
    var groups = {};
    $.each(buses, function (i, b) {
      if (!groups[b.Route]) { groups[b.Route] = []; }
      groups[b.Route].push(b);
    });

    var $wrap = $('#routeCards').empty();
    var routes = Object.keys(groups).sort();

    if (!routes.length) {
      $wrap.html('<div class="col-12"><div class="mf-admin-panel mf-admin-state">' +
        'No routes to show yet.</div></div>');
      return;
    }

    $.each(routes, function (i, route) {
      var list = groups[route].sort(function (a, b) {
        return (a.Travel_Date + a.Departure_Time) > (b.Travel_Date + b.Departure_Time) ? 1 : -1;
      });

      var cheapest = null;
      $.each(list, function (j, b) {
        var f = Number(b.Fare) || 0;
        if (cheapest === null || f < cheapest) { cheapest = f; }
      });

      var items = '';
      $.each(list, function (j, b) {
        items +=
          '<li class="d-flex justify-content-between align-items-center gap-2 py-2 border-bottom">' +
            '<span><b>' + esc(fmtDate(b.Travel_Date)) + '</b> · ' +
            esc(b.Departure_Time) + '–' + esc(b.Arrival_Time) +
            ' <span class="small mf-muted">' + esc(b.Bus_ID) + '</span></span>' +
            '<button class="mf-btn-ghost btn-sm" type="button" data-sched="' + esc(b.Bus_ID) + '">' +
            '<i class="bi bi-clock-history" aria-hidden="true"></i> Reschedule</button>' +
          '</li>';
      });

      $wrap.append(
        '<div class="col-md-6 col-xl-4"><div class="mf-admin-panel h-100">' +
          '<div class="d-flex justify-content-between align-items-center gap-2 mb-2">' +
            '<h3 class="h6 mb-0">' + esc(route) + '</h3>' +
            '<span class="mf-admin-badge is-soft">' + list.length +
            ' trip' + (list.length === 1 ? '' : 's') + '</span>' +
          '</div>' +
          '<div class="small fw-semibold mf-muted mb-2">' +
            esc(list[0].Departure) + ' → ' + esc(list[0].Destination) +
            ' · from ' + esc(lkr(cheapest)) + '</div>' +
          '<ul class="list-unstyled mb-0">' + items + '</ul>' +
        '</div></div>'
      );
    });
  }

  /* =========================== bookings table ========================= */

  function renderBookings() {
    var q = $.trim(String($('#bookingFilter').val() || '')).toLowerCase();
    var status = $('#bookingStatus').val();
    var date = $('#bookingDate').val();

    var list = $.grep(bookings, function (b) {
      if (status && b.Booking_Status !== status) { return false; }
      if (date && b.Travel_Date !== date) { return false; }
      if (!q) { return true; }
      return [b.Booking_ID, b.Passenger_Name, b.Phone, b.Email, b.Bus_ID, b.Seat_Number]
        .join(' ').toLowerCase().indexOf(q) > -1;
    });

    $('#bookingCount').text(list.length + ' booking' + (list.length === 1 ? '' : 's'));

    var $tb = $('#bookingRows').empty();
    if (!list.length) {
      $tb.html(skeletonRow(9, bookings.length ? 'No bookings match those filters.' : 'No bookings yet.'));
      $('#moreBookings').addClass('d-none');
      return;
    }

    $.each(list.slice(0, bookingLimit), function (i, b) {
      var cancelled = b.Booking_Status === 'Cancelled';
      $tb.append(
        '<tr data-id="' + esc(b.Booking_ID) + '">' +
          '<td class="fw-bold">' + esc(b.Booking_ID) + '</td>' +
          '<td>' + esc(b.Passenger_Name) + '</td>' +
          '<td class="small">' + esc(b.Phone) +
            '<br><span class="mf-muted">' + esc(b.Email) + '</span></td>' +
          '<td>' + esc(b.Bus_ID) + '</td>' +
          '<td class="mf-admin-num">' + esc(fmtDate(b.Travel_Date)) + '</td>' +
          '<td>' + esc(b.Seat_Number) + '</td>' +
          '<td class="mf-admin-num">' + esc(lkr(b.Fare)) + '</td>' +
          '<td><span class="mf-admin-badge ' + (cancelled ? 'is-cancelled' : 'is-confirmed') + '">' +
            esc(b.Booking_Status) + '</span></td>' +
          '<td class="text-end text-nowrap">' + (cancelled ? '' :
            '<button class="mf-admin-ic-btn" type="button" data-bk="edit" ' +
              'aria-label="Edit ' + esc(b.Booking_ID) + '">' +
              '<i class="bi bi-pencil" aria-hidden="true"></i></button> ' +
            '<button class="mf-admin-ic-btn is-danger" type="button" data-bk="cancel" ' +
              'aria-label="Cancel ' + esc(b.Booking_ID) + '">' +
              '<i class="bi bi-x-lg" aria-hidden="true"></i></button>') +
          '</td>' +
        '</tr>'
      );
    });

    $('#moreBookings').toggleClass('d-none', list.length <= bookingLimit);
  }

  function initBookings() {
    $('#bookingFilter').on('input', function () { bookingLimit = 50; renderBookings(); });
    $('#bookingStatus, #bookingDate').on('change', function () { bookingLimit = 50; renderBookings(); });
    $('#moreBookings').on('click', function () { bookingLimit += 50; renderBookings(); });

    $('#bookingRows').on('click', '[data-bk]', function () {
      var id = $(this).closest('tr').attr('data-id');
      var bk = null;
      $.each(bookings, function (i, b) { if (b.Booking_ID === id) { bk = b; return false; } return true; });
      if (!bk) { return; }

      if ($(this).attr('data-bk') === 'cancel') {
        askConfirm('Cancel ' + bk.Booking_ID + '?',
          bk.Passenger_Name + ' · seat ' + bk.Seat_Number + ' on ' + bk.Bus_ID +
          '. The seat will be released.',
          function () {
            return api('/bookings/' + encodeURIComponent(bk.Booking_ID) + '/cancel', 'PATCH')
              .done(function () {
                toast('Booking ' + bk.Booking_ID + ' cancelled');
                loadBookings();
                loadBuses();
              });
          });
        return;
      }

      $('#bId').val(bk.Booking_ID);
      $('#bName').val(bk.Passenger_Name);
      $('#bPhone').val(bk.Phone);
      $('#bEmail').val(bk.Email);
      $('#bSeat').val(bk.Seat_Number);
      $('#bBoard').val(bk.Boarding_Point);
      $('#bkTitle').text('Edit ' + bk.Booking_ID);
      modals.bk.show();
    });

    $('#bkForm').on('submit', function (event) {
      event.preventDefault();

      var d = formToJSON($(this));
      var id = d.Booking_ID;
      delete d.Booking_ID;
      d.Seat_Number = String(d.Seat_Number || '').toUpperCase();

      api('/bookings/' + encodeURIComponent(id), 'PUT', d)
        .done(function () {
          modals.bk.hide();
          toast('Booking ' + id + ' updated');
          loadBookings();
        })
        .fail(function (xhr) {
          if (guard(xhr)) { return; }
          toast(errorFrom(xhr, 'Updating a booking'), 'error');
        });
    });
  }

  /* ============================== confirm ============================= */

  function askConfirm(title, message, action) {
    $('#confirmTitle').text(title);
    $('#confirmText').text(message);        // .text(): API data, never innerHTML
    confirmAction = action;
    modals.confirm.show();
  }

  function initConfirm() {
    $('#confirmYes').on('click', function () {
      if (typeof confirmAction !== 'function') { return; }
      var $btn = $(this).prop('disabled', true);

      confirmAction()
        .done(function () { modals.confirm.hide(); })
        .fail(function (xhr) {
          modals.confirm.hide();
          if (!guard(xhr)) { toast(errorFrom(xhr, 'That action'), 'error'); }
        })
        .always(function () { $btn.prop('disabled', false); });
    });
  }

  /* ================================ boot ============================== */

  function initTables() {
    $('#busFilter').on('input', renderBuses);
    $('#tabBuses thead').on('click', 'th[data-sort]', function () {
      var key = $(this).attr('data-sort');
      busSort = { key: key, dir: busSort.key === key ? -busSort.dir : 1 };
      renderBuses();
    });
    $('#refreshAll').on('click', loadAll);
  }

  $(function () {
    if (!$('#adminLogin').length) { return; }   // not the admin page

    Auth = window.MetroFlowAuth || null;

    modals.bus = bootstrap.Modal.getOrCreateInstance('#busModal');
    modals.sched = bootstrap.Modal.getOrCreateInstance('#schedModal');
    modals.confirm = bootstrap.Modal.getOrCreateInstance('#confirmModal');
    modals.bk = bootstrap.Modal.getOrCreateInstance('#bkModal');

    initGate();
    initTables();
    initBusForm();
    initSchedule();
    initBookings();
    initConfirm();

    // A stored token is not trusted on sight: it is verified against
    // GET /api/auth/me before the dashboard is shown, so an expired or
    // tampered token lands on the login card instead of a broken dashboard.
    var hasAdminToken = Auth && Auth.isLoggedIn && Auth.isLoggedIn() &&
      Auth.isAdmin && Auth.isAdmin();

    if (!hasAdminToken) {
      showGate(false);
      return;
    }

    api('/auth/me')
      .done(function (res) {
        var user = res && res.data && res.data.user;
        if (user && user.Role === 'admin') {
          showGate(true);
        } else {
          signOut('That account is not an operator account.');
        }
      })
      .fail(function (xhr) {
        if (xhr.status === 401) {
          signOut('Your session expired. Please sign in again.');
        } else {
          // The API is down, not the session – keep the token and say so.
          showGate(false);
          showAlert(errorFrom(xhr, 'Verifying your session'));
        }
      });
  });

}(window, jQuery));
