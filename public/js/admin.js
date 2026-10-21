// admin.js – front-end logic for the admin dashboard (Bus Management)
// jQuery uses are labelled "jQuery Use #n" (see the list in README.md).
(function ($) {
  'use strict';

  var API = '/api/buses';
  var LOGIN_URL = '/api/auth/admin/login';
  var TOKEN_KEY = 'mf_admin_token';

  var state = {
    all: [],      // every bus (used for the summary tiles)
    buses: [],    // buses currently shown (all, or a search result)
    label: 'All buses'
  };
  var modals = {};
  var MODAL_IDS = { bus: '#busModal', schedule: '#scheduleModal', delete: '#deleteModal', login: '#loginModal' };
  var resumeModal = null; // form modal to re-open after the operator signs in

  /* ---------- helpers ---------- */

  // escape API data before it is put into HTML
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    return Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getToken() {
    try { return window.localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(token) {
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* storage blocked – the token just lasts until reload */ }
  }

  // jQuery Use #5 – animation: toast messages fade in, wait, fade out
  function toast(message, type) {
    var $t = $('<div class="mf-toast"></div>')
      .addClass('mf-toast-' + (type || 'info'))
      .text(message)
      .appendTo('#toastBox');
    $t.fadeIn(200).delay(3200).fadeOut(400, function () { $t.remove(); });
  }

  function errorText(xhr) {
    if (xhr.status === 0) return 'Cannot reach the server – is it running?';
    var body = xhr.responseJSON;
    if (body && body.error) {
      if (body.details && body.details.length > 1) {
        return body.details.map(function (d) { return d.message; }).join(' • ');
      }
      return body.error;
    }
    return 'Request failed (' + xhr.status + ')';
  }

  function showModal(name) { modals[name].show(); }
  function hideModal(name) { modals[name].hide(); }

  // Bootstrap supports one open modal at a time: close `from` first, then open `to`
  function swapModal(from, to) {
    var $from = $(MODAL_IDS[from]);
    if ($from.hasClass('show')) {
      $from.one('hidden.bs.modal', function () { showModal(to); });
      hideModal(from);
    } else {
      showModal(to);
    }
  }

  /* ---------- Ajax ---------- */

  // jQuery Use #2 – Ajax: every call sends / receives JSON
  function request(method, url, payload) {
    var opts = { url: url, method: method, dataType: 'json', headers: {} };
    if (payload !== undefined) {
      opts.contentType = 'application/json';
      opts.data = JSON.stringify(payload);
    }
    var token = getToken();
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    return $.ajax(opts);
  }

  // failure handler for write operations; `from` is the modal that was open ('bus', 'schedule' or 'delete')
  function writeFailed(xhr, from) {
    if (xhr.status === 401 || xhr.status === 403) {
      toast('Please sign in as an operator to make changes.', 'error');
      resumeModal = (from === 'bus' || from === 'schedule') ? from : null; // keep the typed data
      swapModal(from, 'login');
      return;
    }
    toast(errorText(xhr), 'error');
  }

  /* ---------- rendering ---------- */

  // jQuery Use #6 – live filtering without reloading: $.grep over the loaded buses
  function visibleBuses() {
    var q = $.trim($('#liveFilter').val()).toLowerCase();
    var type = $('#typeFilter').val();
    var status = $('#statusFilter').val();
    return $.grep(state.buses, function (b) {
      if (type && b.Bus_Type !== type) return false;
      if (status && b.Status !== status) return false;
      if (!q) return true;
      var haystack = [b.Bus_ID, b.Bus_Name, b.Route, b.Departure, b.Destination].join(' ').toLowerCase();
      return haystack.indexOf(q) !== -1;
    });
  }

  function seatClass(b) {
    if (!b.Available_Seats) return 'is-full';
    return b.Available_Seats / b.Total_Seats <= 0.2 ? 'is-low' : '';
  }

  function rowHtml(b) {
    var pct = b.Total_Seats ? Math.round((b.Available_Seats / b.Total_Seats) * 100) : 0;
    var id = esc(b.Bus_ID);
    var badge = b.Status === 'Available' ? 'text-bg-success' : 'text-bg-secondary';
    return '<tr>' +
      '<td class="fw-semibold">' + id + '</td>' +
      '<td>' + esc(b.Bus_Name) + '<div class="small text-muted">' + esc(b.Bus_Type) + '</div></td>' +
      '<td>' + esc(b.Route) + '<div class="small text-muted">' + esc(b.Departure) + ' → ' + esc(b.Destination) + '</div></td>' +
      '<td class="num">' + esc(b.Travel_Date) + '<div class="small text-muted">' + esc(b.Departure_Time) + ' – ' + esc(b.Arrival_Time) + '</div></td>' +
      '<td class="num">' + esc(b.Available_Seats) + ' / ' + esc(b.Total_Seats) +
        '<div class="seat-bar-wrap"><div class="seat-bar ' + seatClass(b) + '" data-pct="' + pct + '"></div></div></td>' +
      '<td class="num text-end">' + money(b.Fare) + '</td>' +
      '<td><span class="badge ' + badge + '">' + esc(b.Status) + '</span></td>' +
      '<td class="text-end text-nowrap mf-actions">' +
        '<button type="button" class="btn btn-sm btn-outline-primary js-edit" data-id="' + id + '" aria-label="Edit ' + id + '">Edit</button> ' +
        '<button type="button" class="btn btn-sm btn-outline-secondary js-schedule" data-id="' + id + '" aria-label="Update schedule of ' + id + '">Schedule</button> ' +
        '<button type="button" class="btn btn-sm btn-outline-danger js-delete" data-id="' + id + '" aria-label="Delete ' + id + '">Delete</button>' +
      '</td></tr>';
  }

  // jQuery Use #3 – dynamic DOM building: the table body is rebuilt from the data
  function render() {
    var list = visibleBuses();
    var $body = $('#busTableBody').empty();

    if (!list.length) {
      var msg = state.buses.length ? 'No buses match the filter.' : 'No buses found.';
      $body.append('<tr><td colspan="8" class="text-center text-muted py-4">' + msg + '</td></tr>');
    } else {
      $body.html($.map(list, rowHtml).join(''));
      // set the bar widths with jQuery (data-pct → CSS width)
      $body.find('.seat-bar').each(function () {
        $(this).css('width', $(this).data('pct') + '%');
      });
    }
    $('#busCount').text(list.length);
    $('#resultLabel').text(state.label);
  }

  // jQuery Use #5 – animation: summary numbers count up to their new value
  function animateNumber($el, to) {
    var from = parseInt($el.text().replace(/,/g, ''), 10) || 0;
    $({ n: from }).animate({ n: to }, {
      duration: 400,
      step: function () { $el.text(Math.round(this.n).toLocaleString('en-US')); },
      complete: function () { $el.text(to.toLocaleString('en-US')); }
    });
  }

  function updateStats() {
    var available = $.grep(state.all, function (b) { return b.Status === 'Available'; }).length;
    var seats = 0;
    $.each(state.all, function (_, b) { seats += b.Status === 'Available' ? Number(b.Available_Seats) || 0 : 0; });
    animateNumber($('#statTotal'), state.all.length);
    animateNumber($('#statAvailable'), available);
    animateNumber($('#statUnavailable'), state.all.length - available);
    animateNumber($('#statSeats'), seats);
  }

  /* ---------- loading data ---------- */

  function showLoading() {
    $('#busTableBody').html('<tr><td colspan="8" class="text-center text-muted py-4">Loading…</td></tr>');
  }

  // GET a list of buses (all buses by default) and show it
  function loadBuses(url, label) {
    showLoading();
    var isAll = !url || url === API;
    return request('GET', url || API)
      .done(function (res) {
        var data = res.data;
        state.buses = Array.isArray(data) ? data : (data ? [data] : []);
        state.label = label || 'All buses';
        if (isAll) { state.all = state.buses.slice(); updateStats(); }
        render();
      })
      .fail(function (xhr) {
        if (xhr.status === 404) { // e.g. no bus with that ID
          state.buses = [];
          state.label = label || 'No result';
          render();
          toast(errorText(xhr), 'info');
          return;
        }
        $('#busTableBody').html('<tr><td colspan="8" class="text-center text-danger py-4">' + esc(errorText(xhr)) + '</td></tr>');
        toast(errorText(xhr), 'error');
      });
  }

  // fills the From / To / Departure inputs with the places already in the database
  function loadLocations() {
    request('GET', API + '/locations').done(function (res) {
      var options = $.map(res.data || [], function (place) {
        return '<option value="' + esc(place) + '"></option>';
      });
      $('#locationList').html(options.join(''));
    });
  }

  function refreshAfterWrite() {
    $('#liveFilter').val('');
    loadBuses();
    loadLocations();
  }

  /* ---------- forms ---------- */

  // jQuery Use #4 – form serialisation: .serializeArray() → JSON object
  function formToObject($form) {
    var obj = {};
    $.each($form.serializeArray(), function (_, field) { obj[field.name] = $.trim(field.value); });
    return obj;
  }

  function resetValidation($form) {
    $form.removeClass('was-validated');
    $form.find('input, select').each(function () { this.setCustomValidity(''); });
  }

  // checks the rules that need two fields; returns true when the form is valid
  function checkForm($form, rules) {
    var form = $form[0];
    resetValidation($form);

    if (rules.times) {
      var dep = $form.find(rules.times[0]).val();
      var arr = $form.find(rules.times[1]);
      if (dep && arr.val() && arr.val() <= dep) arr[0].setCustomValidity('Arrival time must be after departure time');
    }
    if (rules.places) {
      var from = $.trim($form.find('[name="Departure"]').val()).toLowerCase();
      var toField = $form.find('[name="Destination"]');
      if (from && from === $.trim(toField.val()).toLowerCase()) toField[0].setCustomValidity('Destination must be different from departure');
    }
    if (rules.seats) {
      var total = Number($form.find('[name="Total_Seats"]').val());
      var availField = $form.find('[name="Available_Seats"]');
      if (availField.val() !== '' && Number(availField.val()) > total) availField[0].setCustomValidity('Available seats cannot be more than capacity');
    }

    if (!form.checkValidity()) {
      $form.addClass('was-validated');
      form.reportValidity();
      return false;
    }
    return true;
  }

  function busy($btn, isBusy, text) {
    if (isBusy) { $btn.data('label', $btn.text()).prop('disabled', true).text(text); }
    else { $btn.prop('disabled', false).text($btn.data('label') || $btn.text()); }
  }

  function openAdd() {
    var $form = $('#busForm');
    $form[0].reset();
    resetValidation($form);
    $('#editingId').val('');
    $('#busModalTitle').text('Add bus');
    $('#fBusId').prop('readonly', false);
    $('#fAvailable').prop('readonly', false).attr('placeholder', 'Same as capacity');
    $('#availableHelp').text('Leave empty to start with all seats free.');
    showModal('bus');
  }

  function openEdit(id) {
    request('GET', API + '/' + encodeURIComponent(id)).done(function (res) {
      var bus = res.data;
      var $form = $('#busForm');
      $form[0].reset();
      resetValidation($form);
      $.each(bus, function (key, value) { $form.find('[name="' + key + '"]').val(value); });
      $('#editingId').val(bus.Bus_ID);
      $('#busModalTitle').text('Update bus – ' + bus.Bus_ID);
      $('#fBusId').prop('readonly', true);
      $('#fAvailable').prop('readonly', true).attr('placeholder', '');
      $('#availableHelp').text('Managed by the system (capacity minus booked seats).');
      showModal('bus');
    }).fail(function (xhr) { toast(errorText(xhr), 'error'); });
  }

  function openSchedule(id) {
    request('GET', API + '/' + encodeURIComponent(id)).done(function (res) {
      var bus = res.data;
      var $form = $('#scheduleForm');
      resetValidation($form);
      $('#scheduleId').val(bus.Bus_ID);
      $('#scheduleModalTitle').text('Update schedule – ' + bus.Bus_ID);
      $('#scheduleInfo').text(bus.Bus_Name + ' · ' + bus.Route);
      $('#sDate').val(bus.Travel_Date);
      $('#sDepTime').val(bus.Departure_Time);
      $('#sArrTime').val(bus.Arrival_Time);
      showModal('schedule');
    }).fail(function (xhr) { toast(errorText(xhr), 'error'); });
  }

  function openDelete(id) {
    var bus = $.grep(state.buses, function (b) { return b.Bus_ID === id; })[0];
    $('#confirmDeleteBtn').data('id', id);
    $('#deleteText').text('Delete bus ' + id + (bus ? ' (' + bus.Bus_Name + ', ' + bus.Travel_Date + ')' : '') + '? This cannot be undone.');
    showModal('delete');
  }

  /* ---------- search ---------- */

  var FIND_PATHS = { route: '/route/', departure: '/departure/', destination: '/destination/', date: '/date/' };
  var FIND_HINTS = {
    busId: 'e.g. MB1001', route: 'e.g. Colombo - Makubura', departure: 'e.g. Colombo Fort',
    destination: 'e.g. Makubura', date: ''
  };

  function runFind() {
    var mode = $('#findMode').val();
    var value = $.trim($('#findValue').val());
    if (!value) { toast('Enter a value to search for.', 'info'); $('#findValue').trigger('focus'); return; }

    var url = mode === 'busId'
      ? API + '/' + encodeURIComponent(value)
      : API + FIND_PATHS[mode] + encodeURIComponent(value);
    var names = { busId: 'Bus ID', route: 'Route', departure: 'Departure', destination: 'Destination', date: 'Travel date' };
    loadBuses(url, names[mode] + ': ' + value);
  }

  function runAvailable() {
    var params = {};
    $.each(formToObject($('#availableForm')), function (key, value) { if (value !== '') params[key] = value; });
    var summary = $.map(params, function (v, k) { return k + ' ' + v; }).join(', ');
    loadBuses(API + '/available' + ($.isEmptyObject(params) ? '' : '?' + $.param(params)),
      'Available buses' + (summary ? ' (' + summary + ')' : ''));
  }

  /* ---------- operator login ---------- */

  function updateAuthUi() {
    var signedIn = !!getToken();
    $('#authBadge').text(signedIn ? 'Operator signed in' : 'Not signed in')
      .toggleClass('text-bg-success', signedIn).toggleClass('text-bg-secondary', !signedIn);
    $('#loginBtn').toggleClass('d-none', signedIn);
    $('#logoutBtn').toggleClass('d-none', !signedIn);
  }

  /* ---------- events ---------- */

  function bindEvents() {
    // jQuery Use #1 – events and selection (delegated handlers for the buttons inside the table)
    $('#busTableBody')
      .on('click', '.js-edit', function () { openEdit($(this).data('id')); })
      .on('click', '.js-schedule', function () { openSchedule($(this).data('id')); })
      .on('click', '.js-delete', function () { openDelete($(this).data('id')); });

    $('#addBusBtn').on('click', openAdd);

    // live filter
    $('#liveFilter').on('input', render);
    $('#typeFilter, #statusFilter').on('change', render);

    // search forms
    $('#findForm').on('submit', function (e) { e.preventDefault(); runFind(); });
    $('#showAllBtn').on('click', function () { $('#findValue').val(''); loadBuses(); });
    $('#findMode').on('change', function () {
      var mode = $(this).val();
      $('#findValue').attr('type', mode === 'date' ? 'date' : 'text')
        .attr('placeholder', FIND_HINTS[mode]).val('');
    });
    $('#availableForm').on('submit', function (e) { e.preventDefault(); runAvailable(); });
    $('#resetAvailableBtn').on('click', function () { $('#availableForm')[0].reset(); loadBuses(); });

    // jQuery Use #5 – animation: slide the search panel away and back
    $('#toggleSearchBtn').on('click', function () {
      var $btn = $(this);
      $('#searchBody').slideToggle(200, function () {
        var open = $(this).is(':visible');
        $btn.text(open ? 'Hide' : 'Show').attr('aria-expanded', open);
      });
    });

    // add / update bus
    $('#busForm').on('submit', function (e) {
      e.preventDefault();
      var $form = $(this);
      var editingId = $('#editingId').val();
      var isEdit = editingId !== '';
      if (!checkForm($form, { times: ['[name="Departure_Time"]', '[name="Arrival_Time"]'], places: true, seats: !isEdit })) return;

      var data = formToObject($form);
      if (isEdit) { delete data.Bus_ID; delete data.Available_Seats; }
      else if (data.Available_Seats === '') delete data.Available_Seats;

      var $btn = $('#saveBusBtn');
      busy($btn, true, 'Saving…');
      request(isEdit ? 'PUT' : 'POST', isEdit ? API + '/' + encodeURIComponent(editingId) : API, data)
        .done(function (res) {
          hideModal('bus');
          toast(res.message || 'Saved', 'success');
          refreshAfterWrite();
        })
        .fail(function (xhr) { writeFailed(xhr, 'bus'); })
        .always(function () { busy($btn, false); });
    });

    // update schedule
    $('#scheduleForm').on('submit', function (e) {
      e.preventDefault();
      var $form = $(this);
      if (!checkForm($form, { times: ['[name="Departure_Time"]', '[name="Arrival_Time"]'] })) return;

      var $btn = $('#saveScheduleBtn');
      busy($btn, true, 'Saving…');
      request('PATCH', API + '/' + encodeURIComponent($('#scheduleId').val()) + '/schedule', formToObject($form))
        .done(function (res) {
          hideModal('schedule');
          toast(res.message || 'Schedule updated', 'success');
          refreshAfterWrite();
        })
        .fail(function (xhr) { writeFailed(xhr, 'schedule'); })
        .always(function () { busy($btn, false); });
    });

    // delete bus
    $('#confirmDeleteBtn').on('click', function () {
      var id = $(this).data('id');
      var $btn = $(this);
      busy($btn, true, 'Deleting…');
      request('DELETE', API + '/' + encodeURIComponent(id))
        .done(function (res) {
          hideModal('delete');
          toast(res.message || 'Bus deleted', 'success');
          refreshAfterWrite();
        })
        .fail(function (xhr) { writeFailed(xhr, 'delete'); if (xhr.status !== 401 && xhr.status !== 403) hideModal('delete'); })
        .always(function () { busy($btn, false); });
    });

    // operator login / logout
    $('#loginBtn').on('click', function () { resumeModal = null; showModal('login'); });
    $('#logoutBtn').on('click', function () { setToken(''); updateAuthUi(); toast('Signed out', 'info'); });
    $('#loginForm').on('submit', function (e) {
      e.preventDefault();
      var $form = $(this);
      if (!checkForm($form, {})) return;
      var $btn = $('#loginSubmitBtn');
      busy($btn, true, 'Signing in…');
      $.ajax({ url: LOGIN_URL, method: 'POST', contentType: 'application/json', dataType: 'json',
               data: JSON.stringify(formToObject($form)) })
        .done(function (res) {
          var token = res && (res.token || (res.data && res.data.token));
          if (!token) { toast('Login worked but no token was returned.', 'error'); return; }
          setToken(token);
          updateAuthUi();
          $form[0].reset();
          var resume = resumeModal;
          resumeModal = null;
          if (resume) $('#loginModal').one('hidden.bs.modal', function () { showModal(resume); });
          hideModal('login');
          toast('Signed in as operator' + (resume ? ' – press Save again' : ''), 'success');
        })
        .fail(function (xhr) { toast(xhr.status === 401 ? 'Wrong username or password' : errorText(xhr), 'error'); })
        .always(function () { busy($btn, false); });
    });
  }

  /* ---------- start ---------- */

  // jQuery Use #7 – document ready, plus the datalist (autocomplete) filled from the API
  $(function () {
    $.each(MODAL_IDS, function (name, selector) {
      modals[name] = new bootstrap.Modal($(selector)[0]);
    });
    bindEvents();
    updateAuthUi();
    loadBuses();
    loadLocations();
  });

})(jQuery);
