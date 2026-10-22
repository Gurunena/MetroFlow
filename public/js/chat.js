// chat.js – front-end logic for the travel assistant chat widget
// ---------------------------------------------------------------------------
// Public API: MetroFlowChat.open() / .close() / .send(text)
//
// Every reply goes through the single entry point getBotReply(text), which
// always returns a Promise. The intent matching is rule-based (no paid AI
// API), so swapping in an LLM later means replacing only that one function.
//
// Depends on window.MetroFlow (helpers + city list + mock buses) from
// home.js, which the script order in index.html / assistant.html loads first.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API_BASE = '/api';
  var STORE_KEY = 'mf-chat-v1';

  var MF = window.MetroFlow = window.MetroFlow || {};

  // Same guarded definitions as home.js so the widget also works on a page
  // that loads chat.js on its own.
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
      return $.get(url).done(function (html) { $host.html(html); });
    };
  }

  var esc = function (v) { return MF.escape(v); };

  var CITIES = MF.CITIES || ['Colombo', 'Kandy', 'Galle', 'Jaffna', 'Matara', 'Ella'];

  /* ============================== data access ============================ */

  function request(path) {
    if (window.Api && typeof window.Api.get === 'function') {
      return window.Api.get(path);
    }
    return $.ajax({ url: API_BASE + path, method: 'GET', dataType: 'json', timeout: 8000 });
  }

  function toArray(payload) {
    if ($.isArray(payload)) { return payload; }
    if (payload && $.isArray(payload.data)) { return payload.data; }
    if (payload && $.isArray(payload.buses)) { return payload.buses; }
    return [];
  }

  function unwrap(payload) {
    if (payload && payload.data && !$.isArray(payload.data)) { return payload.data; }
    return payload;
  }

  var busCache = null;

  // Resolves with the timetable – from /api/buses/available, or the mock
  // fleet when the API is unreachable, so the assistant never dead-ends.
  function fetchBuses() {
    if (busCache) { return $.Deferred().resolve(busCache).promise(); }

    return request('/buses/available').then(function (payload) {
      var buses = toArray(payload);
      busCache = buses.length ? buses : (MF.MOCK_BUSES || []);
      return busCache;
    }, function () {
      busCache = MF.MOCK_BUSES || [];
      return $.Deferred().resolve(busCache).promise();
    });
  }

  // Route-specific endpoint, falling back to filtering the full timetable.
  function fetchRoute(from, to) {
    var route = from + ' - ' + to;

    return request('/buses/route/' + encodeURIComponent(route)).then(function (payload) {
      var buses = toArray(payload);
      return buses.length ? buses : filterRoute(null, from, to);
    }, function () {
      return fetchBuses().then(function (all) { return filterRoute(all, from, to); });
    });
  }

  function filterRoute(all, from, to) {
    function go(list) {
      return $.grep(list, function (b) {
        var matchFrom = !from || same(b.Departure, from);
        var matchTo = !to || same(b.Destination, to);
        return matchFrom && matchTo;
      });
    }
    if (all) { return go(all); }
    return fetchBuses().then(go);
  }

  // Loose city comparison – "Colombo Fort" and "Colombo" are the same stop.
  function same(a, b) {
    if (!a || !b) { return false; }
    a = String(a).toLowerCase();
    b = String(b).toLowerCase();
    return a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  /* ============================ text parsing ============================= */

  function iso(date) {
    return date.getFullYear() + '-' +
      ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
      ('0' + date.getDate()).slice(-2);
  }

  function dayOffset(days) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
  }

  var WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  // Understands: YYYY-MM-DD, today, tonight, tomorrow, day after tomorrow,
  // and weekday names (next occurrence). Returns an ISO date or null.
  function parseDate(text) {
    var explicit = /(\d{4}-\d{2}-\d{2})/.exec(text);
    if (explicit) { return explicit[1]; }

    if (/\bday after tomorrow\b/.test(text)) { return iso(dayOffset(2)); }
    if (/\btomorrow\b|\btmrw\b/.test(text)) { return iso(dayOffset(1)); }
    if (/\btoday\b|\btonight\b|\bnow\b/.test(text)) { return iso(dayOffset(0)); }

    for (var i = 0; i < WEEKDAYS.length; i++) {
      if (new RegExp('\\b' + WEEKDAYS[i] + '\\b').test(text)) {
        var diff = (i - new Date().getDay() + 7) % 7;
        return iso(dayOffset(diff === 0 ? 7 : diff));
      }
    }
    return null;
  }

  // Pulls an origin/destination pair out of the sentence. Prefers the
  // "<a> to <b>" shape, otherwise takes the cities in the order they appear.
  function parseCities(text) {
    var found = [];

    $.each(CITIES, function (i, city) {
      var at = text.toLowerCase().indexOf(city.toLowerCase());
      if (at > -1) { found.push({ city: city, at: at, len: city.length }); }
    });

    // Drop "Colombo" when "Colombo Fort" already matched at the same spot.
    found.sort(function (a, b) { return a.at - b.at || b.len - a.len; });
    var picked = [];
    $.each(found, function (i, item) {
      var overlaps = false;
      $.each(picked, function (j, kept) {
        if (item.at < kept.at + kept.len && kept.at < item.at + item.len) { overlaps = true; }
      });
      if (!overlaps) { picked.push(item); }
    });

    if (picked.length >= 2) {
      // "<a> to <b>" – split on the separator and keep the stated order.
      var sep = /\s(?:to|->|–|—)\s/i.exec(text);
      if (sep) {
        var at = sep.index;
        var before = $.grep(picked, function (p) { return p.at < at; });
        var after = $.grep(picked, function (p) { return p.at >= at; });
        if (before.length && after.length) {
          return { from: before[before.length - 1].city, to: after[0].city };
        }
      }
      return { from: picked[0].city, to: picked[1].city };
    }

    if (picked.length === 1) {
      // One city only – the preposition in front of it decides the direction.
      // "cheapest to Jaffna" is a destination, "buses from Galle" an origin.
      var city = picked[0];
      var lead = text.slice(Math.max(0, city.at - 14), city.at).toLowerCase();
      if (/\b(?:to|towards|into|reach)\s+(?:the\s+)?$/.test(lead)) {
        return { from: null, to: city.city };
      }
      return { from: city.city, to: null };
    }

    return { from: null, to: null };
  }

  function parseBookingId(text) {
    var m = /\b(BK[-_ ]?[A-Z0-9]{2,})\b/i.exec(text);
    return m ? m[1].replace(/[-_ ]/, '').toUpperCase() : null;
  }

  /* ============================ reply building =========================== */

  function searchUrl(from, to, date) {
    return 'search.html?from=' + encodeURIComponent(from || '') +
      '&to=' + encodeURIComponent(to || '') +
      '&date=' + encodeURIComponent(date || '') +
      '&pax=1';
  }

  // One mini bus card. Values are escaped because they come off the wire.
  function busCard(bus) {
    var left = Number(bus.Available_Seats) || 0;
    var seatCls = MF.seatClass ? MF.seatClass(left) : '';
    var seatTxt = MF.seatLabel ? MF.seatLabel(left) : left + ' seats left';
    var fare = MF.formatFare ? MF.formatFare(bus.Fare) : 'LKR ' + bus.Fare;
    var dur = MF.duration ? MF.duration(bus.Departure_Time, bus.Arrival_Time) : '';

    return '<a class="mfc-bus" href="' +
        esc(searchUrl(bus.Departure, bus.Destination, bus.Travel_Date)) + '">' +
        '<span class="mfc-bus-top">' +
          '<span class="mfc-bus-name">' + esc(bus.Bus_Name) + '</span>' +
          '<span class="mfc-bus-fare">' + esc(fare) + '</span>' +
        '</span>' +
        '<span class="mfc-bus-meta">' + esc(bus.Departure) + ' → ' + esc(bus.Destination) +
          ' · ' + esc(bus.Departure_Time) + '–' + esc(bus.Arrival_Time) +
          (dur ? ' · ' + esc(dur) : '') + '</span>' +
        '<span class="mfc-bus-meta">' + esc(bus.Travel_Date) + ' · ' + esc(bus.Bus_ID) + '</span>' +
        '<span class="mfc-bus-seats ' + seatCls + '">' + esc(seatTxt) + '</span>' +
      '</a>';
  }

  function cardsHtml(buses) {
    return $.map(buses.slice(0, 3), busCard).join('');
  }

  function reply(text, cards, chips) {
    return { html: text + (cards ? cards : ''), chips: chips || null };
  }

  var DEFAULT_CHIPS = [
    'Colombo to Kandy tomorrow',
    'Cheapest fares',
    'Seats available today',
    'How do I cancel?'
  ];

  /* ------------------------------- intents ------------------------------- */

  function intentGreeting() {
    return $.Deferred().resolve(reply(
      '<strong>Ayubowan!</strong> I am Metro AI. I can find buses, compare fares, ' +
      'check seats and look up a booking. Try <em>"Colombo to Kandy tomorrow"</em>.',
      null, DEFAULT_CHIPS
    )).promise();
  }

  function intentThanks() {
    return $.Deferred().resolve(reply(
      'Happy to help — safe travels! 🚌', null,
      ['Find another bus', 'Cheapest fares']
    )).promise();
  }

  function intentCancel() {
    return $.Deferred().resolve(reply(
      'To cancel a booking:<br>1. Open <a href="my-trips.html">My Trips</a>.<br>' +
      '2. Enter your Booking ID (it starts with <strong>BK</strong>).<br>' +
      '3. Choose <strong>Cancel booking</strong> and confirm.<br>' +
      'Cancellations made more than 6 hours before departure are refunded in full.',
      null, ['Look up my booking', 'Find a bus']
    )).promise();
  }

  function intentBooking(id) {
    return request('/bookings/' + encodeURIComponent(id)).then(function (payload) {
      var b = unwrap(payload);
      if (!b || !b.Booking_ID) {
        return reply('I could not find a booking with ID <strong>' + esc(id) + '</strong>. ' +
          'Please double-check it, or try <a href="my-trips.html">My Trips</a>.',
          null, DEFAULT_CHIPS);
      }
      var fare = MF.formatFare ? MF.formatFare(b.Fare) : 'LKR ' + b.Fare;
      return reply(
        'Booking <strong>' + esc(b.Booking_ID) + '</strong><br>' +
        'Passenger: ' + esc(b.Passenger_Name) + '<br>' +
        'Trip: ' + esc(b.Boarding_Point) + ' → ' + esc(b.Destination) + '<br>' +
        'Date: ' + esc(b.Travel_Date) + ' · Seat ' + esc(b.Seat_Number) + '<br>' +
        'Bus: ' + esc(b.Bus_ID) + ' · Fare: ' + esc(fare) + '<br>' +
        'Status: <strong>' + esc(b.Booking_Status) + '</strong>',
        null, ['How do I cancel?', 'Find a bus']
      );
    }, function () {
      return reply(
        'I could not reach the booking service just now. You can still check ' +
        '<a href="my-trips.html">My Trips</a> with your Booking ID <strong>' + esc(id) + '</strong>.',
        null, DEFAULT_CHIPS
      );
    });
  }

  // Shared lookup behind "find bus", "cheapest", "timings" and "seats".
  function lookupBuses(parsed, mode) {
    var from = parsed.from;
    var to = parsed.to;
    var date = parsed.date;

    var source = (from && to) ? fetchRoute(from, to) : fetchBuses();

    return source.then(function (buses) {
      var list = buses || [];

      // Narrow by whichever parts of the trip the user actually gave us.
      if (from || to) {
        list = $.grep(list, function (b) {
          return (!from || same(b.Departure, from)) && (!to || same(b.Destination, to));
        });
      }
      // Only claim a date if services actually run on it – otherwise keep
      // the route results and say plainly that the date was empty.
      var dateApplied = false;
      if (date) {
        var onDate = $.grep(list, function (b) { return b.Travel_Date === date; });
        if (onDate.length) {
          list = onDate;
          dateApplied = true;
        }
      }

      var where = (from && to)
        ? esc(from) + ' → ' + esc(to)
        : (from ? 'from ' + esc(from) : (to ? 'to ' + esc(to) : 'across the network'));
      var when = dateApplied ? ' on ' + esc(date) : '';
      // Shown when the user named a date that has no departures.
      var missed = (date && !dateApplied)
        ? 'Nothing is scheduled ' + where + ' on <strong>' + esc(date) + '</strong>. Closest I have:<br>'
        : '';

      if (!list.length) {
        return reply(
          'I could not find a service ' + where + (date ? ' on ' + esc(date) : '') + '. ' +
          'Try another date, or <a href="' + esc(searchUrl(from, to, date)) + '">open the full search</a>.',
          null, DEFAULT_CHIPS
        );
      }

      if (mode === 'cheapest') {
        list = list.slice().sort(function (a, b) { return (Number(a.Fare) || 0) - (Number(b.Fare) || 0); });
        var best = list[0];
        var bestFare = MF.formatFare ? MF.formatFare(best.Fare) : 'LKR ' + best.Fare;
        return reply(
          missed + 'The best fare ' + where + when + ' is <strong>' + esc(bestFare) +
          '</strong> on ' + esc(best.Bus_Name) + '.',
          cardsHtml(list),
          ['Seats available today', 'Show timings']
        );
      }

      if (mode === 'seats') {
        list = list.slice().sort(function (a, b) {
          return (Number(b.Available_Seats) || 0) - (Number(a.Available_Seats) || 0);
        });
        var total = 0;
        $.each(list, function (i, b) { total += Number(b.Available_Seats) || 0; });
        return reply(
          missed + '<strong>' + total + ' seat' + (total === 1 ? '' : 's') + '</strong> still open ' +
          where + when + ', across ' + list.length +
          ' service' + (list.length === 1 ? '' : 's') + '.',
          cardsHtml(list),
          ['Cheapest fares', 'How do I cancel?']
        );
      }

      if (mode === 'timings') {
        list = list.slice().sort(function (a, b) {
          return String(a.Departure_Time).localeCompare(String(b.Departure_Time));
        });
        return reply(
          missed + 'Departures ' + where + when + ':',
          cardsHtml(list),
          ['Cheapest fares', 'Seats available today']
        );
      }

      // mode === 'find'
      return reply(
        missed || ('I found <strong>' + list.length + '</strong> service' +
          (list.length === 1 ? '' : 's') + ' ' + where + when + ':'),
        cardsHtml(list) +
        '<a class="mfc-bus" href="' + esc(searchUrl(from, to, date)) + '">' +
          '<span class="mfc-bus-name">See all results and pick a seat →</span></a>',
        ['Cheapest fares', 'Show timings', 'Seats available today']
      );
    });
  }

  function intentFallback() {
    return $.Deferred().resolve(reply(
      'I did not quite catch that. I can help with:<br>' +
      '• Finding a bus — <em>"Colombo to Galle on Friday"</em><br>' +
      '• Fares — <em>"cheapest to Jaffna"</em><br>' +
      '• Timings and seats — <em>"seats available tomorrow"</em><br>' +
      '• A booking — just paste your <strong>BK…</strong> ID',
      null, DEFAULT_CHIPS
    )).promise();
  }

  /* ---------------------- the single reply entry point ------------------- */
  // Returns a Promise resolving to { html, chips }. Replace the body with an
  // LLM call later and the rest of the widget keeps working unchanged.
  function getBotReply(text) {
    var raw = $.trim(String(text || ''));
    var low = raw.toLowerCase();

    var bookingId = parseBookingId(raw);
    if (bookingId) { return intentBooking(bookingId); }

    if (/\bcancel|\brefund|\bchange my booking\b/.test(low)) { return intentCancel(); }

    var parsed = parseCities(raw);
    parsed.date = parseDate(low);

    if (/\bcheap|\bcheapest|\blowest|\bbudget|\baffordab|\bbest fare|\bfare\b|\bprice|\bcost|\bhow much\b/.test(low)) {
      return lookupBuses(parsed, 'cheapest');
    }
    if (/\bseat|\bavailab|\bfull\b|\bsold out\b|\bvacan/.test(low)) {
      return lookupBuses(parsed, 'seats');
    }
    if (/\btime|\btiming|\bschedule|\bdepart|\bleave|\barriv|\bwhen\b/.test(low)) {
      return lookupBuses(parsed, 'timings');
    }
    if ((parsed.from && parsed.to) || parsed.date ||
        /\bbus|\broute|\btravel|\btrip|\bjourney|\bgo to\b|\bfind\b/.test(low)) {
      return lookupBuses(parsed, 'find');
    }
    if (/\bthank|\bthanks|\bthx\b|\bcheers\b|\bappreciate/.test(low)) { return intentThanks(); }
    if (/\bhi\b|\bhey\b|\bhello\b|\bayubowan\b|good (morning|afternoon|evening)/.test(low)) {
      return intentGreeting();
    }

    return intentFallback();
  }

  /* ================================= view ================================ */

  var $panel, $fab, $body, $chips, $form, $input, $send;
  var history = [];
  var inlineMode = false;

  function now() {
    return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function scrollToEnd() {
    if ($body && $body.length) { $body.scrollTop($body[0].scrollHeight); }
  }

  // html is already escaped/assembled by the callers.
  function appendRow(role, html, time) {
    $('<div class="mfc-row"></div>')
      .addClass(role === 'user' ? 'mfc-row-user' : 'mfc-row-bot')
      .append($('<div class="mfc-bubble"></div>').html(html))
      .append($('<div class="mfc-time"></div>').text(time || now()))
      .appendTo($body);
    scrollToEnd();
  }

  function renderChips(list) {
    $chips.empty();
    $.each(list || DEFAULT_CHIPS, function (i, label) {
      $('<button class="mfc-chip" type="button"></button>').text(label).appendTo($chips);
    });
  }

  function showTyping() {
    $('<div class="mfc-row mfc-row-bot" id="mfcTyping"></div>')
      .append('<div class="mfc-typing"><span></span><span></span><span></span></div>')
      .appendTo($body);
    scrollToEnd();
  }

  function hideTyping() { $('#mfcTyping').remove(); }

  /* ------------------------------ storage -------------------------------- */

  function save() {
    try {
      window.sessionStorage.setItem(STORE_KEY, JSON.stringify(history.slice(-40)));
    } catch (err) {
      // Private mode or a full quota – the chat just will not persist.
    }
  }

  function restore() {
    try {
      var saved = JSON.parse(window.sessionStorage.getItem(STORE_KEY) || '[]');
      if ($.isArray(saved) && saved.length) { return saved; }
    } catch (err) {
      // Corrupt or blocked storage – start a fresh conversation.
    }
    return null;
  }

  function paintHistory() {
    $body.empty();
    $.each(history, function (i, row) {
      // User turns are stored as plain text and escaped on the way back in.
      appendRow(row.role, row.role === 'user' ? esc(row.text) : row.text, row.time);
    });
  }

  /* ----------------------------- conversation ---------------------------- */

  var busy = false;

  function send(text) {
    var message = $.trim(String(text || ''));
    if (!message || busy) { return; }

    busy = true;
    $send.prop('disabled', true);

    appendRow('user', esc(message));
    history.push({ role: 'user', text: message, time: now() });
    save();

    $chips.empty();
    showTyping();

    // A short beat so the typing indicator reads as a real reply.
    var minDelay = $.Deferred();
    window.setTimeout(function () { minDelay.resolve(); }, 450);

    $.when(getBotReply(message), minDelay).done(function (res) {
      hideTyping();
      var html = (res && res.html) || 'Sorry, something went wrong.';
      appendRow('bot', html);
      history.push({ role: 'bot', text: html, time: now() });
      save();
      renderChips(res && res.chips);
    }).fail(function () {
      hideTyping();
      var html = 'I hit a problem answering that. Please try again in a moment.';
      appendRow('bot', html);
      history.push({ role: 'bot', text: html, time: now() });
      save();
      renderChips(DEFAULT_CHIPS);
    }).always(function () {
      busy = false;
      $send.prop('disabled', false);
      $input.trigger('focus');
    });
  }

  function open() {
    if (!$panel || !$panel.length) { return; }
    $panel.addClass('mfc-open');
    $fab.attr('aria-expanded', 'true');
    if (!inlineMode) { $panel.attr('aria-modal', 'true'); }
    scrollToEnd();
    window.setTimeout(function () { $input.trigger('focus'); }, 260);
  }

  function close() {
    if (!$panel || !$panel.length || inlineMode) { return; }
    $panel.removeClass('mfc-open').attr('aria-modal', 'false');
    $fab.attr('aria-expanded', 'false').trigger('focus');
  }

  /* ================================= boot ================================ */

  function bind() {
    $panel = $('#chatPanel');
    $fab = $('#chatFab');
    $body = $('#chatBody');
    $chips = $('#chatChips');
    $form = $('#chatForm');
    $input = $('#chatInput');
    $send = $form.find('.mfc-send');

    if (!$panel.length) { return; }

    $fab.on('click', open);
    $panel.find('.mfc-close').on('click', close);

    $form.on('submit', function (e) {
      e.preventDefault();
      var text = $input.val();
      $input.val('');
      send(text);
    });

    // Quick-reply chips are rebuilt every turn, so delegate from the holder.
    $chips.on('click', '.mfc-chip', function () {
      send($(this).text());
    });

    // Escape closes the floating widget.
    $(document).on('keydown.mfc', function (e) {
      if (e.key === 'Escape' && $panel.hasClass('mfc-open')) { close(); }
    });

    var saved = restore();
    if (saved) {
      history = saved;
      paintHistory();
      renderChips(DEFAULT_CHIPS);
    } else {
      getBotReply('hello').done(function (res) {
        appendRow('bot', res.html);
        history.push({ role: 'bot', text: res.html, time: now() });
        save();
        renderChips(res.chips);
      });
    }

    if (inlineMode) { open(); }
  }

  $(function () {
    // The mount is always #chatWidget. On assistant.html it sits inside
    // .mfc-page, which is what switches chat.css to the full-page view.
    if (!$('#chatWidget').length) { return; }
    inlineMode = $('#chatWidget').closest('.mfc-page').length > 0;

    $.when(MF.loadPartial('#chatWidget', 'partials/chat-widget.html')).always(bind);
  });

  window.MetroFlowChat = {
    open: open,
    close: close,
    send: send,
    getBotReply: getBotReply
  };

}(window, jQuery));
