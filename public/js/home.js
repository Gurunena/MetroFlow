// home.js – front-end logic for the home page
// ---------------------------------------------------------------------------
// Everything lives inside the MetroFlowHome IIFE: no globals are created other
// than window.MetroFlowHome and the small shared window.MetroFlow namespace
// (partial loader + formatters) that chat.js also reuses.
//
// js/api.js and js/main.js are still empty stubs owned by teammates, so this
// file carries its own $.ajax wrapper and its own partial loader. Both are
// written so that a later Api.get / main.js loader takes precedence.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API_BASE = '/api';

  /* ===================== shared namespace & tiny helpers ================= */

  var MF = window.MetroFlow = window.MetroFlow || {};

  // Escape anything that ends up in innerHTML – API text is never trusted.
  if (typeof MF.escape !== 'function') {
    MF.escape = function (value) {
      return $('<div>').text(value == null ? '' : String(value)).html();
    };
  }

  // Inject a partial once. Skips the fetch when main.js already filled the
  // container, so adding a loader there later causes no double-load.
  if (typeof MF.loadPartial !== 'function') {
    MF.loadPartial = function (selector, url) {
      var $host = $(selector);
      if (!$host.length || $.trim($host.html()) !== '') {
        return $.Deferred().resolve(false).promise();
      }
      return $.get(url).done(function (html) {
        $host.html(html);
      }).fail(function () {
        // A partial failing is not fatal – the page still works without it.
        $host.attr('data-partial-failed', url);
      });
    };
  }

  // Thin Ajax wrapper. Uses the shared Api helper from api.js when a teammate
  // fills it in, otherwise falls back to $.ajax directly.
  function request(path) {
    if (window.Api && typeof window.Api.get === 'function') {
      return window.Api.get(path);
    }
    return $.ajax({
      url: API_BASE + path,
      method: 'GET',
      dataType: 'json',
      timeout: 8000
    });
  }

  // The API shape is not finalised yet, so accept [], {data:[]} or
  // {success:true, data:[]} and always hand back a plain array.
  function toArray(payload) {
    if ($.isArray(payload)) { return payload; }
    if (payload && $.isArray(payload.data)) { return payload.data; }
    if (payload && $.isArray(payload.buses)) { return payload.buses; }
    return [];
  }

  function iso(date) {
    var d = date.getFullYear() + '-';
    d += ('0' + (date.getMonth() + 1)).slice(-2) + '-';
    return d + ('0' + date.getDate()).slice(-2);
  }

  function addDays(days) {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
  }

  MF.formatFare = function (fare) {
    var n = Number(fare) || 0;
    return 'LKR ' + n.toLocaleString('en-LK', { maximumFractionDigits: 0 });
  };

  // "06:30" + "09:40" -> "3h 10m" (wraps past midnight for night services).
  MF.duration = function (from, to) {
    var a = /^(\d{1,2}):(\d{2})/.exec(from || '');
    var b = /^(\d{1,2}):(\d{2})/.exec(to || '');
    if (!a || !b) { return '—'; }
    var mins = (b[1] * 60 + Number(b[2])) - (a[1] * 60 + Number(a[2]));
    if (mins < 0) { mins += 24 * 60; }
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return (h ? h + 'h' : '') + (m ? (h ? ' ' : '') + m + 'm' : (h ? '' : '0m'));
  };

  MF.seatClass = function (left) {
    if (left <= 0) { return 'mf-seats-out'; }
    return left <= 10 ? 'mf-seats-low' : 'mf-seats-ok';
  };

  MF.seatLabel = function (left) {
    if (left <= 0) { return 'Sold out'; }
    return left + ' seat' + (left === 1 ? '' : 's') + ' left';
  };

  /* ============================ mock fallback ============================ */
  // Used when /api is unreachable (rule 4) so the page always renders.
  // Exact field names from the Bus schema.
  var MOCK_BUSES = [
    { Bus_ID: 'MF-101', Bus_Name: 'Metro Express',   Route: 'Colombo - Kandy',          Departure: 'Colombo',      Destination: 'Kandy',         Travel_Date: iso(addDays(0)), Departure_Time: '06:30', Arrival_Time: '09:40', Total_Seats: 48, Available_Seats: 12, Fare: 1850 },
    { Bus_ID: 'MF-102', Bus_Name: 'Southern Breeze', Route: 'Colombo - Galle',          Departure: 'Colombo',      Destination: 'Galle',         Travel_Date: iso(addDays(0)), Departure_Time: '07:15', Arrival_Time: '09:30', Total_Seats: 44, Available_Seats: 26, Fare: 1450 },
    { Bus_ID: 'MF-103', Bus_Name: 'Northern Star',   Route: 'Colombo - Jaffna',         Departure: 'Colombo',      Destination: 'Jaffna',        Travel_Date: iso(addDays(1)), Departure_Time: '21:00', Arrival_Time: '05:30', Total_Seats: 52, Available_Seats: 8,  Fare: 3200 },
    { Bus_ID: 'MF-104', Bus_Name: 'Hill Country',    Route: 'Kandy - Nuwara Eliya',     Departure: 'Kandy',        Destination: 'Nuwara Eliya',  Travel_Date: iso(addDays(1)), Departure_Time: '08:00', Arrival_Time: '11:15', Total_Seats: 40, Available_Seats: 19, Fare: 1250 },
    { Bus_ID: 'MF-105', Bus_Name: 'East Coast Link', Route: 'Colombo - Trincomalee',    Departure: 'Colombo',      Destination: 'Trincomalee',   Travel_Date: iso(addDays(1)), Departure_Time: '20:30', Arrival_Time: '04:45', Total_Seats: 48, Available_Seats: 31, Fare: 2750 },
    { Bus_ID: 'MF-106', Bus_Name: 'Coastal Rider',   Route: 'Galle - Matara',           Departure: 'Galle',        Destination: 'Matara',        Travel_Date: iso(addDays(0)), Departure_Time: '10:00', Arrival_Time: '11:20', Total_Seats: 36, Available_Seats: 4,  Fare: 620 },
    { Bus_ID: 'MF-107', Bus_Name: 'Heritage Line',   Route: 'Colombo - Anuradhapura',   Departure: 'Colombo',      Destination: 'Anuradhapura',  Travel_Date: iso(addDays(2)), Departure_Time: '06:00', Arrival_Time: '10:30', Total_Seats: 48, Available_Seats: 22, Fare: 2100 },
    { Bus_ID: 'MF-108', Bus_Name: 'Ella Explorer',   Route: 'Kandy - Ella',             Departure: 'Kandy',        Destination: 'Ella',          Travel_Date: iso(addDays(2)), Departure_Time: '07:45', Arrival_Time: '12:50', Total_Seats: 40, Available_Seats: 15, Fare: 1680 },
  ];
  MF.MOCK_BUSES = MOCK_BUSES;

  // Cities offered by the autocomplete and understood by the chatbot.
  var CITIES = [
    'Colombo', 'Colombo Fort', 'Kandy', 'Galle', 'Jaffna', 'Negombo',
    'Nuwara Eliya', 'Ella', 'Matara', 'Trincomalee', 'Anuradhapura',
    'Batticaloa', 'Kurunegala', 'Badulla', 'Ratnapura', 'Hambantota'
  ];
  MF.CITIES = CITIES;

  var prefersReducedMotion =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ======================================================================= */
  var MetroFlowHome = {};

  // ---------------------------------------------------------------------
  // jQuery Use #1 – Swap From/To with a rotate animation
  // ---------------------------------------------------------------------
  function initSwap() {
    $('#swapBtn').on('click', function () {
      var $btn = $(this);
      var $from = $('#from');
      var $to = $('#to');
      var held = $from.val();

      $from.val($to.val());
      $to.val(held);

      // Toggle the class so the 180° rotation plays in both directions.
      $btn.toggleClass('mf-spin');
      clearFieldError($from);
      clearFieldError($to);
    });
  }

  // ---------------------------------------------------------------------
  // jQuery Use #2 – City autocomplete (keyboard + click, closes on outside click)
  // ---------------------------------------------------------------------
  function initAutocomplete() {
    $('#from, #to').each(function () {
      var $input = $(this);
      var $list = $('<ul class="mf-ac" role="listbox" hidden></ul>')
        .attr('id', $input.attr('id') + 'Ac')
        .appendTo($input.closest('.mf-field'));

      // Set while we hand focus back after a pick, so the focus handler
      // below does not immediately reopen the list we just closed.
      var suppressOpen = false;

      function close() {
        $list.attr('hidden', true).empty();
        $input.attr('aria-expanded', 'false');
      }

      function choose($item) {
        $input.val($item.data('city'));
        clearFieldError($input);
        close();
        suppressOpen = true;
        $input.trigger('focus');
        window.setTimeout(function () { suppressOpen = false; }, 150);
      }

      function open(term) {
        var needle = $.trim(term).toLowerCase();
        var matches = $.grep(CITIES, function (city) {
          return !needle || city.toLowerCase().indexOf(needle) === 0;
        }).slice(0, 7);

        $list.empty();

        if (!matches.length) {
          $list.append('<li class="mf-ac-empty">No matching city</li>');
        } else {
          $.each(matches, function (i, city) {
            $('<li role="presentation"></li>')
              .append(
                $('<button type="button" class="mf-ac-item" role="option"></button>')
                  .attr('aria-selected', 'false')
                  .data('city', city)
                  .append('<i class="bi bi-geo-alt" aria-hidden="true"></i>')
                  .append(document.createTextNode(city))
              )
              .appendTo($list);
          });
        }

        $list.removeAttr('hidden');
        $input.attr('aria-expanded', 'true');
      }

      $input.on('input focus', function () {
        if (suppressOpen) { return; }
        open($input.val());
      });

      // Keyboard navigation.
      $input.on('keydown', function (e) {
        var $items = $list.find('.mf-ac-item');
        var idx = $items.index($items.filter('.mf-active'));

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!$items.length) { open($input.val()); return; }
          var next = e.key === 'ArrowDown' ? idx + 1 : idx - 1;
          if (next >= $items.length) { next = 0; }
          if (next < 0) { next = $items.length - 1; }
          $items.removeClass('mf-active').attr('aria-selected', 'false');
          $items.eq(next).addClass('mf-active').attr('aria-selected', 'true');
        } else if (e.key === 'Enter') {
          if (idx > -1) {
            e.preventDefault();
            choose($items.eq(idx));
          }
        } else if (e.key === 'Escape') {
          close();
        }
      });

      // Click / tap a suggestion. Delegated so re-rendered items keep working.
      $list.on('click', '.mf-ac-item', function () { choose($(this)); });
    });

    // Close any open list when the click lands outside its field.
    $(document).on('click', function (e) {
      if (!$(e.target).closest('.mf-field').length) {
        $('.mf-ac').attr('hidden', true).empty();
        $('#from, #to').attr('aria-expanded', 'false');
      }
    });
  }

  // ---------------------------------------------------------------------
  // jQuery Use #3 – Search form validation, then redirect to search.html
  // ---------------------------------------------------------------------
  function clearFieldError($field) {
    $field.removeClass('is-invalid').removeAttr('aria-invalid');
  }

  function setFieldError($field, message) {
    $field.addClass('is-invalid').attr('aria-invalid', 'true');
    if (message) {
      $field.siblings('.mf-invalid').text(message);
    }
  }

  function initSearchForm() {
    var $form = $('#searchForm');
    if (!$form.length) { return; }

    // Default the date to today and block past dates in the native picker.
    var today = iso(addDays(0));
    $('#date').attr('min', today);
    if (!$('#date').val()) { $('#date').val(today); }

    // Clear the error state as soon as the field is edited.
    $form.on('input change', 'input, select', function () { clearFieldError($(this)); });

    $form.on('submit', function (e) {
      e.preventDefault();

      var $from = $('#from');
      var $to = $('#to');
      var $date = $('#date');
      var $pax = $('#pax');

      var from = $.trim($from.val());
      var to = $.trim($to.val());
      var date = $date.val();
      var pax = parseInt($pax.val(), 10);
      var ok = true;

      if (!from) {
        setFieldError($from, 'Please choose a departure city.');
        ok = false;
      }
      if (!to) {
        setFieldError($to, 'Please choose a destination.');
        ok = false;
      }
      // From must differ from To.
      if (from && to && from.toLowerCase() === to.toLowerCase()) {
        setFieldError($to, 'Destination must differ from departure.');
        ok = false;
      }
      // Date must not be in the past.
      if (!date) {
        setFieldError($date, 'Please pick a travel date.');
        ok = false;
      } else if (date < today) {
        setFieldError($date, 'Pick today or a later date.');
        ok = false;
      }
      // Passengers 1–6.
      if (!(pax >= 1 && pax <= 6)) {
        setFieldError($pax, 'Between 1 and 6 passengers.');
        ok = false;
      }

      if (!ok) {
        $form.find('.is-invalid').first().trigger('focus');
        return;
      }

      window.location.href = 'search.html?from=' + encodeURIComponent(from) +
        '&to=' + encodeURIComponent(to) +
        '&date=' + encodeURIComponent(date) +
        '&pax=' + encodeURIComponent(pax);
    });
  }

  // ---------------------------------------------------------------------
  // jQuery Use #4 – Ajax: popular route card + popular routes grid
  // ---------------------------------------------------------------------

  function searchUrl(bus) {
    return 'search.html?from=' + encodeURIComponent(bus.Departure) +
      '&to=' + encodeURIComponent(bus.Destination) +
      '&date=' + encodeURIComponent(bus.Travel_Date) +
      '&pax=1';
  }

  // Cover photos for the route cards. Only these four Unsplash images are
  // confirmed to resolve, so destinations are grouped by the character of the
  // place rather than mapped one-to-one. The alt text describes what is
  // actually in the photo, not the destination, because one photo serves
  // several cities. Drop a per-city entry into DESTINATION_PHOTO when you
  // have a specific image; the onerror fallback covers anything that 404s.
  var PHOTOS = {
    coast:    { id: 'photo-1580910527739-556eb89f9d65', alt: 'Palm-fringed beach in Sri Lanka' },
    cultural: { id: 'photo-1665849050332-8d5d7e59afb6', alt: 'Buddhist temple architecture in Sri Lanka' },
    hills:    { id: 'photo-1566296314736-6eaac1ca0cb9', alt: 'Blue train crossing a viaduct in Sri Lanka\'s hill country' },
    heritage: { id: 'photo-1612862862126-865765df2ded', alt: 'Rock fortress rising above the Sri Lankan jungle' }
  };

  var DESTINATION_PHOTO = {
    'Kandy': 'cultural', 'Anuradhapura': 'cultural', 'Badulla': 'cultural',
    'Galle': 'coast', 'Matara': 'coast', 'Trincomalee': 'coast',
    'Negombo': 'coast', 'Batticaloa': 'coast', 'Hambantota': 'coast', 'Jaffna': 'coast',
    'Nuwara Eliya': 'hills', 'Ella': 'hills', 'Ratnapura': 'hills', 'Kurunegala': 'hills'
  };

  function destinationPhoto(city) {
    var photo = PHOTOS[DESTINATION_PHOTO[city]] || PHOTOS.heritage;
    return {
      url: 'https://images.unsplash.com/' + photo.id + '?auto=format&fit=crop&w=600&q=70',
      alt: photo.alt
    };
  }

  // Templated markup for one card in the Popular Routes grid.
  function routeCardHtml(bus) {
    var e = MF.escape;
    var left = Number(bus.Available_Seats) || 0;
    var soldOut = left <= 0;

    var photo = destinationPhoto(bus.Destination);

    return '' +
      '<div class="col-md-6 col-lg-4 mf-reveal">' +
        '<article class="mf-card mf-route-card mf-hover-lift">' +
          '<div class="mf-rc-cover">' +
            '<img src="' + e(photo.url) + '" alt="' + e(photo.alt) + '" loading="lazy"' +
              ' onerror="this.onerror=null;this.src=\'images/placeholder.svg\'">' +
            '<span class="mf-seats mf-rc-seats ' + MF.seatClass(left) + '">' + e(MF.seatLabel(left)) + '</span>' +
            '<span class="mf-rc-caption">' +
              '<span class="mf-rc-bus"><i class="bi bi-bus-front" aria-hidden="true"></i> ' + e(bus.Bus_Name) + '</span>' +
              '<span class="mf-rc-id">' + e(bus.Bus_ID) + '</span>' +
            '</span>' +
          '</div>' +
          '<div class="mf-rc-body">' +
            '<div class="mf-rc-leg">' +
              '<div><span class="mf-stop">' + e(bus.Departure) + '</span>' +
                '<span class="mf-time">' + e(bus.Departure_Time) + '</span></div>' +
              '<div class="mf-rc-line" aria-hidden="true"><span>' + e(MF.duration(bus.Departure_Time, bus.Arrival_Time)) + '</span></div>' +
              '<div class="text-end"><span class="mf-stop">' + e(bus.Destination) + '</span>' +
                '<span class="mf-time">' + e(bus.Arrival_Time) + '</span></div>' +
            '</div>' +
            '<div class="mf-rc-date">' +
              '<i class="bi bi-calendar-event" aria-hidden="true"></i> ' + e(bus.Travel_Date) +
            '</div>' +
            '<div class="mf-rc-foot">' +
              '<div class="mf-rc-fare">' + e(MF.formatFare(bus.Fare)) + ' <small>/ seat</small></div>' +
              (soldOut
                ? '<span class="btn btn-sm mf-btn-ghost disabled" aria-disabled="true">Sold out</span>'
                : '<a class="btn btn-sm mf-btn-outline-red" href="' + e(searchUrl(bus)) + '">View seats <i class="bi bi-arrow-right" aria-hidden="true"></i></a>') +
            '</div>' +
          '</div>' +
        '</article>' +
      '</div>';
  }

  function renderRoutesGrid(buses) {
    var $grid = $('#routesGrid');
    $grid.attr('aria-busy', 'false').empty();

    if (!buses.length) {
      $grid.html('<div class="col-12"><div class="mf-state">' +
        '<i class="bi bi-signpost-2" aria-hidden="true"></i>No routes to show just yet.</div></div>');
      return;
    }

    // Build each card and append it – .append() per card keeps the markup
    // readable and lets the reveal observer pick them up one by one.
    $.each(buses.slice(0, 6), function (i, bus) {
      $grid.append(routeCardHtml(bus));
    });

    observeReveals();
  }

  function renderPopularRoute(bus) {
    var $card = $('#popularRoute');
    var e = MF.escape;

    $card.attr('aria-busy', 'false').html('' +
      '<div class="d-flex justify-content-between align-items-center mb-2">' +
        '<span class="small fw-bold mf-text-red"><i class="bi bi-fire" aria-hidden="true"></i> Popular Route</span>' +
        '<span class="mf-badge-soft">Live</span>' +
      '</div>' +
      '<div class="mf-pr-route">' + e(bus.Departure) +
        ' <i class="bi bi-arrow-right mf-text-red" aria-hidden="true"></i> ' + e(bus.Destination) +
      '</div>' +
      '<div class="mf-pr-meta mt-2 mb-3">' +
        '<span><i class="bi bi-clock" aria-hidden="true"></i> ' + e(bus.Departure_Time) + ' – ' + e(bus.Arrival_Time) + '</span>' +
        '<span><i class="bi bi-hourglass-split" aria-hidden="true"></i> ' + e(MF.duration(bus.Departure_Time, bus.Arrival_Time)) + '</span>' +
        '<span><i class="bi bi-bus-front" aria-hidden="true"></i> ' + e(bus.Bus_Name) + '</span>' +
      '</div>' +
      '<div class="d-flex align-items-end justify-content-between gap-2">' +
        '<div class="mf-pr-fare">' + e(MF.formatFare(bus.Fare)) + ' <small>/ seat</small></div>' +
        '<a class="btn mf-btn-red btn-sm" href="' + e(searchUrl(bus)) + '">Book <i class="bi bi-arrow-right" aria-hidden="true"></i></a>' +
      '</div>' +
      '<div class="mt-2"><span class="mf-seats ' + MF.seatClass(Number(bus.Available_Seats) || 0) + '">' +
        e(MF.seatLabel(Number(bus.Available_Seats) || 0)) + '</span></div>');
  }

  function showRouteSkeletons() {
    var block = '<div class="col-md-6 col-lg-4">' +
      '<div class="mf-card"><div class="mf-skeleton mb-3" style="height:20px;width:45%"></div>' +
      '<div class="mf-skeleton mb-2" style="height:28px"></div>' +
      '<div class="mf-skeleton mb-3" style="height:16px;width:65%"></div>' +
      '<div class="mf-skeleton" style="height:36px;width:55%"></div></div></div>';
    $('#routesGrid').attr('aria-busy', 'true').html(block + block + block);
  }

  function loadRoutes() {
    if (!$('#routesGrid').length && !$('#popularRoute').length) { return; }

    showRouteSkeletons();

    request('/buses/available')
      .done(function (payload) {
        var buses = toArray(payload);
        if (!buses.length) { buses = MOCK_BUSES; }
        paint(buses);
      })
      .fail(function () {
        // API unreachable – fall back to in-file mock data (rule 4).
        paint(MOCK_BUSES);
      });

    function paint(buses) {
      renderRoutesGrid(buses);

      // "Popular" = the trip with the fewest seats left but still bookable.
      var bookable = $.grep(buses, function (b) { return (Number(b.Available_Seats) || 0) > 0; });
      var pick = (bookable.length ? bookable : buses).slice().sort(function (a, b) {
        return (Number(a.Available_Seats) || 0) - (Number(b.Available_Seats) || 0);
      })[0];

      if (pick) { renderPopularRoute(pick); }

      // Feed the live timetable into the stat counters. Only the tiles the
      // data actually supports are overwritten – "Would ride again" stays
      // as authored in the markup.
      var routes = {};
      var seatsOpen = 0;
      $.each(buses, function (i, b) {
        routes[b.Route] = true;
        seatsOpen += Number(b.Available_Seats) || 0;
      });
      $('[data-key="totalBuses"]').attr('data-count', buses.length);
      $('[data-key="totalRoutes"]').attr('data-count', Object.keys(routes).length);
      $('[data-key="seatsOpen"]').attr('data-count', seatsOpen);
    }
  }

  // ---------------------------------------------------------------------
  // jQuery Use #5 – Effects: scroll fade-up, counters, smooth scroll, nav shadow
  // ---------------------------------------------------------------------
  var revealObserver = null;

  function observeReveals() {
    var $items = $('.mf-reveal').not('.mf-in');

    if (prefersReducedMotion || !window.IntersectionObserver) {
      $items.addClass('mf-in');
      return;
    }

    if (!revealObserver) {
      revealObserver = new window.IntersectionObserver(function (entries) {
        $.each(entries, function (i, entry) {
          if (entry.isIntersecting) {
            $(entry.target).addClass('mf-in');
            revealObserver.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    }

    $items.each(function () { revealObserver.observe(this); });
  }

  // Count 0 -> data-count once, when the stats band first scrolls into view.
  function animateCounter($el) {
    var target = Number($el.attr('data-count')) || 0;
    var suffix = $el.attr('data-suffix') || '';

    if (prefersReducedMotion) {
      $el.text(target.toLocaleString('en-LK') + suffix);
      return;
    }

    $({ n: 0 }).animate({ n: target }, {
      duration: 1400,
      easing: 'swing',
      step: function () {
        $el.text(Math.round(this.n).toLocaleString('en-LK') + suffix);
      },
      complete: function () {
        $el.text(target.toLocaleString('en-LK') + suffix);
      }
    });
  }

  function initCounters() {
    var $band = $('#statsBand');
    if (!$band.length) { return; }

    function run() {
      if ($band.data('mfCounted')) { return; }
      $band.data('mfCounted', true);
      $band.find('.mf-stat-num').each(function () { animateCounter($(this)); });
    }

    if (!window.IntersectionObserver) { run(); return; }

    new window.IntersectionObserver(function (entries, obs) {
      if (entries[0].isIntersecting) {
        run();
        obs.disconnect();
      }
    }, { threshold: 0.35 }).observe($band[0]);
  }

  function initScrollEffects() {
    // Smooth scroll for in-page anchors.
    $(document).on('click', '[data-scroll]', function (e) {
      var target = $(this).attr('href');
      var $target = target && target.charAt(0) === '#' ? $(target) : $();
      if (!$target.length) { return; }

      e.preventDefault();
      $('html, body').animate(
        { scrollTop: $target.offset().top - 70 },
        prefersReducedMotion ? 0 : 600
      );
    });

    // Navbar gains a shadow once the page is scrolled.
    var $window = $(window);
    function onScroll() {
      $('.mf-nav').toggleClass('mf-nav-scrolled', $window.scrollTop() > 8);
    }
    $window.on('scroll', onScroll);
    onScroll();
  }

  // ---------------------------------------------------------------------
  // jQuery Use #6 – Weather chip (static default, Open-Meteo when reachable)
  // ---------------------------------------------------------------------
  var WEATHER_CITIES = {
    'Colombo':      { lat: 6.93,  lon: 79.86, temp: 28 },
    'Kandy':        { lat: 7.29,  lon: 80.64, temp: 24 },
    'Galle':        { lat: 6.03,  lon: 80.22, temp: 27 },
    'Jaffna':       { lat: 9.66,  lon: 80.02, temp: 30 },
    'Nuwara Eliya': { lat: 6.97,  lon: 80.77, temp: 17 }
  };

  function paintWeather(city, temp) {
    $('#weatherChip').find('.mf-w-city').text(city).end()
      .find('.mf-w-temp').text(Math.round(temp) + '°C');
  }

  function initWeather() {
    var $chip = $('#weatherChip');
    if (!$chip.length) { return; }

    function show(city) {
      var info = WEATHER_CITIES[city];
      if (!info) { return; }

      // Static value first so the chip is never empty, then try the live API.
      paintWeather(city, info.temp);

      $.ajax({
        url: 'https://api.open-meteo.com/v1/forecast',
        data: { latitude: info.lat, longitude: info.lon, current: 'temperature_2m' },
        dataType: 'json',
        timeout: 5000
      }).done(function (res) {
        var live = res && res.current && res.current.temperature_2m;
        if (typeof live === 'number') { paintWeather(city, live); }
      });
      // No .fail handler needed: the static value is already on screen.
    }

    $(document).on('click', '#weatherMenu [data-city]', function () {
      show($(this).data('city'));
    });

    show('Colombo');
  }

  // ---------------------------------------------------------------------
  // jQuery Use #7 – "Start Chat" opens the Metro AI widget
  // ---------------------------------------------------------------------
  function initChatHooks() {
    $(document).on('click', '[data-open-chat]', function (e) {
      e.preventDefault();
      if (window.MetroFlowChat && typeof window.MetroFlowChat.open === 'function') {
        window.MetroFlowChat.open();
      } else {
        // chat.js has not loaded – the full-page assistant still works.
        window.location.href = 'assistant.html';
      }
    });
  }

  /* ================================ boot ================================= */

  // Navbar + footer + the behaviour that belongs to them. Runs on every page
  // that loads home.js (index.html and assistant.html).
  MetroFlowHome.initChrome = function () {
    var page = (window.location.pathname.split('/').pop() || 'index.html')
      .replace(/\.html?$/, '') || 'index';

    $.when(
      MF.loadPartial('#navbar', 'partials/navbar.html'),
      MF.loadPartial('#footer', 'partials/footer.html')
    ).always(function () {
      $('#year').text(new Date().getFullYear());
      $('.mf-nav .nav-link[data-page="' + page + '"]')
        .addClass('active')
        .attr('aria-current', 'page');
      initWeather();
      initScrollEffects();
    });

    initChatHooks();
    observeReveals();
  };

  // Home-page-only behaviour.
  MetroFlowHome.init = function () {
    MetroFlowHome.initChrome();
    initSwap();
    initAutocomplete();
    initSearchForm();
    loadRoutes();
    initCounters();
  };

  window.MetroFlowHome = MetroFlowHome;

  $(function () {
    if ($('#searchForm').length) {
      MetroFlowHome.init();
    } else {
      // assistant.html and any other page reusing home.js for the chrome.
      MetroFlowHome.initChrome();
    }
  });

}(window, jQuery));
