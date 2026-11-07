// info-pages.js – shared behaviour for about.html, team.html and contact.html
// ---------------------------------------------------------------------------
// Three small jobs: the live numbers on the About page, the FAQ expand/collapse
// control, and the team grid with its module filter. The contact form lives in
// its own file (js/contact.js, namespace MetroFlowContact).
//
// Everything is inside one IIFE. The only global it creates is
// window.MetroFlowInfo; the shared window.MetroFlow namespace (escape +
// loadPartial) comes from home.js, which every page here loads first.
//
// The jQuery Use numbers in the comments refer to the five uses listed for
// this task; #1/#2/#4/#5 are here and #1(POST)/#2/#3/#5 are in contact.js.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API_BASE = '/api';

  /* =======================================================================
     ====================  EDIT ME: TEAM MEMBER DETAILS  ===================
     =======================================================================

     This is the ONLY place team details live. team.html renders whatever is
     in this array, so adding or removing a member means editing this list
     and nothing else.

     Every entry is a PLACEHOLDER. No real names, student IDs, emails or
     GitHub handles have been invented – replace the text inside the angle
     brackets with the real values.

     Fields:
       name      – "Member 1 – Firstname Lastname"
       studentId – your university student number
       role      – short job title shown in red under the name
       built     – ONE line: what this member actually built
       modules   – badges on the card; use the assignment's module names
       areas     – which filter chips the card answers to; any of:
                   "Front end", "Back end", "Database", "Documentation"
                   (needed because the filter row groups by area, not by
                   module – the only field added beyond the brief's list)
       email     – "" hides the email icon
       github    – "" hides the GitHub icon

     Member 1 is filled in as a worked SAMPLE so the format is obvious.
     ======================================================================= */
  var TEAM_MEMBERS = [
    {
      // ---- SAMPLE: this is the slice built in this repo so far. ----
      name: 'Member 1 – <Your Name>',
      studentId: '<Student ID>',
      role: 'Front end – public pages & chatbot',
      built: 'Home page, Metro AI chatbot, Explore page with the Leaflet map, ' +
             'Sign in / Sign up / Admin login, Bus search results, and the ' +
             'About, Our Team and Contact pages.',
      modules: ['Bus Search', 'REST API'],
      areas: ['Front end', 'Back end'],
      email: '',
      github: ''
    },
    {
      name: 'Member 2 – <Name>',
      studentId: '<Student ID>',
      role: '<Role / title>',
      built: '<One line: what this member built>',
      modules: ['Bus Management', 'Route Management'],
      areas: ['Back end'],
      email: '',
      github: ''
    },
    {
      name: 'Member 3 – <Name>',
      studentId: '<Student ID>',
      role: '<Role / title>',
      built: '<One line: what this member built>',
      modules: ['Schedule Management', 'Seat Management'],
      areas: ['Front end', 'Back end'],
      email: '',
      github: ''
    },
    {
      name: 'Member 4 – <Name>',
      studentId: '<Student ID>',
      role: '<Role / title>',
      built: '<One line: what this member built>',
      modules: ['Booking Management', 'Booking Search'],
      areas: ['Back end', 'Database'],
      email: '',
      github: ''
    },
    {
      name: 'Member 5 – <Name>',
      studentId: '<Student ID>',
      role: '<Role / title>',
      built: '<One line: what this member built>',
      modules: ['Passenger Management', 'REST API'],
      areas: ['Database', 'Documentation'],
      email: '',
      github: ''
    }
  ];

  var FILTERS = ['All', 'Front end', 'Back end', 'Database', 'Documentation'];

  /* ========================= helpers / namespace ========================= */

  var MF = window.MetroFlow = window.MetroFlow || {};

  // home.js defines this; redeclared here so these pages still work if the
  // script order is ever changed. Nothing reaches innerHTML unescaped.
  if (typeof MF.escape !== 'function') {
    MF.escape = function (value) {
      return $('<div>').text(value == null ? '' : String(value)).html();
    };
  }

  function esc(value) { return MF.escape(value); }

  // A placeholder is anything still wrapped in angle brackets.
  function isPlaceholder(text) {
    return /<[^>]*>/.test(String(text || ''));
  }

  // "Member 1 – Nimal Perera" -> "NP";  "Member 2 – <Name>" -> "M2"
  function initialsOf(member) {
    var name = String(member.name || '').replace(/^member\s*\d+\s*[–—-]\s*/i, '').trim();

    if (!name || isPlaceholder(name)) {
      var n = /member\s*(\d+)/i.exec(member.name || '');
      return n ? 'M' + n[1] : '?';
    }

    var parts = name.split(/\s+/).filter(Boolean);
    var first = parts[0] ? parts[0].charAt(0) : '';
    var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase() || '?';
  }

  function request(path) {
    if (window.Api && typeof window.Api.get === 'function') {
      return window.Api.get(path);
    }
    return $.ajax({ url: API_BASE + path, method: 'GET', dataType: 'json', timeout: 8000 });
  }

  // The API answers [], {data:[]} or {success,count,data}; normalise to array.
  function toArray(payload) {
    if ($.isArray(payload)) { return payload; }
    if (payload && $.isArray(payload.data)) { return payload.data; }
    if (payload && $.isArray(payload.buses)) { return payload.buses; }
    if (payload && $.isArray(payload.destinations)) { return payload.destinations; }
    return [];
  }

  var MetroFlowInfo = {};

  /* =======================================================================
     ABOUT – live numbers
     ======================================================================= */
  /**
   * jQuery Use #1 – $.ajax GET for the live counters.
   *
   * Each tile carries its own fallback in the markup (data-fallback), so a
   * failed or empty call leaves a sensible static figure on screen rather
   * than a zero. Nothing is animated: the brief asks for colour-only motion,
   * so the figure is written straight in with .text() (jQuery Use #5).
   */
  function initLiveNumbers() {
    var $tiles = $('[data-stat]');
    if (!$tiles.length) { return; }

    function paint(key, value, suffix) {
      var $tile = $tiles.filter('[data-stat="' + key + '"]');
      if (!$tile.length || !isFinite(value) || value <= 0) { return; }
      $tile.text(String(value) + (suffix || ''));
      $tile.closest('[data-stat-wrap]').attr('data-live', 'true');
    }

    // Destinations + provinces come from one call.
    request('/destinations')
      .done(function (payload) {
        var list = toArray(payload);
        if (!list.length) { return; }

        // No "+" on a live figure: it is the exact count, not a floor.
        paint('destinations', list.length);

        var provinces = {};
        $.each(list, function (i, d) {
          var p = $.trim(String((d && d.Province) || ''));
          if (p) { provinces[p] = true; }
        });
        paint('provinces', Object.keys(provinces).length);
      })
      .fail(function () {
        // Static fallback already on screen – just say so for assistive tech.
        $('#aboutStatsNote').text('Showing indicative figures – live totals are unavailable right now.');
      });

    // Daily services: buses scheduled for today.
    request('/buses')
      .done(function (payload) {
        var buses = toArray(payload);
        if (!buses.length) { return; }

        var today = new Date();
        var ymd = today.getFullYear() + '-' +
          ('0' + (today.getMonth() + 1)).slice(-2) + '-' +
          ('0' + today.getDate()).slice(-2);

        // jQuery Use #5 – .filter() narrowing the list to today's services.
        var todays = $.grep(buses, function (b) { return b && b.Travel_Date === ymd; });

        // Before the timetable is seeded for today, the whole list is still a
        // truthful "services in the network" figure.
        paint('buses', todays.length || buses.length);
      })
      .fail(function () {
        $('#aboutStatsNote').text('Showing indicative figures – live totals are unavailable right now.');
      });
  }

  /* =======================================================================
     ABOUT – FAQ
     ======================================================================= */
  /**
   * jQuery Use #2 – event handler for the FAQ expand/collapse control.
   * Bootstrap's accordion does the opening; this only drives the one button
   * that opens or closes all six at once, and keeps its label in step.
   */
  function initFaq() {
    var $toggle = $('#faqToggleAll');
    var $faq = $('#faqAccordion');
    if (!$toggle.length || !$faq.length) { return; }

    function syncLabel() {
      // jQuery Use #5 – .filter() counts the open panels, .text() relabels.
      var open = $faq.find('.accordion-collapse').filter('.show').length;
      var all = $faq.find('.accordion-collapse').length;
      var allOpen = open === all && all > 0;

      $toggle.find('.mf-info-toggle-label').text(allOpen ? 'Collapse all' : 'Expand all');
      $toggle.attr('aria-expanded', allOpen ? 'true' : 'false');
      // jQuery Use #5 – .toggleClass() swaps the chevron direction.
      $toggle.find('i').toggleClass('bi-chevron-bar-contract', allOpen)
        .toggleClass('bi-chevron-bar-expand', !allOpen);
    }

    $toggle.on('click', function () {
      var all = $faq.find('.accordion-collapse').length;
      var open = $faq.find('.accordion-collapse').filter('.show').length;
      var opening = open < all;

      $faq.find('.accordion-collapse').each(function () {
        var $panel = $(this);
        var isOpen = $panel.hasClass('show');
        if (opening === isOpen) { return; }      // already in the target state

        // Drive it through Bootstrap's own API when it is available, so the
        // button states and ARIA stay consistent with a manual click.
        var Collapse = window.bootstrap && window.bootstrap.Collapse;
        if (Collapse) {
          Collapse.getOrCreateInstance(this, { toggle: false })[opening ? 'show' : 'hide']();
        } else {
          $panel.toggleClass('show', opening);
          $faq.find('[data-bs-target="#' + this.id + '"]')
            .toggleClass('collapsed', !opening)
            .attr('aria-expanded', opening ? 'true' : 'false');
        }
      });
    });

    // Bootstrap fires these on every panel; relabel once they settle.
    $faq.on('shown.bs.collapse hidden.bs.collapse', syncLabel);
    syncLabel();
  }

  /* =======================================================================
     TEAM – cards + module filter
     ======================================================================= */

  function memberCard(member, index) {
    var placeholder = isPlaceholder(member.name) || isPlaceholder(member.studentId);
    var areas = $.isArray(member.areas) ? member.areas : [];
    var modules = $.isArray(member.modules) ? member.modules : [];

    var html = '';
    html += '<div class="col-md-6 col-lg-4 mf-info-member-col" ' +
            'data-areas="' + esc(areas.join('|')) + '">';
    html += '  <article class="mf-card mf-info-member' +
            (placeholder ? ' is-placeholder' : '') + '">';

    html += '    <div class="d-flex align-items-center gap-3">';
    html += '      <div class="mf-info-avatar" aria-hidden="true">' +
            esc(initialsOf(member)) + '</div>';
    html += '      <div class="flex-grow-1">';
    html += '        <h3 class="mf-info-member-name">' + esc(member.name) + '</h3>';
    html += '        <span class="mf-info-member-id">' + esc(member.studentId) + '</span>';
    html += '      </div>';
    html += '    </div>';

    html += '    <span class="mf-info-member-role">' + esc(member.role) + '</span>';
    html += '    <p class="mf-info-built"><strong>What I built:</strong> ' +
            esc(member.built) + '</p>';

    if (modules.length) {
      html += '    <ul class="mf-info-modules" aria-label="Modules worked on by ' +
              esc(member.name) + '">';
      $.each(modules, function (i, mod) {
        html += '<li class="mf-info-mod">' + esc(mod) + '</li>';
      });
      html += '    </ul>';
    }

    html += '    <div class="mf-info-member-links">';
    if (member.email) {
      html += '      <a class="mf-info-iconlink" href="mailto:' + esc(member.email) + '" ' +
              'aria-label="Email ' + esc(member.name) + '">' +
              '<i class="bi bi-envelope" aria-hidden="true"></i></a>';
    }
    if (member.github) {
      html += '      <a class="mf-info-iconlink" href="' + esc(member.github) + '" ' +
              'target="_blank" rel="noopener noreferrer" ' +
              'aria-label="' + esc(member.name) + ' on GitHub">' +
              '<i class="bi bi-github" aria-hidden="true"></i></a>';
    }
    if (placeholder) {
      html += '      <span class="mf-info-ph-note">' +
              (index === 0 ? 'Sample – copy this format' : 'Placeholder – fill in') +
              '</span>';
    }
    html += '    </div>';

    html += '  </article>';
    html += '</div>';
    return html;
  }

  /**
   * jQuery Use #4 – the team grid is built from TEAM_MEMBERS with
   * .empty() + .append(), not written out in team.html.
   */
  function renderTeam() {
    var $grid = $('#teamGrid');
    if (!$grid.length) { return false; }

    $grid.empty();

    if (!TEAM_MEMBERS.length) {
      $grid.append(
        '<div class="col-12"><div class="mf-state">' +
        '<i class="bi bi-people" aria-hidden="true"></i>' +
        'No team members listed yet – add them to TEAM_MEMBERS in js/info-pages.js.' +
        '</div></div>'
      );
      return true;
    }

    $.each(TEAM_MEMBERS, function (i, member) {
      $grid.append(memberCard(member, i));
    });

    return true;
  }

  /**
   * jQuery Use #2 + #5 – the filter chips. Clicking one shows only the cards
   * whose data-areas contains it, using .filter() to split the set and
   * .toggleClass() to hide the rest. No request, no reload.
   */
  function initTeamFilter() {
    var $row = $('#teamFilters');
    var $grid = $('#teamGrid');
    if (!$row.length || !$grid.length) { return; }

    // Count how many members sit in each area, so the chips can show it.
    function countFor(area) {
      if (area === 'All') { return TEAM_MEMBERS.length; }
      return $.grep(TEAM_MEMBERS, function (m) {
        return $.inArray(area, $.isArray(m.areas) ? m.areas : []) !== -1;
      }).length;
    }

    // jQuery Use #4 – chips are rendered from FILTERS, not hard-coded.
    $row.empty();
    $.each(FILTERS, function (i, area) {
      var n = countFor(area);
      $row.append(
        '<button type="button" class="mf-info-chip' + (i === 0 ? ' is-active' : '') + '" ' +
        'data-area="' + esc(area) + '" aria-pressed="' + (i === 0 ? 'true' : 'false') + '">' +
        esc(area) + '<span class="mf-info-chip-n">' + n + '</span></button>'
      );
    });

    function apply(area) {
      var $cards = $grid.find('.mf-info-member-col');

      var $match = area === 'All' ? $cards : $cards.filter(function () {
        var areas = String($(this).attr('data-areas') || '').split('|');
        return $.inArray(area, areas) !== -1;
      });

      $cards.addClass('d-none').attr('aria-hidden', 'true');
      $match.removeClass('d-none').removeAttr('aria-hidden');

      // jQuery Use #5 – .text() keeps the live count honest for screen readers.
      var shown = $match.length;
      $('#teamCount').text(
        area === 'All'
          ? 'Showing all ' + shown + ' member' + (shown === 1 ? '' : 's') + '.'
          : 'Showing ' + shown + ' member' + (shown === 1 ? '' : 's') + ' in ' + area + '.'
      );

      $('#teamEmpty').toggleClass('d-none', shown > 0);
    }

    $row.on('click', '.mf-info-chip', function () {
      var $chip = $(this);
      $row.find('.mf-info-chip').removeClass('is-active').attr('aria-pressed', 'false');
      $chip.addClass('is-active').attr('aria-pressed', 'true');
      apply(String($chip.attr('data-area')));
    });

    apply('All');
  }

  /* ================================= boot ================================ */

  MetroFlowInfo.TEAM_MEMBERS = TEAM_MEMBERS;   // handy when debugging in the console

  MetroFlowInfo.init = function () {
    initLiveNumbers();
    initFaq();
    if (renderTeam()) { initTeamFilter(); }
  };

  window.MetroFlowInfo = MetroFlowInfo;

  $(function () { MetroFlowInfo.init(); });

}(window, jQuery));
