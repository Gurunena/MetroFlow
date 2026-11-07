// booking-extras.js – extra features for the booking and My Trips pages (Member 4)
// ---------------------------------------------------------------------------
//  • Carbon saved      – estimated CO2 saved by taking the bus instead of a car
//  • Live countdown    – "Departs in 2d 4h 12m", updated every second
//  • Share to WhatsApp – trip details + Booking ID in one tap
//  • MetroMiles        – loyalty points and levels from a passenger's bookings
//  • Scratch card      – a reward revealed by scratching after booking
// Everything here is front-end only and works from data the booking API
// already returns, so no database changes are needed.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var MF = window.MetroFlow = window.MetroFlow || {};

  /* ============================ carbon saved ============================ */

  var AVG_SPEED_KMH = 40;   // average metro bus speed including stops
  var CAR_KG_PER_KM = 0.17; // one person driving a petrol car
  var BUS_KG_PER_KM = 0.03; // one passenger's share of a bus

  function toMinutes(hhmm) {
    var p = String(hhmm || '').split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }

  // Distance is estimated from the journey time, since the timetable has no distances
  function tripKm(bus) {
    var mins = toMinutes(bus.Arrival_Time) - toMinutes(bus.Departure_Time);
    return mins > 0 ? Math.round((mins / 60) * AVG_SPEED_KMH) : 0;
  }

  function co2Saved(bus) {
    return Math.round(tripKm(bus) * (CAR_KG_PER_KM - BUS_KG_PER_KM) * 10) / 10;
  }

  /* =========================== live countdown =========================== */

  function countdown(travelDate, time) {
    var ms = new Date(travelDate + 'T' + (time || '00:00') + ':00') - new Date();
    if (isNaN(ms)) { return null; }
    if (ms <= 0) { return { text: 'Departed', past: true, soon: false }; }

    var totalMin = Math.floor(ms / 60000);
    var d = Math.floor(totalMin / 1440);
    var h = Math.floor((totalMin % 1440) / 60);
    var m = totalMin % 60;
    var s = Math.floor(ms / 1000) % 60;
    var text = d ? d + 'd ' + h + 'h ' + m + 'm' : h ? h + 'h ' + m + 'm ' + s + 's' : m + 'm ' + s + 's';
    return { text: 'Departs in ' + text, past: false, soon: ms < 24 * 3600 * 1000 };
  }

  // Any element with data-depart="2026-11-20" data-time="06:00" ticks by itself
  function tickCountdowns() {
    $('[data-depart]').each(function () {
      var $el = $(this);
      var c = countdown($el.data('depart'), $el.data('time'));
      if (!c) { return; }
      $el.toggleClass('is-soon', c.soon).toggleClass('is-past', c.past)
        .find('.bk-countdown-text').text(c.text);
    });
  }
  window.setInterval(tickCountdowns, 1000);

  function countdownHtml(travelDate, time) {
    return '<span class="bk-countdown" data-depart="' + MF.escape(travelDate) + '" data-time="' + MF.escape(time || '00:00') + '">' +
      '<i class="bi bi-clock-history" aria-hidden="true"></i> <span class="bk-countdown-text">' +
      MF.escape((countdown(travelDate, time) || {}).text || '') + '</span></span>';
  }

  /* ========================== share to WhatsApp ========================= */

  function shareUrl(b, bus) {
    var lines = [
      '🚌 My MetroFlow trip',
      b.Boarding_Point + ' → ' + b.Destination,
      'Date: ' + b.Travel_Date + (bus && bus.Departure_Time ? ' at ' + bus.Departure_Time : ''),
      'Bus: ' + (bus && bus.Bus_Name ? bus.Bus_Name + ' (' + b.Bus_ID + ')' : b.Bus_ID) + ' · Seat ' + b.Seat_Number,
      'Booking ID: ' + b.Booking_ID
    ];
    return 'https://wa.me/?text=' + encodeURIComponent(lines.join('\n'));
  }

  /* ============================== MetroMiles ============================ */

  // 1 MetroMile for every LKR 10 spent on Confirmed bookings
  var LEVELS = [
    { name: 'Bronze', min: 0, icon: 'bi-award' },
    { name: 'Silver', min: 500, icon: 'bi-award-fill' },
    { name: 'Gold', min: 1500, icon: 'bi-trophy' },
    { name: 'Platinum', min: 3000, icon: 'bi-gem' }
  ];

  function metroMiles(bookings) {
    var miles = 0;
    var trips = 0;
    $.each(bookings, function (i, b) {
      if (b.Booking_Status === 'Confirmed') {
        miles += Math.floor(Number(b.Fare) / 10);
        trips += 1;
      }
    });
    var level = LEVELS[0];
    var next = null;
    $.each(LEVELS, function (i, l) {
      if (miles >= l.min) { level = l; next = LEVELS[i + 1] || null; }
    });
    var progress = next ? Math.round(((miles - level.min) / (next.min - level.min)) * 100) : 100;
    return { miles: miles, trips: trips, level: level, next: next, progress: progress };
  }

  /* ============================= scratch card =========================== */

  var REWARDS = [
    { icon: '🎉', title: '10% off your next trip', detail: 'Show this code when you book your next MetroFlow ride.' },
    { icon: '🪟', title: 'Free window-seat upgrade', detail: 'Ask the conductor to move you to a window seat on boarding.' },
    { icon: '⭐', title: 'Double MetroMiles', detail: 'Your next booking earns twice the MetroMiles.' },
    { icon: '💸', title: 'LKR 200 off a return trip', detail: 'Valid on any return journey within 30 days.' },
    { icon: '☕', title: 'Free tea at Colombo Fort', detail: 'Redeem at the MetroFlow lounge before you board.' }
  ];

  // The same booking always gets the same reward (picked from its Booking ID)
  function rewardFor(bookingId) {
    var hash = 0;
    String(bookingId).split('').forEach(function (ch) { hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; });
    var reward = REWARDS[hash % REWARDS.length];
    return $.extend({ code: 'MF-' + String(bookingId).slice(-6) + '-' + (hash % 1000).toString().padStart(3, '0') }, reward);
  }

  function mountScratchCard($host, bookingId) {
    var reward = rewardFor(bookingId);
    $host.html(
      '<div class="bk-scratch-wrap text-center">' +
        '<h3 class="h5 mb-1"><i class="bi bi-gift mf-text-red" aria-hidden="true"></i> You unlocked a reward!</h3>' +
        '<p class="small mb-3">Scratch the card to reveal it.</p>' +
        '<div class="bk-scratch mx-auto">' +
          '<div class="bk-scratch-prize">' +
            '<div class="bk-scratch-icon" aria-hidden="true">' + reward.icon + '</div>' +
            '<strong>' + MF.escape(reward.title) + '</strong>' +
            '<small>' + MF.escape(reward.detail) + '</small>' +
            '<code>' + MF.escape(reward.code) + '</code>' +
          '</div>' +
          '<canvas class="bk-scratch-cover" aria-hidden="true"></canvas>' +
        '</div>' +
        '<button type="button" class="btn btn-sm mf-btn-ghost mt-2 bk-scratch-reveal">Reveal without scratching</button>' +
      '</div>'
    );

    var $card = $host.find('.bk-scratch');
    var canvas = $host.find('.bk-scratch-cover')[0];
    var ctx = canvas.getContext('2d');
    var ratio = window.devicePixelRatio || 1;
    var w = $card.outerWidth();
    var h = $card.outerHeight();
    var revealed = false;
    var moves = 0;

    canvas.width = w * ratio;
    canvas.height = h * ratio;
    ctx.scale(ratio, ratio);

    // silver foil
    var grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#C9CED6');
    grad.addColorStop(0.5, '#EEF0F3');
    grad.addColorStop(1, '#B8BEC8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#6B7280';
    ctx.font = '700 18px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SCRATCH HERE', w / 2, h / 2 - 4);
    ctx.font = '500 13px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('with your mouse or finger', w / 2, h / 2 + 18);

    function reveal() {
      if (revealed) { return; }
      revealed = true;
      $(canvas).fadeOut(400);
      $host.find('.bk-scratch-reveal').fadeOut(200);
      $card.addClass('is-revealed');
    }

    // share of the foil already scratched off (checks every 8th pixel for speed)
    function clearedShare() {
      var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      var clear = 0;
      var total = 0;
      for (var i = 3; i < data.length; i += 32) {
        total += 1;
        if (data[i] === 0) { clear += 1; }
      }
      return clear / total;
    }

    function scratchAt(e) {
      var rect = canvas.getBoundingClientRect();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(e.clientX - rect.left, e.clientY - rect.top, 22, 0, Math.PI * 2);
      ctx.fill();
      moves += 1;
      if (moves % 10 === 0 && clearedShare() > 0.45) { reveal(); }
    }

    var scratching = false;
    $(canvas)
      .css('touch-action', 'none')
      .on('pointerdown', function (e) { scratching = true; scratchAt(e.originalEvent); })
      .on('pointermove', function (e) { if (scratching) { scratchAt(e.originalEvent); } });
    $(window).on('pointerup', function () { scratching = false; });
    $host.find('.bk-scratch-reveal').on('click', reveal);
  }

  /* ============================== animations ============================ */

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Counts a number up from 0, e.g. the total price or MetroMiles
  function countUp($el, to, format, ms) {
    var fmt = format || function (n) { return Math.round(n).toLocaleString(); };
    if (reducedMotion()) { $el.text(fmt(to)); return; }
    $({ n: 0 }).animate({ n: to }, {
      duration: ms || 900,
      easing: 'swing',
      step: function (n) { $el.text(fmt(n)); },
      complete: function () { $el.text(fmt(to)); }
    });
  }

  // Small horizontal shake, used on invalid form fields
  function shake($el) {
    if (reducedMotion()) { return; }
    $el.removeClass('bk-shake');
    void $el[0].offsetWidth; // restart the animation
    $el.addClass('bk-shake');
  }

  // "From ●- - -🚌- - -● To" with a bus that drives along the route
  function routeHtml(from, to) {
    return '<div class="bk-route" aria-hidden="true">' +
      '<span class="bk-route-stop">' + MF.escape(from) + '</span>' +
      '<div class="bk-route-line"><i class="bi bi-bus-front-fill bk-route-bus"></i></div>' +
      '<span class="bk-route-stop">' + MF.escape(to) + '</span>' +
    '</div>';
  }

  // Animated tick (the circle and the check mark draw themselves)
  function checkSvg() {
    return '<svg class="bk-check-svg" viewBox="0 0 52 52" aria-hidden="true">' +
      '<circle class="bk-check-circle" cx="26" cy="26" r="24" fill="none"/>' +
      '<path class="bk-check-mark" fill="none" d="M15 27 l7 7 l15 -16"/></svg>';
  }

  // Confetti burst in MetroFlow colours, drawn on a temporary canvas
  function confetti() {
    if (reducedMotion()) { return; }
    var canvas = $('<canvas class="bk-confetti" aria-hidden="true">').appendTo('body')[0];
    var ctx = canvas.getContext('2d');
    var w = canvas.width = window.innerWidth;
    var h = canvas.height = window.innerHeight;
    var colors = ['#D80F1E', '#F0444F', '#F5B700', '#0F1B33', '#ffffff', '#22C55E'];
    var pieces = [];
    for (var i = 0; i < 160; i++) {
      pieces.push({
        x: w / 2 + (Math.random() - 0.5) * 120,
        y: h * 0.35,
        vx: (Math.random() - 0.5) * 16,
        vy: -Math.random() * 15 - 5,
        size: Math.random() * 7 + 5,
        rot: Math.random() * 360,
        spin: (Math.random() - 0.5) * 18,
        color: colors[i % colors.length]
      });
    }
    var start = null;
    function frame(t) {
      if (!start) { start = t; }
      var elapsed = t - start;
      ctx.clearRect(0, 0, w, h);
      pieces.forEach(function (p) {
        p.vy += 0.45;           // gravity
        p.vx *= 0.99;           // air
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - elapsed / 2200);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      });
      if (elapsed < 2200) { window.requestAnimationFrame(frame); } else { $(canvas).remove(); }
    }
    window.requestAnimationFrame(frame);
  }

  // Rips a ticket in half along its dashed tear line; resolves when done
  function tearTicket($ticket) {
    var done = $.Deferred();
    var $tear = $ticket.find('.bk-tear').first();
    if (reducedMotion() || !$tear.length) {
      $ticket.fadeOut(250, function () { done.resolve(); });
      return done.promise();
    }

    var width = $ticket.outerWidth();
    var height = $ticket.outerHeight();
    var y = $tear.position().top + 1; // where the ticket rips
    var zigzag = [];
    for (var x = 0, up = true; x <= width + 12; x += 12, up = !up) {
      zigzag.push(x + 'px ' + (y + (up ? -4 : 4)) + 'px');
    }
    var topShape = 'polygon(0 0, ' + width + 'px 0, ' + zigzag.slice().reverse().join(', ') + ')';
    var bottomShape = 'polygon(' + zigzag.join(', ') + ', ' + width + 'px ' + height + 'px, 0 ' + height + 'px)';

    var $wrap = $ticket.parent().css('position', 'relative');
    var offset = $ticket.position();
    function half(shape, cls) {
      return $ticket.clone().addClass('bk-torn ' + cls).css({
        position: 'absolute', top: offset.top, left: offset.left,
        width: width, height: height, margin: 0, clipPath: shape
      }).appendTo($wrap);
    }
    var $top = half(topShape, 'bk-torn-top');
    var $bottom = half(bottomShape, 'bk-torn-bottom');
    $ticket.css('visibility', 'hidden');

    window.requestAnimationFrame(function () {
      $top.add($bottom).addClass('is-falling');
    });
    window.setTimeout(function () {
      $top.add($bottom).remove();
      done.resolve();
    }, 900);
    return done.promise();
  }

  MF.bookingExtras = {
    reducedMotion: reducedMotion,
    countUp: countUp,
    shake: shake,
    routeHtml: routeHtml,
    checkSvg: checkSvg,
    confetti: confetti,
    tearTicket: tearTicket,
    tripKm: tripKm,
    co2Saved: co2Saved,
    countdown: countdown,
    countdownHtml: countdownHtml,
    shareUrl: shareUrl,
    metroMiles: metroMiles,
    rewardFor: rewardFor,
    mountScratchCard: mountScratchCard
  };
})(window, jQuery);
