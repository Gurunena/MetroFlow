/** admin.js — operator dashboard: login gate, KPIs, bus CRUD, schedules, booking management (all Ajax, no reloads). */
/* global $, Api, MF, bootstrap */
$(function () {
  const busModal = new bootstrap.Modal('#busModal');
  const schedModal = new bootstrap.Modal('#schedModal');
  const confirmModal = new bootstrap.Modal('#confirmModal');
  const bkModal = new bootstrap.Modal('#bkModal');
  let buses = [];
  let bookings = [];
  let busSort = { key: 'Travel_Date', dir: 1 };
  let bookingLimit = 50;
  let confirmAction = null;
  let editingBus = null;

  /* ---------------- Auth gate ---------------- */
  const token = () => { try { return sessionStorage.getItem('mf_admin_token'); } catch (e) { return null; } };
  function showGate(loggedIn) {
    $('#loginGate').toggleClass('d-none', loggedIn);
    $('#dashboard').toggleClass('d-none', !loggedIn);
    if (loggedIn) { $('#adminName').text(MF.store.get('mf_admin_user', 'admin', true)); loadAll(); }
  }
  $('#adminLogin').on('submit', function (e) {
    e.preventDefault();
    const body = MF.formToJSON($(this));
    const userOk = MF.setValid($('#aUser'), !!body.username);
    const passOk = MF.setValid($('#aPass'), !!body.password);
    if (!userOk || !passOk) return;
    Api.auth.adminLogin(body)
      .done((res) => {
        try { sessionStorage.setItem('mf_admin_token', res.data.token); } catch (err) { /* ignore */ }
        MF.store.set('mf_admin_user', res.data.username, true);
        MF.toast('Welcome, ' + res.data.username);
        showGate(true);
      })
      .fail((err) => { MF.toast(err.message, 'error'); $('#aPass').val('').addClass('is-invalid'); });
  });
  $('#adminLogout').on('click', () => {
    try { sessionStorage.removeItem('mf_admin_token'); } catch (e) { /* ignore */ }
    showGate(false);
  });
  // Any 401 from an admin call → back to login
  const guard = (err) => {
    if (err.status === 401) { MF.toast('Session expired — please log in again.', 'error'); try { sessionStorage.removeItem('mf_admin_token'); } catch (e) { /* ignore */ } showGate(false); return true; }
    return false;
  };

  /* ---------------- Loading ---------------- */
  function loadAll() { loadStats(); loadBuses(); loadBookings(); }
  $('#refreshAll').on('click', loadAll);

  function loadStats() {
    Api.stats().done((res) => {
      $('#kpis .n').each(function () { $(this).data('count', res.data[$(this).data('k')]); });
      MF.countUp($('#kpis .n'));
    });
  }

  function loadBuses() {
    $('#busRows').html('<tr><td colspan="8"><div class="skeleton" style="height:120px"></div></td></tr>');
    Api.buses.all().done((res) => { buses = res.data; renderBuses(); renderRoutes(); });
  }

  function loadBookings() {
    $('#bookingRows').html('<tr><td colspan="9"><div class="skeleton" style="height:120px"></div></td></tr>');
    Api.bookings.all().done((res) => { bookings = res.data; renderBookings(); });
  }

  /* ---------------- Buses table ---------------- */
  // jQuery Use #3 — table rows rebuilt from JSON
  function renderBuses() {
    const q = $.trim($('#busFilter').val()).toLowerCase();
    const list = buses
      .filter((b) => !q || [b.Bus_ID, b.Bus_Name, b.Route, b.Departure, b.Destination].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (a[busSort.key] > b[busSort.key] ? 1 : a[busSort.key] < b[busSort.key] ? -1 : 0) * busSort.dir);
    const $tb = $('#busRows').empty();
    if (!list.length) return $tb.html('<tr><td colspan="8" class="text-center py-4">No buses match.</td></tr>');
    list.forEach((b) => {
      const past = b.Travel_Date < MF.today();
      $tb.append(
        '<tr data-id="' + MF.esc(b.Bus_ID) + '"' + (past ? ' class="opacity-50"' : '') + '>' +
          '<td class="fw-bold">' + MF.esc(b.Bus_ID) + '</td><td>' + MF.esc(b.Bus_Name) + '</td><td>' + MF.esc(b.Route) + '</td>' +
          '<td>' + MF.fmtDate(b.Travel_Date, { day: 'numeric', month: 'short' }) + '</td><td>' + b.Departure_Time + '–' + b.Arrival_Time + '</td>' +
          '<td><span class="' + (b.Available_Seats === 0 ? 'text-red' : '') + '">' + b.Available_Seats + '</span>/' + b.Total_Seats + '</td>' +
          '<td>' + MF.lkr(b.Fare) + '</td>' +
          '<td class="text-end text-nowrap">' +
            '<button class="icon-btn" data-act="sched" title="Update schedule" aria-label="Update schedule for ' + MF.esc(b.Bus_ID) + '"><i class="bi bi-clock-history"></i></button> ' +
            '<button class="icon-btn" data-act="edit" title="Edit" aria-label="Edit ' + MF.esc(b.Bus_ID) + '"><i class="bi bi-pencil"></i></button> ' +
            '<button class="icon-btn danger" data-act="delete" title="Delete" aria-label="Delete ' + MF.esc(b.Bus_ID) + '"><i class="bi bi-trash"></i></button>' +
          '</td></tr>'
      );
    });
  }
  // jQuery Use #6 — live filter + clickable column sorting without reload
  $('#busFilter').on('input', renderBuses);
  $('#tabBuses thead').on('click', 'th[data-sort]', function () {
    const key = $(this).data('sort');
    busSort = { key, dir: busSort.key === key ? -busSort.dir : 1 };
    renderBuses();
  });

  /* ---------------- Bus form (add / edit) ---------------- */
  $('#addBusBtn').on('click', () => openBusForm(null));
  $('#busRows').on('click', '[data-act]', function () {
    const bus = buses.find((b) => b.Bus_ID === $(this).closest('tr').data('id'));
    const act = $(this).data('act');
    if (act === 'edit') openBusForm(bus);
    if (act === 'sched') openSchedule(bus);
    if (act === 'delete') askConfirm('Delete bus ' + bus.Bus_ID + '?', 'This removes ' + MF.esc(bus.Bus_Name) + ' (' + MF.esc(bus.Route) + ', ' + bus.Travel_Date + '). Buses with confirmed bookings cannot be deleted.', () =>
      Api.buses.remove(bus.Bus_ID).done(() => { MF.toast('Bus ' + bus.Bus_ID + ' deleted'); loadBuses(); loadStats(); }));
  });

  function openBusForm(bus) {
    editingBus = bus;
    const $f = $('#busForm');
    $f[0].reset();
    $f.find('.is-invalid, .is-valid').removeClass('is-invalid is-valid');
    $('#busModalTitle').text(bus ? 'Edit ' + bus.Bus_ID : 'Add bus');
    $('#fBus_ID').prop('readonly', !!bus);
    $('#fTravel_Date').attr('min', bus ? null : MF.today());
    if (bus) {
      $.each(bus, (k, v) => $f.find('[name="' + k + '"]').val(v));
      $('#fAvail').val(bus.Available_Seats + ' / ' + bus.Total_Seats);
    } else {
      $('#fTravel_Date').val(MF.addDays(MF.today(), 1));
      $('#fAvail').val('= Total seats');
      const next = Math.max(1000, ...buses.map((b) => Number(b.Bus_ID.slice(2)) || 0)) + 1;
      $('#fBus_ID').val('MB' + next);
    }
    busModal.show();
  }

  // Auto-fill Route from Departure/Destination
  $('#fDeparture, #fDestination').on('input', () => {
    const a = $.trim($('#fDeparture').val()).replace(' Fort', '');
    const b = $.trim($('#fDestination').val()).replace(' Fort', '');
    if (a && b) $('#fRoute').val(a + ' - ' + b);
  });

  $('#busForm').on('submit', function (e) {
    e.preventDefault();
    const d = MF.formToJSON($(this));
    d.Bus_ID = d.Bus_ID.toUpperCase();
    d.Total_Seats = Number(d.Total_Seats);
    d.Fare = Number(d.Fare);
    let ok = true;
    ok = MF.setValid($('#fBus_ID'), /^[A-Z]{2}\d{3,6}$/.test(d.Bus_ID)) && ok;
    ['Bus_Name', 'Departure', 'Destination', 'Route', 'Travel_Date', 'Departure_Time'].forEach((k) => { ok = MF.setValid($('#f' + k), !!d[k]) && ok; });
    ok = MF.setValid($('#fArrival_Time'), !!d.Arrival_Time && d.Arrival_Time > d.Departure_Time) && ok;
    ok = MF.setValid($('#fTotal_Seats'), d.Total_Seats >= 1 && d.Total_Seats <= 52) && ok;
    ok = MF.setValid($('#fFare'), d.Fare >= 0 && $('#fFare').val() !== '') && ok;
    if (!ok) return;

    const req = editingBus ? Api.buses.update(editingBus.Bus_ID, d) : Api.buses.create(d);
    req.done((res) => {
      busModal.hide();
      MF.toast(res.message + ': ' + res.data.Bus_ID);
      loadBuses();
      loadStats();
    }).fail((err) => {
      if (guard(err)) return;
      $.each(err.errors || {}, (k) => MF.setValid($('#f' + k), false));
      MF.toast(err.message, 'error');
    });
  });

  /* ---------------- Schedules ---------------- */
  function openSchedule(bus) {
    $('#sBus').val(bus.Bus_ID);
    $('#sDate').val(bus.Travel_Date);
    $('#sDep').val(bus.Departure_Time);
    $('#sArr').val(bus.Arrival_Time).removeClass('is-invalid');
    $('#schedTitle').text('Schedule · ' + bus.Bus_ID + ' (' + bus.Route + ')');
    schedModal.show();
  }
  $('#schedForm').on('submit', function (e) {
    e.preventDefault();
    const d = MF.formToJSON($(this));
    const id = d.Bus_ID;
    delete d.Bus_ID;
    if (!MF.setValid($('#sArr'), d.Arrival_Time > d.Departure_Time)) return;
    Api.buses.schedule(id, d)
      .done(() => { schedModal.hide(); MF.toast('Schedule updated for ' + id); loadBuses(); loadBookings(); })
      .fail((err) => { if (!guard(err)) MF.toast(err.message, 'error'); });
  });

  // Routes & Schedules tab: buses grouped by route
  function renderRoutes() {
    const groups = {};
    buses.forEach((b) => { (groups[b.Route] = groups[b.Route] || []).push(b); });
    const $wrap = $('#routeCards').empty();
    Object.keys(groups).sort().forEach((route) => {
      const list = groups[route].sort((a, b) => (a.Travel_Date + a.Departure_Time > b.Travel_Date + b.Departure_Time ? 1 : -1));
      const items = list.map((b) =>
        '<li class="d-flex justify-content-between align-items-center py-2 border-bottom"><span><b>' + MF.fmtDate(b.Travel_Date, { day: 'numeric', month: 'short' }) + '</b> · ' + b.Departure_Time + '–' + b.Arrival_Time +
        ' <span class="small text-muted-mf">' + MF.esc(b.Bus_ID) + '</span></span>' +
        '<button class="btn btn-ghost btn-sm" data-sched="' + MF.esc(b.Bus_ID) + '"><i class="bi bi-clock-history"></i> Reschedule</button></li>').join('');
      $wrap.append(
        '<div class="col-md-6 col-xl-4"><div class="mf-card"><div class="d-flex justify-content-between align-items-center mb-2">' +
        '<h3 class="h6 mb-0">' + MF.esc(route) + '</h3><span class="badge-soft">' + list.length + ' trip' + (list.length > 1 ? 's' : '') + '</span></div>' +
        '<div class="small fw-semibold text-muted-mf mb-2">' + MF.esc(list[0].Departure) + ' → ' + MF.esc(list[0].Destination) + ' · from ' + MF.lkr(Math.min(...list.map((b) => b.Fare))) + '</div>' +
        '<ul class="list-unstyled mb-0">' + items + '</ul></div></div>'
      );
    });
  }
  $('#routeCards').on('click', '[data-sched]', function () { openSchedule(buses.find((b) => b.Bus_ID === $(this).data('sched'))); });

  /* ---------------- Bookings table ---------------- */
  function renderBookings() {
    const q = $.trim($('#bookingFilter').val()).toLowerCase();
    const st = $('#bookingStatus').val();
    const dt = $('#bookingDate').val();
    const list = bookings.filter((b) =>
      (!st || b.Booking_Status === st) && (!dt || b.Travel_Date === dt) &&
      (!q || [b.Booking_ID, b.Passenger_Name, b.Phone, b.Email, b.Bus_ID, b.Seat_Number].join(' ').toLowerCase().includes(q)));
    $('#bookingCount').text(list.length + ' booking' + (list.length === 1 ? '' : 's'));
    const $tb = $('#bookingRows').empty();
    if (!list.length) $tb.html('<tr><td colspan="9" class="text-center py-4">No bookings match.</td></tr>');
    list.slice(0, bookingLimit).forEach((b) => {
      const cancelled = b.Booking_Status === 'Cancelled';
      $tb.append(
        '<tr data-id="' + MF.esc(b.Booking_ID) + '"><td class="fw-bold">' + MF.esc(b.Booking_ID) + '</td><td>' + MF.esc(b.Passenger_Name) + '</td>' +
        '<td class="small">' + MF.esc(b.Phone) + '<br><span class="text-muted-mf">' + MF.esc(b.Email) + '</span></td>' +
        '<td>' + MF.esc(b.Bus_ID) + '</td><td>' + MF.fmtDate(b.Travel_Date, { day: 'numeric', month: 'short' }) + '</td><td>' + MF.esc(b.Seat_Number) + '</td>' +
        '<td>' + MF.lkr(b.Fare) + '</td><td><span class="badge-status ' + (cancelled ? 'badge-cancelled' : 'badge-confirmed') + '">' + b.Booking_Status + '</span></td>' +
        '<td class="text-end text-nowrap">' + (cancelled ? '' :
          '<button class="icon-btn" data-bk="edit" title="Edit" aria-label="Edit ' + MF.esc(b.Booking_ID) + '"><i class="bi bi-pencil"></i></button> ' +
          '<button class="icon-btn danger" data-bk="cancel" title="Cancel" aria-label="Cancel ' + MF.esc(b.Booking_ID) + '"><i class="bi bi-x-lg"></i></button>') + '</td></tr>'
      );
    });
    $('#moreBookings').toggleClass('d-none', list.length <= bookingLimit);
  }
  $('#bookingFilter').on('input', () => { bookingLimit = 50; renderBookings(); });
  $('#bookingStatus, #bookingDate').on('change', () => { bookingLimit = 50; renderBookings(); });
  $('#moreBookings').on('click', () => { bookingLimit += 50; renderBookings(); });

  $('#bookingRows').on('click', '[data-bk]', function () {
    const b = bookings.find((x) => x.Booking_ID === $(this).closest('tr').data('id'));
    if ($(this).data('bk') === 'cancel') {
      askConfirm('Cancel ' + b.Booking_ID + '?', MF.esc(b.Passenger_Name) + ' · seat ' + b.Seat_Number + ' on ' + b.Bus_ID + '. The seat will be released.', () =>
        Api.bookings.cancel(b.Booking_ID).done(() => { MF.toast('Booking ' + b.Booking_ID + ' cancelled'); loadBookings(); loadBuses(); loadStats(); }));
    } else {
      $('#bId').val(b.Booking_ID); $('#bName').val(b.Passenger_Name); $('#bPhone').val(b.Phone);
      $('#bEmail').val(b.Email); $('#bSeat').val(b.Seat_Number); $('#bBoard').val(b.Boarding_Point);
      $('#bkTitle').text('Edit ' + b.Booking_ID);
      bkModal.show();
    }
  });
  $('#bkForm').on('submit', function (e) {
    e.preventDefault();
    const d = MF.formToJSON($(this));
    const id = d.Booking_ID;
    delete d.Booking_ID;
    d.Seat_Number = d.Seat_Number.toUpperCase();
    Api.bookings.update(id, d)
      .done(() => { bkModal.hide(); MF.toast('Booking ' + id + ' updated'); loadBookings(); })
      .fail((err) => MF.toast(err.message, 'error'));
  });

  /* ---------------- Confirm helper ---------------- */
  function askConfirm(title, html, action) {
    $('#confirmTitle').text(title);
    $('#confirmText').html(html);
    confirmAction = action;
    confirmModal.show();
  }
  $('#confirmYes').on('click', function () {
    const $b = $(this).prop('disabled', true);
    confirmAction()
      .done(() => confirmModal.hide())
      .fail((err) => { if (!guard(err)) MF.toast(err.message, 'error'); confirmModal.hide(); })
      .always(() => $b.prop('disabled', false));
  });

  showGate(!!token());
});
