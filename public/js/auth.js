// auth.js – front-end logic for login, logout and session handling
// ---------------------------------------------------------------------------
// Namespace: MetroFlowAuth. No globals beyond window.MetroFlowAuth.
//
// There is NO mock/offline mode: every credential check happens on the server.
// localStorage only ever holds the JWT, the profile the API returned, and the
// remembered email. Passwords are never stored or logged.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API = '/api/auth';
  var K_TOKEN = 'mf_token';
  var K_USER = 'mf_user';
  var K_EMAIL = 'mf_remember_email';

  var IDLE_WARN_MS = 14 * 60 * 1000;  // show the "still there?" modal
  var IDLE_OUT_MS = 15 * 60 * 1000;   // and sign out a minute later

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ============================== storage =============================== */

  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (err) { return null; }
  }
  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (err) { /* private mode */ }
  }
  function dropStore(key) {
    try { window.localStorage.removeItem(key); } catch (err) { /* private mode */ }
  }

  /* ============================== helpers =============================== */

  // Everything written into the DOM goes through here first.
  function esc(value) {
    return $('<div>').text(value == null ? '' : String(value)).html();
  }

  function firstName(user) {
    return String((user && user.Full_Name) || 'traveller').trim().split(/\s+/)[0];
  }

  function initials(user) {
    var parts = String((user && user.Full_Name) || '?').trim().split(/\s+/);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }

  // Turns any Ajax failure into a sentence worth showing a person.
  function errorFrom(xhr) {
    if (!xhr || xhr.readyState === 0 || xhr.status === 0) {
      return 'Server unreachable, please try again';
    }
    if (xhr.responseJSON && xhr.responseJSON.message) {
      return xhr.responseJSON.message;
    }
    if (xhr.status === 503) {
      return 'Server unreachable, please try again';
    }
    return 'Something went wrong (' + xhr.status + '). Please try again.';
  }

  /* ============================== session =============================== */

  function getToken() { return readStore(K_TOKEN); }

  function getUser() {
    try {
      var raw = readStore(K_USER);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function isLoggedIn() { return !!getToken() && !!getUser(); }
  function isAdmin() {
    var u = getUser();
    return !!u && u.Role === 'admin';
  }

  function saveSession(token, user) {
    writeStore(K_TOKEN, token);
    writeStore(K_USER, JSON.stringify(user));
  }

  function clearSession() {
    dropStore(K_TOKEN);
    dropStore(K_USER);
  }

  /* =============================== ajax ================================= */

  // jQuery Use #1 – $.ajax JSON calls to /api/auth/*
  function post(path, body) {
    return $.ajax({
      url: API + path,
      method: 'POST',
      contentType: 'application/json',
      dataType: 'json',
      data: JSON.stringify(body),
      timeout: 12000
    });
  }

  function getJson(path) {
    return $.ajax({ url: API + path, method: 'GET', dataType: 'json', timeout: 12000 });
  }

  // api.js is still an empty stub, so attach the bearer header here. If a
  // teammate later gives api.js its own prefilter this stays harmless —
  // the header is only set when it is not already present.
  $.ajaxPrefilter(function (options, originalOptions, jqXHR) {
    var token = getToken();
    if (!token) { return; }
    var url = options.url || '';
    if (url.indexOf('/api/') !== 0 && url.indexOf('api/') !== 0) { return; }
    if (options.headers && options.headers.Authorization) { return; }
    jqXHR.setRequestHeader('Authorization', 'Bearer ' + token);
  });

  /* ============================== guards ================================ */

  function requireAuth(redirectTo) {
    if (isLoggedIn()) { return true; }
    var back = encodeURIComponent(redirectTo || window.location.pathname.split('/').pop() || 'index.html');
    window.location.href = 'login.html?next=' + back;
    return false;
  }

  function requireAdmin() {
    if (isLoggedIn() && isAdmin()) { return true; }
    window.location.href = 'admin-login.html';
    return false;
  }

  /* ============================== logout ================================ */

  function logout(skipRedirect) {
    // Tell the server for symmetry/audit, but never block on it: the token is
    // discarded client-side either way.
    post('/logout', {}).always(function () {
      clearSession();
      stopIdleWatch();
      if (!skipRedirect) { window.location.href = 'logout.html'; }
    });
  }

  /* ========================= navbar logged-in state ====================== */

  // jQuery Use #5 – dynamic DOM updates for the navbar user state
  function paintNavbar() {
    var $guest = $('#authGuest');
    var $user = $('#authUser');
    if (!$guest.length && !$user.length) { return; }

    if (!isLoggedIn()) {
      $guest.removeClass('d-none');
      $user.addClass('d-none');
      return;
    }

    var u = getUser();
    $guest.addClass('d-none');
    $user.removeClass('d-none');
    $('#userInitial').text(initials(u));
    $('#userName').text(firstName(u));

    // Admins get an extra entry; added once.
    if (isAdmin() && !$user.find('[data-admin-link]').length) {
      $user.find('.dropdown-menu').prepend(
        '<li><a class="dropdown-item rounded-3" data-admin-link href="admin.html">' +
        '<i class="bi bi-speedometer2 me-2" aria-hidden="true"></i>Admin</a></li>'
      );
    }
  }

  /**
   * Paints the navbar as soon as the partial shows up, however late that is.
   * Uses MutationObserver where available, with a short polling fallback, and
   * gives up after a few seconds so nothing is left running on a page that
   * simply has no navbar.
   */
  function watchForNavbar() {
    if (document.getElementById('authGuest') || document.getElementById('authUser')) {
      return;
    }

    // Deliberately a bounded poll rather than a MutationObserver: pages like
    // index.html mutate constantly (animating counters, the game canvas), and
    // running a lookup on every mutation is a lot of wasted work. 40 cheap
    // getElementById checks over ~6s costs nothing and cannot be swamped.
    var tries = 0;
    var poll = window.setInterval(function () {
      tries += 1;
      if (document.getElementById('authGuest') || document.getElementById('authUser')) {
        paintNavbar();
        window.clearInterval(poll);
      } else if (tries >= 40) {
        window.clearInterval(poll);  // no navbar on this page
      }
    }, 150);
  }

  /* ========================= inactivity auto-logout ====================== */

  var idleWarnTimer = null, idleOutTimer = null, idleTick = null;

  function stopIdleWatch() {
    window.clearTimeout(idleWarnTimer);
    window.clearTimeout(idleOutTimer);
    window.clearInterval(idleTick);
    $('#mfIdleModal').remove();
  }

  function showIdleWarning() {
    if ($('#mfIdleModal').length) { return; }

    var seconds = Math.round((IDLE_OUT_MS - IDLE_WARN_MS) / 1000);
    var $modal = $(
      '<div class="modal fade show" id="mfIdleModal" tabindex="-1" role="dialog" ' +
      'aria-modal="true" aria-labelledby="mfIdleTitle" ' +
      'style="display:block;background:rgba(15,27,51,.6)">' +
        '<div class="modal-dialog modal-dialog-centered">' +
          '<div class="modal-content p-2" style="border-radius:20px">' +
            '<div class="modal-body text-center">' +
              '<div style="font-size:2rem" aria-hidden="true">🚌</div>' +
              '<h2 class="h5 mt-2 mb-1" id="mfIdleTitle">Still there?</h2>' +
              '<p class="small mb-3">The bus will leave in ' +
                '<b id="mfIdleCount">' + seconds + '</b>s.</p>' +
              '<button class="btn btn-sm mf-btn-red" type="button" id="mfIdleStay">I\'m here</button> ' +
              '<button class="btn btn-sm mf-btn-ghost" type="button" id="mfIdleGo">Log out now</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    ).appendTo('body');

    $modal.find('#mfIdleStay').trigger('focus');

    idleTick = window.setInterval(function () {
      seconds -= 1;
      $('#mfIdleCount').text(Math.max(0, seconds));
    }, 1000);

    $('#mfIdleStay').on('click', resetIdleWatch);
    $('#mfIdleGo').on('click', function () { logout(); });
  }

  function resetIdleWatch() {
    if (!isLoggedIn()) { return; }
    stopIdleWatch();
    idleWarnTimer = window.setTimeout(showIdleWarning, IDLE_WARN_MS);
    idleOutTimer = window.setTimeout(function () { logout(); }, IDLE_OUT_MS);
  }

  function startIdleWatch() {
    if (!isLoggedIn()) { return; }
    // Throttled so a mousemove storm does not reset timers hundreds of times.
    var last = 0;
    $(document).on('mousemove.mfidle keydown.mfidle click.mfidle scroll.mfidle touchstart.mfidle', function () {
      var now = Date.now();
      if (now - last < 1000) { return; }
      last = now;
      if (!$('#mfIdleModal').length) { resetIdleWatch(); }
    });
    resetIdleWatch();
  }

  /* ============================ scene helpers =========================== */

  var $scene = null;

  function scene() {
    if ($scene === null) { $scene = $('#mfScene'); }
    return $scene;
  }

  function sceneState(cls, on, autoClearMs) {
    var $s = scene();
    if (!$s.length) { return; }
    $s.toggleClass(cls, on !== false);
    if (autoClearMs) {
      window.setTimeout(function () { $s.removeClass(cls); }, autoClearMs);
    }
  }

  var revTimer = null;
  function rev() {
    if (reduceMotion) { return; }
    sceneState('is-revving', true);
    window.clearTimeout(revTimer);
    revTimer = window.setTimeout(function () { sceneState('is-revving', false); }, 700);
  }

  /* ============================== alerts ================================ */

  function alertBox(sel, kind, message) {
    $(sel)
      .removeClass('is-error is-ok is-info')
      .addClass('is-' + kind)
      .html(esc(message));
  }
  function clearAlert(sel) {
    $(sel).removeClass('is-error is-ok is-info').empty();
  }

  /* ========================= field-level validation ===================== */

  var RE = {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    phone: /^(\+94\d{9}|0\d{9})$/
  };

  // jQuery Use #3 – validation state with .addClass() / .removeClass()
  function setField($input, valid, message) {
    $input.removeClass('is-valid is-invalid').addClass(valid ? 'is-valid' : 'is-invalid');
    if (!valid && message) { $input.siblings('.mf-auth-msg').text(message); }
    return valid;
  }
  function resetField($input) {
    $input.removeClass('is-valid is-invalid');
  }

  // Pure check: works out whether a field is valid WITHOUT touching the DOM,
  // so a pristine form can be evaluated (to enable/disable "Next") without
  // painting red errors the user has not earned yet.
  function fieldValid($input) {
    var name = $input.attr('name');
    var raw = $input.val() || '';
    var value = $.trim(raw);

    if (name === 'Full_Name') {
      return { ok: value.length >= 2 && value.length <= 60,
        msg: 'Please enter your full name (2–60 characters).' };
    }
    if (name === 'Email') {
      return { ok: RE.email.test(value), msg: 'Please enter a valid email address.' };
    }
    if (name === 'Phone') {
      return { ok: RE.phone.test(value), msg: 'Use +94771234567 or 0771234567.' };
    }
    if (name === 'Password') {
      return { ok: scorePassword(raw).score >= 3,
        msg: 'Password needs 8+ characters, upper and lowercase, and a number.' };
    }
    if (name === 'Confirm') {
      return { ok: raw.length > 0 && raw === $('#suPassword').val(),
        msg: 'Both passwords must match.' };
    }
    return { ok: true, msg: '' };
  }

  // Same check, but paints the Bootstrap validation state. Only called once a
  // field has actually been used, or when the user tries to move on.
  function checkField($input) {
    var result = fieldValid($input);
    return setField($input, result.ok, result.msg);
  }

  /* ========================= password fuel gauge ======================== */

  function scorePassword(pw) {
    pw = pw || '';
    var rules = {
      len: pw.length >= 8,
      num: /\d/.test(pw),
      upper: /[A-Z]/.test(pw),
      lower: /[a-z]/.test(pw),
      sym: /[^A-Za-z0-9]/.test(pw)
    };
    var score = 0;
    $.each(rules, function (k, met) { if (met) { score += 1; } });
    return { score: score, rules: rules };
  }

  var FUEL = [
    { label: 'Empty', color: '#D80F1E' },
    { label: 'Low', color: '#E8622B' },
    { label: 'Half', color: '#E8A020' },
    { label: 'Good', color: '#7FA82B' },
    { label: 'Full', color: '#1F8A70' }
  ];

  function paintGauge(pw) {
    var result = scorePassword(pw);
    var level = Math.max(0, result.score - 1);     // 0..4
    var fuel = FUEL[Math.min(level, FUEL.length - 1)];

    // Needle sweeps -90deg (empty) to +90deg (full).
    var angle = -90 + (level / 4) * 180;
    $('#suNeedle').css('transform', 'rotate(' + angle + 'deg)');

    var arc = document.getElementById('suGaugeValue');
    if (arc) {
      var len = arc.getTotalLength();
      arc.style.stroke = fuel.color;
      arc.style.strokeDasharray = len;
      arc.style.strokeDashoffset = len * (1 - level / 4);
    }

    // jQuery Use #5 – live checklist + label updates
    $('#suFuelText').text(fuel.label).css('color', fuel.color);
    $.each(result.rules, function (rule, met) {
      var $li = $('#suChecks li[data-rule="' + rule + '"]');
      $li.toggleClass('is-met', met)
        .find('i').attr('class', met ? 'bi bi-check-circle-fill' : 'bi bi-circle');
    });

    return result;
  }

  /* ============================== sign in =============================== */

  function afterLogin(data, nextPage) {
    saveSession(data.token, data.user);

    sceneState('is-stop', false);
    sceneState('is-go', true);
    sceneState('is-driving', true);
    sceneState('is-boarding', true);

    $('#mfPassName').text('Welcome aboard, ' + firstName(data.user) + '!');
    $('#mfPassNo').text(data.user.Member_No || '');

    var target = nextPage ||
      (data.user.Role === 'admin' ? 'admin.html' : (safeNext() || 'index.html'));

    window.setTimeout(function () { window.location.href = target; }, reduceMotion ? 300 : 1800);
  }

  // Only allow same-site relative pages from ?next=, never an absolute URL.
  function safeNext() {
    var match = /[?&]next=([^&]+)/.exec(window.location.search);
    if (!match) { return null; }
    var value = decodeURIComponent(match[1]);
    return /^[A-Za-z0-9._-]+\.html$/.test(value) ? value : null;
  }

  function onSignInFail(message) {
    sceneState('is-go', false);
    sceneState('is-stop', true);
    sceneState('is-honking', true, 1600);
    alertBox('#siAlert', 'error', message);
  }

  function initSignIn() {
    var $form = $('#signInForm');
    if (!$form.length) { return; }

    // Remembered email (never the password).
    var remembered = readStore(K_EMAIL);
    if (remembered) {
      $('#siEmail').val(remembered);
      $('#siRemember').prop('checked', true);
    }

    // jQuery Use #2 – event handlers / delegation
    $form.on('input', 'input', function () { rev(); clearAlert('#siAlert'); });

    $form.on('submit', function (e) {
      e.preventDefault();
      clearAlert('#siAlert');

      var email = $.trim($('#siEmail').val());
      var password = $('#siPassword').val();

      if (!RE.email.test(email)) {
        return onSignInFail('Please enter a valid email address.');
      }
      if (!password) {
        return onSignInFail('Please enter your password.');
      }

      if ($('#siRemember').is(':checked')) { writeStore(K_EMAIL, email); }
      else { dropStore(K_EMAIL); }

      var $btn = $('#siSubmit').prop('disabled', true);
      var label = $btn.html();
      $btn.html('<span class="spinner-border" role="status" aria-hidden="true"></span> Boarding…');

      post('/login', { Email: email, Password: password })
        .done(function (res) { afterLogin(res.data); })
        .fail(function (xhr) {
          onSignInFail(errorFrom(xhr));
          $btn.prop('disabled', false).html(label);
        });
    });
  }

  /* ============================== sign up =============================== */

  var step = 1;
  var STEPS = 3;

  function stepFields(n) {
    return $('#suStep' + n).find('input[name]').filter(function () {
      return $(this).attr('type') !== 'checkbox';
    });
  }

  function stepValid(n) {
    var ok = true;
    stepFields(n).each(function () { if (!fieldValid($(this)).ok) { ok = false; } });
    if (n === 3 && !$('#suTerms').is(':checked')) { ok = false; }
    return ok;
  }

  function refreshStepButton() {
    $('#suNext').prop('disabled', !stepValid(step));
  }

  // jQuery Use #4 – .animate() / .fadeIn() step transitions
  function gotoStep(next) {
    if (next < 1 || next > STEPS) { return; }
    var forward = next > step;
    var $from = $('#suStep' + step);
    var $to = $('#suStep' + next);

    function show() {
      $to.addClass('is-current')
        .css({ opacity: 0, left: forward ? 40 : -40, position: 'relative' })
        .animate({ opacity: 1, left: 0 }, reduceMotion ? 0 : 320, function () {
          $to.css({ position: '', left: '' });
          $to.find('input').first().trigger('focus');
        });
      step = next;
      paintRoute();
      refreshStepButton();
    }

    if (reduceMotion) {
      $from.removeClass('is-current');
      show();
      return;
    }

    $from.animate({ opacity: 0 }, 180, function () {
      $from.removeClass('is-current').css('opacity', '');
      show();
    });
  }

  function paintRoute() {
    var pct = ((step - 1) / (STEPS - 1)) * 100;
    $('#suRouteFill').css('width', pct + '%');
    $('#suRouteBus').css('left', 'calc(8% + ' + (pct / 100) + ' * (84%))');

    $('.mf-auth-stop-item').each(function (i) {
      var n = i + 1;
      $(this).toggleClass('is-active', n === step).toggleClass('is-done', n < step);
    });
    $('#suBack').toggle(step > 1);
    $('#suNext').html(step === STEPS
      ? 'Secure my seat <i class="bi bi-ticket-perforated" aria-hidden="true"></i>'
      : 'Next stop <i class="bi bi-arrow-right" aria-hidden="true"></i>');
  }

  function confetti() {
    if (reduceMotion) { return; }
    var colors = ['#D80F1E', '#0F1B33', '#FFB457', '#1F8A70'];
    var $holder = $('<div class="mf-auth-confetti" aria-hidden="true"></div>').appendTo('.mf-auth-card');
    for (var i = 0; i < 26; i++) {
      $('<span class="mf-auth-scrap"></span>').css({
        left: Math.random() * 100 + '%',
        background: colors[i % colors.length],
        animationDelay: (Math.random() * 0.5) + 's',
        transform: 'rotate(' + Math.random() * 360 + 'deg)'
      }).appendTo($holder);
    }
    window.setTimeout(function () { $holder.remove(); }, 3200);
  }

  function showBoardingPass(user) {
    // jQuery Use #5 – build the boarding pass from the API response
    $('#suPassName').text(user.Full_Name);
    $('#suPassNo').text(user.Member_No || '');
    $('#suPassEmail').text(user.Email);
    $('#signUpForm').hide();
    $('#suSuccess').fadeIn(reduceMotion ? 0 : 400);
    confetti();
  }

  function initSignUp() {
    var $form = $('#signUpForm');
    if (!$form.length) { return; }

    paintRoute();

    $form.on('input change', 'input', function () {
      var $input = $(this);
      rev();
      if ($input.attr('name') === 'Password') { paintGauge($input.val()); }
      if ($input.hasClass('is-invalid') || $input.hasClass('is-valid')) { checkField($input); }
      refreshStepButton();
    });

    $form.on('blur', 'input[name]', function () {
      if ($(this).attr('type') !== 'checkbox' && $.trim($(this).val())) { checkField($(this)); }
      refreshStepButton();
    });

    // Live +94 / 07 hint as the number is typed.
    $('#suPhone').on('input', function () {
      var v = $(this).val();
      var hint = RE.phone.test(v.trim()) ? 'Looks good.'
        : (/^\+?9?4?/.test(v) && v.length ? 'Keep going: +94 then 9 digits, or 0 then 9 digits.'
          : 'Format: +94771234567 or 0771234567');
      $('#suPhoneHint').text(hint);
    });

    $('#suNext').on('click', function () {
      stepFields(step).each(function () { checkField($(this)); });
      if (!stepValid(step)) { refreshStepButton(); return; }
      if (step < STEPS) { gotoStep(step + 1); return; }
      submitSignUp();
    });

    $('#suBack').on('click', function () { gotoStep(step - 1); });

    // Enter should advance a stop, not submit a half-filled form.
    $form.on('keydown', 'input', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('#suNext').trigger('click'); }
    });

    $form.on('submit', function (e) { e.preventDefault(); });

    paintGauge('');
    refreshStepButton();
  }

  function submitSignUp() {
    clearAlert('#suAlert');

    // jQuery Use #3 – .serializeArray() to collect the form
    var values = {};
    $.each($('#signUpForm').serializeArray(), function (i, f) { values[f.name] = f.value; });

    var $btn = $('#suNext').prop('disabled', true);
    var label = $btn.html();
    $btn.html('<span class="spinner-border" role="status" aria-hidden="true"></span> Reserving…');

    post('/register', {
      Full_Name: $.trim(values.Full_Name),
      Email: $.trim(values.Email),
      Phone: $.trim(values.Phone),
      Password: $('#suPassword').val()
    })
      .done(function (res) {
        saveSession(res.data.token, res.data.user);
        showBoardingPass(res.data.user);
      })
      .fail(function (xhr) {
        alertBox('#suAlert', 'error', errorFrom(xhr));
        sceneState('is-honking', true, 1600);
        $btn.prop('disabled', false).html(label);
        if (xhr.status === 409) { gotoStep(1); setField($('#suEmail'), false, 'That email is already registered.'); }
      });
  }

  /* ============================ password eye ============================ */

  function initPasswordEyes() {
    // jQuery Use #2 – delegated handler for every eye button on the page
    $(document).on('click', '.mf-auth-eye', function () {
      var $btn = $(this);
      var $input = $('#' + $btn.attr('data-for'));
      var show = $input.attr('type') === 'password';

      $input.attr('type', show ? 'text' : 'password');
      $btn.attr('aria-label', show ? 'Hide password' : 'Show password')
        .find('i').attr('class', show ? 'bi bi-eye-slash' : 'bi bi-eye');

      // Headlights follow the visible/hidden state of the password.
      sceneState('is-lights-on', show);
    });
  }

  /* ============================ admin login ============================= */

  var LOCK_AFTER = 5;
  var LOCK_MS = 30000;

  function initAdmin() {
    var $form = $('#adminForm');
    if (!$form.length) { return; }

    var solved = false;
    var attempts = 0;
    var lockedUntil = 0;

    /* --- "drag the bus to the stop" slider --- */
    var $slider = $('#adminSlider');
    var $handle = $('#adminHandle');
    var dragging = false;

    function sliderWidth() { return $slider.width() - $handle.outerWidth() - 6; }

    function setHandle(x) {
      var max = sliderWidth();
      var pos = Math.max(0, Math.min(max, x));
      $handle.css('left', (pos + 3) + 'px');
      $('#adminSliderFill').css('width', (pos + 25) + 'px');
      return pos >= max - 4;
    }

    function solve() {
      solved = true;
      $slider.addClass('is-solved');
      $('#adminSliderText').text('Verified — the bus is at the stop');
      $handle.attr('aria-valuenow', 100);
      refreshAdminButton();
    }

    $handle.on('pointerdown', function (e) {
      if (solved || isLocked()) { return; }
      dragging = true;
      $handle.css('cursor', 'grabbing');
      try { this.setPointerCapture(e.originalEvent.pointerId); } catch (err) { /* older browsers */ }
    });

    $handle.on('pointermove', function (e) {
      if (!dragging) { return; }
      var x = e.originalEvent.clientX - $slider.offset().left + window.scrollX - $handle.outerWidth() / 2;
      if (setHandle(x)) { dragging = false; solve(); }
    });

    $handle.on('pointerup pointercancel', function () {
      if (!dragging) { return; }
      dragging = false;
      $handle.css('cursor', 'grab');
      if (!solved) { setHandle(0); }
    });

    // Keyboard-operable: arrows / End move the handle.
    $handle.on('keydown', function (e) {
      if (solved || isLocked()) { return; }
      var max = sliderWidth();
      var current = parseFloat($handle.css('left')) - 3;
      var next = current;
      if (e.key === 'ArrowRight') { next = current + max / 5; }
      else if (e.key === 'ArrowLeft') { next = current - max / 5; }
      else if (e.key === 'End' || e.key === 'Enter' || e.key === ' ') { next = max; }
      else { return; }
      e.preventDefault();
      if (setHandle(next)) { solve(); }
    });

    /* --- lockout --- */
    function isLocked() { return Date.now() < lockedUntil; }

    function startLockout() {
      lockedUntil = Date.now() + LOCK_MS;
      $('#adminLockout').show();
      refreshAdminButton();

      var tick = window.setInterval(function () {
        var left = Math.ceil((lockedUntil - Date.now()) / 1000);
        if (left <= 0) {
          window.clearInterval(tick);
          $('#adminLockout').hide();
          attempts = 0;
          refreshAdminButton();
          return;
        }
        $('#adminLockCount').text(left);
      }, 250);
    }

    function refreshAdminButton() {
      $('#adminSubmit').prop('disabled', !solved || isLocked());
    }

    $form.on('input', 'input', function () { rev(); clearAlert('#adminAlert'); });

    $form.on('submit', function (e) {
      e.preventDefault();
      if (isLocked() || !solved) { return; }
      clearAlert('#adminAlert');

      var user = $.trim($('#adminUser').val());
      var password = $('#adminPassword').val();
      if (!user || !password) {
        alertBox('#adminAlert', 'error', 'Enter both your username and password.');
        return;
      }

      // ADMIN_USER may be a bare name; the API stores it as an email.
      var email = user.indexOf('@') > -1 ? user : user + '@metroflow.lk';

      var $btn = $('#adminSubmit').prop('disabled', true);
      var label = $btn.html();
      $btn.html('<span class="spinner-border" role="status" aria-hidden="true"></span> Checking…');

      post('/admin-login', { Email: email, Password: password })
        .done(function (res) {
          saveSession(res.data.token, res.data.user);
          sceneState('is-open', true);
          sceneState('is-lights-on', true);
          sceneState('is-go', true);
          sceneState('is-driving', true);
          alertBox('#adminAlert', 'ok', 'Access granted. Opening the depot…');
          window.setTimeout(function () { window.location.href = 'admin.html'; }, reduceMotion ? 300 : 1800);
        })
        .fail(function (xhr) {
          attempts += 1;
          sceneState('is-denied', true, 1600);
          sceneState('is-stop', true);
          var left = LOCK_AFTER - attempts;
          var msg = xhr.status === 401 || xhr.status === 403
            ? 'Access denied'
            : errorFrom(xhr);
          alertBox('#adminAlert', 'error',
            msg + (left > 0 && left < 3 ? ' — ' + left + ' attempt(s) left.' : ''));
          $btn.prop('disabled', false).html(label);
          if (attempts >= LOCK_AFTER) { startLockout(); }
          refreshAdminButton();
        });
    });

    refreshAdminButton();
  }

  /* ============================== logout page =========================== */

  function initLogoutPage() {
    var $count = $('#loCount');
    if (!$count.length) { return; }

    clearSession();

    var left = 6;
    var timer = window.setInterval(function () {
      left -= 1;
      $count.text(left);
      if (left <= 0) {
        window.clearInterval(timer);
        window.location.href = 'index.html';
      }
    }, 1000);

    $('#loCancel').on('click', function (e) {
      e.preventDefault();
      window.clearInterval(timer);
      $('#loAuto').html('Auto-redirect cancelled.');
    });
  }

  /* ========================== forgot-password modal ====================== */

  function initForgot() {
    // jQuery Use #4 – .slideToggle() for the panel
    $(document).on('click', '#siForgot', function (e) {
      e.preventDefault();
      $('#siForgotPanel').slideToggle(reduceMotion ? 0 : 220);
    });

    $(document).on('submit', '#siForgotForm', function (e) {
      e.preventDefault();
      var email = $.trim($('#siForgotEmail').val());
      if (!RE.email.test(email)) {
        alertBox('#siForgotAlert', 'error', 'Please enter a valid email address.');
        return;
      }
      alertBox('#siForgotAlert', 'info',
        'If an account exists for ' + email + ', a reset link will be sent. (Demo only.)');
    });
  }

  /* ================================ tabs ================================ */

  function initTabs() {
    // jQuery Use #2 – delegated tab toggle
    $(document).on('click', '.mf-auth-tab', function () {
      var target = $(this).attr('data-tab');
      $('.mf-auth-tab').attr('aria-selected', 'false');
      $(this).attr('aria-selected', 'true');
      $('.mf-auth-panel').attr('hidden', true);
      $('#' + target).removeAttr('hidden');
      sceneState('is-stop', false);
      sceneState('is-honking', false);
    });

    if (/[?&]mode=signup/.test(window.location.search)) {
      $('.mf-auth-tab[data-tab="paneSignUp"]').trigger('click');
    }
  }

  /* ================================ boot ================================ */

  var MetroFlowAuth = {
    isLoggedIn: isLoggedIn,
    getUser: getUser,
    getToken: getToken,
    isAdmin: isAdmin,
    logout: logout,
    requireAuth: requireAuth,
    requireAdmin: requireAdmin,
    paintNavbar: paintNavbar,
    // Re-check the stored token against the server; clears a stale session.
    refresh: function () {
      if (!isLoggedIn()) { return $.Deferred().reject().promise(); }
      return getJson('/me')
        .done(function (res) {
          writeStore(K_USER, JSON.stringify(res.data.user));
          paintNavbar();
        })
        .fail(function (xhr) {
          if (xhr.status === 401) { clearSession(); paintNavbar(); }
        });
    }
  };

  window.MetroFlowAuth = MetroFlowAuth;

  $(function () {
    initTabs();
    initPasswordEyes();
    initSignIn();
    initSignUp();
    initAdmin();
    initLogoutPage();
    initForgot();

    // The navbar arrives asynchronously (home.js / main.js inject the
    // partial), so painting on a fixed timer is a race: on a slow load the
    // markup lands after the timer and a signed-in user keeps seeing the
    // logged-out buttons. Watch for it instead, and stop watching once it
    // has been painted.
    paintNavbar();
    watchForNavbar();
    $(document).on('click', '#logoutBtn', function (e) {
      e.preventDefault();
      logout();
    });

    startIdleWatch();
  });

}(window, jQuery));
