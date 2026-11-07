// contact.js – the contact form on contact.html
// ---------------------------------------------------------------------------
// Namespace: MetroFlowContact. The only global created is
// window.MetroFlowContact; MF.escape comes from home.js.
//
// The form posts JSON to POST /api/contact and nothing is ever faked: if the
// server cannot be reached the visitor is told so and their text is left in
// the fields, rather than being shown a success card for a message that was
// never stored.
//
// jQuery Use numbers match the five listed for this task.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API_BASE = '/api';

  /* =======================================================================
     ===================  EDIT ME: CONTACT DETAILS  ========================
     =======================================================================
     The cards on the left of contact.html are rendered from this object, so
     changing a detail means changing it once, here.

     These are DEMO details for a university project – there is no real
     MetroFlow office, phone line or mailbox. contact.html says so on the
     page as well.
     ======================================================================= */
  var CONTACT_DETAILS = {
    address: {
      icon: 'bi-geo-alt',
      label: 'Head office',
      lines: ['MetroFlow Head Office', 'Colombo Fort, Sri Lanka']
    },
    phone: {
      icon: 'bi-telephone',
      label: 'Phone',
      lines: ['+94 11 000 0000'],
      href: 'tel:+941100000000'
    },
    email: {
      icon: 'bi-envelope',
      label: 'Email',
      lines: ['support@metroflow.lk'],
      href: 'mailto:support@metroflow.lk'
    },
    hours: {
      icon: 'bi-clock',
      label: 'Opening hours',
      lines: ['Mon–Sat, 8:00 AM – 6:00 PM', 'Closed on public holidays']
    }
  };

  // Keep this in step with Message.js on the server.
  var SUBJECTS = [
    'General enquiry',
    'Booking help',
    'Cancellation',
    'Feedback',
    'Report a problem'
  ];

  var MSG_MIN = 20;
  var MSG_MAX = 1000;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PHONE_RE = /^(\+94\d{9}|0\d{9})$/;

  /* ============================ helpers ================================= */

  var MF = window.MetroFlow = window.MetroFlow || {};
  if (typeof MF.escape !== 'function') {
    MF.escape = function (value) {
      return $('<div>').text(value == null ? '' : String(value)).html();
    };
  }
  function esc(value) { return MF.escape(value); }

  var MetroFlowContact = {};

  /* ======================= details cards (left column) ================== */
  /**
   * jQuery Use #4 – the detail cards are built from CONTACT_DETAILS with
   * .append(), so the markup never repeats a phone number or an address.
   */
  function renderDetails() {
    var $host = $('#contactDetails');
    if (!$host.length) { return; }

    $host.empty();

    $.each(['address', 'phone', 'email', 'hours'], function (i, key) {
      var item = CONTACT_DETAILS[key];
      if (!item) { return; }

      var body = '';
      $.each(item.lines || [], function (j, line) {
        var text = esc(line);
        // Only the first line of a card with an href becomes the link.
        if (j === 0 && item.href) {
          text = '<a href="' + esc(item.href) + '">' + text + '</a>';
        }
        body += '<p>' + text + '</p>';
      });

      $host.append(
        '<div class="col-sm-6 col-lg-12">' +
        '  <div class="mf-info-detail">' +
        '    <span class="mf-info-ic"><i class="bi ' + esc(item.icon) +
        '" aria-hidden="true"></i></span>' +
        '    <div>' +
        '      <h3>' + esc(item.label) + '</h3>' +
        body +
        '    </div>' +
        '  </div>' +
        '</div>'
      );
    });
  }

  /* ============================ the subject list ========================= */
  // Rendered from SUBJECTS so the option values cannot drift from the enum
  // the server validates against.
  function renderSubjects() {
    var $select = $('#cfSubject');
    if (!$select.length) { return; }

    var html = '<option value="" selected disabled>Choose a subject…</option>';
    $.each(SUBJECTS, function (i, subject) {
      html += '<option value="' + esc(subject) + '">' + esc(subject) + '</option>';
    });
    // jQuery Use #4 – .html() fills the select.
    $select.html(html);
  }

  /* ============================== validation ============================= */

  function normalisePhone(value) {
    return String(value || '').replace(/[\s()-]/g, '');
  }

  /**
   * Pure check – returns an error string or '' and touches no DOM.
   * Kept separate from paint() so asking "is this field valid?" can never
   * mark a pristine form as wrong.
   */
  function fieldError(name, value) {
    var text = $.trim(String(value == null ? '' : value));

    switch (name) {
      case 'Full_Name':
        if (!text) { return 'Please enter your full name.'; }
        if (text.length < 2) { return 'That looks too short – please enter your full name.'; }
        if (text.length > 60) { return 'Please keep your name under 60 characters.'; }
        return '';

      case 'Email':
        if (!text) { return 'Please enter your email address.'; }
        if (!EMAIL_RE.test(text)) { return 'Please enter a valid email, e.g. you@example.com'; }
        if (text.length > 100) { return 'That email is too long.'; }
        return '';

      case 'Phone':
        if (!text) { return ''; }                      // optional
        if (!PHONE_RE.test(normalisePhone(text))) {
          return 'Use +94 77 123 4567 or 077 123 4567.';
        }
        return '';

      case 'Subject':
        if ($.inArray(text, SUBJECTS) === -1) { return 'Please choose a subject.'; }
        return '';

      case 'Message':
        if (!text) { return 'Please tell us how we can help.'; }
        if (text.length < MSG_MIN) {
          return 'Please add a little more – at least ' + MSG_MIN + ' characters.';
        }
        if (text.length > MSG_MAX) {
          return 'Please keep your message under ' + MSG_MAX + ' characters.';
        }
        return '';

      default:
        return '';
    }
  }

  // Writes the result of fieldError() onto the field.
  function paint($field) {
    var name = String($field.attr('name') || '');
    var error = fieldError(name, $field.val());

    // jQuery Use #5 – .toggleClass() flips the Bootstrap validation state.
    $field.toggleClass('is-invalid', !!error);
    $field.attr('aria-invalid', error ? 'true' : 'false');

    var $msg = $('#' + $field.attr('id') + 'Msg');
    if ($msg.length) { $msg.text(error); }             // jQuery Use #5

    return !error;
  }

  /* =========================== character counter ========================= */
  /**
   * jQuery Use #2 + #5 – an input handler updating the live counter with
   * .text() and .toggleClass().
   */
  function initCounter() {
    var $area = $('#cfMessage');
    var $out = $('#cfCount');
    if (!$area.length || !$out.length) { return; }

    function update() {
      var len = $.trim(String($area.val() || '')).length;

      $out.text(len + ' / ' + MSG_MAX);
      $out.toggleClass('is-near', len > MSG_MAX - 100 && len <= MSG_MAX)
        .toggleClass('is-over', len > MSG_MAX);

      // Below the minimum, say how many are still needed.
      $('#cfCountHint').text(
        len === 0 ? '' :
          (len < MSG_MIN ? (MSG_MIN - len) + ' more to go' : '')
      );
    }

    $area.on('input change', update);
    update();
  }

  /* =============================== submit =============================== */

  function setBusy($form, busy) {
    var $btn = $('#cfSubmit');

    // jQuery Use #5 – .text() swaps the button label while in flight.
    $btn.prop('disabled', busy)
      .attr('aria-busy', busy ? 'true' : 'false')
      .find('.mf-info-btn-label').text(busy ? 'Sending…' : 'Send message');

    $btn.find('i')
      .toggleClass('bi-send', !busy)
      .toggleClass('bi-hourglass-split', busy);

    // Guards against a double submit from Enter while the click is disabled.
    $form.data('mf-busy', !!busy);
  }

  function status(text, kind) {
    $('#cfStatus')
      .text(text || '')
      .removeClass('is-error is-busy')
      .addClass(kind ? 'is-' + kind : '');
  }

  function showSuccess(data) {
    var ref = (data && data.Message_ID) ? data.Message_ID : '—';

    $('#contactFormWrap').addClass('d-none');

    // jQuery Use #4 – the confirmation card is built here, not pre-rendered.
    $('#contactSuccess')
      .removeClass('d-none')
      .html(
        '<div class="mf-info-tick"><i class="bi bi-check-lg" aria-hidden="true"></i></div>' +
        '<h2 class="h4">Message sent</h2>' +
        '<p class="mb-0">Thanks for getting in touch. Our team reads every message ' +
        'and will reply by email.</p>' +
        '<span class="mf-info-ref">' + esc(ref) + '</span>' +
        '<p class="small mb-4">Quote this reference if you follow up.</p>' +
        '<button type="button" class="mf-btn-outline-red" id="cfAgain">' +
        '<i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Send another message' +
        '</button>'
      )
      .attr('tabindex', '-1')
      .trigger('focus');
  }

  function friendlyError(jqXHR) {
    // status 0 = request never reached the server (offline, server stopped).
    if (!jqXHR || jqXHR.status === 0) {
      return 'Server unreachable, please try again. Your message is still here.';
    }
    if (jqXHR.status === 429) {
      return (jqXHR.responseJSON && jqXHR.responseJSON.error) ||
        'Too many messages from this address. Please try again in 15 minutes.';
    }
    if (jqXHR.status === 503) {
      return 'The message service is offline right now. Please try again shortly.';
    }
    if (jqXHR.status === 400) {
      return (jqXHR.responseJSON && jqXHR.responseJSON.error) ||
        'Please check the highlighted fields.';
    }
    return 'Something went wrong sending your message. Please try again.';
  }

  /**
   * jQuery Use #3 – validation, then .serializeArray() turned into the JSON
   * body. jQuery Use #1 – the $.ajax POST itself.
   */
  function initForm() {
    var $form = $('#contactForm');
    if (!$form.length) { return; }

    // jQuery Use #2 – validate a field when the visitor leaves it, and clear
    // the error as soon as they start fixing it.
    $form.on('blur', '[name]', function () {
      if ($(this).hasClass('mf-info-hp')) { return; }
      paint($(this));
    });

    $form.on('input change', '[name]', function () {
      var $field = $(this);
      if ($field.hasClass('is-invalid')) { paint($field); }
    });

    $form.on('submit', function (event) {
      event.preventDefault();

      if ($form.data('mf-busy')) { return; }           // double-submit guard

      // Validate every field, then focus the first bad one.
      var $fields = $form.find('[name]').not('.mf-info-hp');
      var bad = [];

      $fields.each(function () {
        if (!paint($(this))) { bad.push(this); }
      });

      if (bad.length) {
        status('Please fix the ' + bad.length + ' highlighted field' +
          (bad.length === 1 ? '' : 's') + ' and send again.', 'error');
        $(bad[0]).trigger('focus');
        return;
      }

      // .serializeArray() -> plain object -> JSON body.
      var payload = {};
      $.each($form.serializeArray(), function (i, pair) {
        payload[pair.name] = pair.value;
      });

      payload.Full_Name = $.trim(payload.Full_Name || '');
      payload.Email = $.trim(payload.Email || '').toLowerCase();
      payload.Message = $.trim(payload.Message || '');
      payload.Phone = normalisePhone(payload.Phone);
      if (!payload.Phone) { delete payload.Phone; }

      setBusy($form, true);
      status('Sending your message…', 'busy');

      $.ajax({
        url: API_BASE + '/contact',
        method: 'POST',
        contentType: 'application/json',
        dataType: 'json',
        timeout: 12000,
        data: JSON.stringify(payload)
      })
        .done(function (response) {
          status('');
          showSuccess(response && response.data);
        })
        .fail(function (jqXHR) {
          status(friendlyError(jqXHR), 'error');

          // Server-side field errors, if it sent any. Nothing the visitor
          // typed is cleared – they only have to fix what is wrong.
          var details = jqXHR && jqXHR.responseJSON && jqXHR.responseJSON.details;
          if (details) {
            $.each(details, function (name, message) {
              var $field = $form.find('[name="' + name + '"]');
              if (!$field.length) { return; }
              $field.addClass('is-invalid').attr('aria-invalid', 'true');
              $('#' + $field.attr('id') + 'Msg').text(message);
            });
            $form.find('.is-invalid').first().trigger('focus');
          }
        })
        .always(function () {
          setBusy($form, false);
        });
    });

    // "Send another message" – back to a clean form.
    $(document).on('click', '#cfAgain', function () {
      $('#contactSuccess').addClass('d-none').empty().removeAttr('tabindex');
      $('#contactFormWrap').removeClass('d-none');

      $form[0].reset();
      $form.find('.is-invalid').removeClass('is-invalid').removeAttr('aria-invalid');
      $form.find('.invalid-feedback').text('');
      renderSubjects();
      $('#cfMessage').trigger('input');
      status('');

      $('#cfName').trigger('focus');
    });
  }

  /* ================================= boot ================================ */

  MetroFlowContact.CONTACT_DETAILS = CONTACT_DETAILS;

  MetroFlowContact.init = function () {
    renderDetails();
    renderSubjects();
    initCounter();
    initForm();
  };

  window.MetroFlowContact = MetroFlowContact;

  $(function () {
    if ($('#contactForm').length || $('#contactDetails').length) {
      MetroFlowContact.init();
    }
  });

}(window, jQuery));
