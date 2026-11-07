// passenger-details.js – Passenger Management page (Member 3)
// ---------------------------------------------------------------------------
// Add, view, update, delete and search passengers. Every action is a jQuery
// Ajax call to the REST API (/api/passengers), which stores the passengers
// in MongoDB. Responses use the shared shape
// { success, message?, count?, data } / { success: false, error, details? }.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var API = '/api/passengers';
  var NIC_RE = /^([0-9]{9}[VvXx]|[0-9]{12}|[A-Za-z][0-9]{7,8})$/;
  var PHONE_RE = /^(\+94\d{9}|0\d{9})$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // form field id -> API field name
  var FIELDS = {
    fullName: 'Full_Name',
    nic: 'NIC',
    phone: 'Phone',
    email: 'Email',
    address: 'Address',
    gender: 'Gender'
  };

  var passengers = []; // last list loaded from the server
  var detailsModal = null; // Bootstrap modal for "View"
  var searchTimer = null;

  /* ===================== shared namespace & tiny helpers ================= */

  var MF = window.MetroFlow = window.MetroFlow || {};

  // Escape anything that ends up in innerHTML – API text is never trusted.
  if (typeof MF.escape !== 'function') {
    MF.escape = function (value) {
      return $('<div>').text(value == null ? '' : String(value)).html();
    };
  }

  // Inject a partial once (same loader as home.js – whichever runs first wins).
  if (typeof MF.loadPartial !== 'function') {
    MF.loadPartial = function (selector, url) {
      var $host = $(selector);
      if (!$host.length || $.trim($host.html()) !== '') {
        return $.Deferred().resolve(false).promise();
      }
      return $.get(url).done(function (html) {
        $host.html(html);
      }).fail(function () {
        $host.attr('data-partial-failed', url);
      });
    };
  }

  var esc = MF.escape;

  // jQuery Ajax wrapper: JSON in, JSON out
  function api(method, path, body) {
    return $.ajax({
      url: API + path,
      method: method,
      dataType: 'json',
      contentType: body ? 'application/json' : undefined,
      data: body ? JSON.stringify(body) : undefined,
      timeout: 10000
    });
  }

  // Not logged in as admin (or the session expired) -> admin login page
  function goToAdminLogin() {
    window.location.href = 'admin-login.html';
  }

  function errorMessage(xhr) {
    var r = xhr && xhr.responseJSON;
    return (r && (r.error || r.message)) || 'Could not reach the server – please try again';
  }

  function showMessage(message, type) {
    $('#passengerMessage').stop(true, true)
      .attr('class', 'alert mt-3 ' + (type === 'success' ? 'alert-success' : 'alert-danger'))
      .text(message).hide().fadeIn(200)
      .delay(3000).fadeOut(400);
  }

  /* ============================== validation ============================= */

  // Returns a list of { id, message } for every invalid field
  function validateForm(data) {
    var errors = [];
    if (!data.Full_Name || data.Full_Name.length < 2) errors.push({ id: 'fullName', message: 'Enter the full name (at least 2 letters).' });
    if (!NIC_RE.test(data.NIC)) errors.push({ id: 'nic', message: 'NIC must be 9 digits + V/X, 12 digits, or a passport number like N1234567.' });
    if (!PHONE_RE.test(data.Phone)) errors.push({ id: 'phone', message: 'Phone must look like +94771234567 or 0771234567.' });
    if (!EMAIL_RE.test(data.Email)) errors.push({ id: 'email', message: 'Enter a valid email address.' });
    return errors;
  }

  function showFormErrors(errors) {
    $('#passengerForm input, #passengerForm select').removeClass('is-invalid');
    if (!errors.length) {
      $('#formErrors').slideUp(150);
      return;
    }
    $.each(errors, function (i, e) { $('#' + e.id).addClass('is-invalid'); });
    $('#formErrors').html('<ul class="mb-0">' + $.map(errors, function (e) {
      return '<li>' + esc(e.message) + '</li>';
    }).join('') + '</ul>').slideDown(150);
    $('#' + errors[0].id).trigger('focus');
  }

  // Server-side validation errors ({ details: [{ field, message }] }) -> form fields
  function showServerErrors(xhr) {
    var r = xhr && xhr.responseJSON;
    if (r && $.isArray(r.details) && r.details.length) {
      var byApiField = {};
      $.each(FIELDS, function (id, field) { byApiField[field] = id; });
      showFormErrors($.map(r.details, function (d) {
        return { id: byApiField[d.field] || 'fullName', message: d.message };
      }));
    } else {
      showMessage(errorMessage(xhr), 'error');
    }
  }

  /* ================================ list ================================= */

  function renderPassengers() {
    var $body = $('#passengerTableBody').empty();

    if (!passengers.length) {
      $body.append('<tr><td colspan="6" class="mf-admin-state"><i class="bi bi-people" aria-hidden="true"></i>' +
        ($.trim($('#passengerSearch').val()) ? 'No passengers found.' : 'No passengers added yet.') + '</td></tr>');
      return;
    }

    $.each(passengers, function (i, p) {
      var id = esc(p.Passenger_ID);
      $('<tr>').html(
        '<td class="fw-bold">' + id + '</td>' +
        '<td>' + esc(p.Full_Name) + '</td>' +
        '<td class="mf-admin-num">' + esc(p.NIC) + '</td>' +
        '<td class="mf-admin-num">' + esc(p.Phone) + '</td>' +
        '<td>' + esc(p.Email) + '</td>' +
        '<td class="text-end text-nowrap">' +
          '<button type="button" class="mf-admin-ic-btn" data-action="view" data-id="' + id + '" aria-label="View ' + id + '">' +
            '<i class="bi bi-eye" aria-hidden="true"></i></button> ' +
          '<button type="button" class="mf-admin-ic-btn" data-action="edit" data-id="' + id + '" aria-label="Edit ' + id + '">' +
            '<i class="bi bi-pencil" aria-hidden="true"></i></button> ' +
          '<button type="button" class="mf-admin-ic-btn is-danger" data-action="delete" data-id="' + id + '" aria-label="Delete ' + id + '">' +
            '<i class="bi bi-trash" aria-hidden="true"></i></button>' +
        '</td>'
      ).hide().appendTo($body).fadeIn(200);
    });
  }

  // GET /api/passengers?search=...
  function loadPassengers() {
    var search = $.trim($('#passengerSearch').val());
    api('GET', search ? '?search=' + encodeURIComponent(search) : '')
      .done(function (payload) {
        passengers = payload.data || [];
        renderPassengers();
      })
      .fail(function (xhr) {
        if (xhr.status === 401 || xhr.status === 403) { return goToAdminLogin(); }
        $('#passengerTableBody').html('<tr><td colspan="6">Could not load passengers – ' + esc(errorMessage(xhr)) + '</td></tr>');
      });
  }

  /* ============================ add / update ============================= */

  function formData() {
    var data = {};
    $.each(FIELDS, function (id, field) {
      data[field] = $.trim($('#' + id).val());
    });
    data.Phone = data.Phone.replace(/[\s-]/g, '');
    return data;
  }

  function resetForm() {
    $('#passengerForm')[0].reset();
    $('#passengerId').val('');
    showFormErrors([]);
    $('#formTitle').text('Add Passenger');
    $('#savePassengerBtn').html('<i class="bi bi-person-plus"></i> Add Passenger');
    $('#cancelEditBtn').prop('hidden', true);
  }

  function savePassenger(e) {
    e.preventDefault();
    var data = formData();
    var errors = validateForm(data);
    showFormErrors(errors);
    if (errors.length) { return; }

    var id = $('#passengerId').val();
    var $btn = $('#savePassengerBtn').prop('disabled', true);

    // POST /api/passengers  or  PUT /api/passengers/:id
    api(id ? 'PUT' : 'POST', id ? '/' + encodeURIComponent(id) : '', data)
      .done(function (payload) {
        showMessage(payload.message || (id ? 'Passenger updated successfully.' : 'Passenger added successfully.'), 'success');
        resetForm();
        loadPassengers();
      })
      .fail(function (xhr) {
        if (xhr.status === 401 || xhr.status === 403) { return goToAdminLogin(); }
        showServerErrors(xhr);
      })
      .always(function () { $btn.prop('disabled', false); });
  }

  /* ============================ view / edit ============================== */

  // GET /api/passengers/:id – always shows the latest copy from the database
  function viewPassenger(id) {
    api('GET', '/' + encodeURIComponent(id))
      .done(function (payload) {
        var p = payload.data;
        var row = function (label, value) {
          return '<div class="d-flex justify-content-between gap-3 py-2 border-bottom">' +
            '<span class="mf-muted small fw-semibold">' + label + '</span><span class="fw-semibold text-end">' + esc(value) + '</span></div>';
        };
        $('#passengerDetailsTitle').text(p.Full_Name);
        $('#passengerDetailsContent').html(
          row('Passenger ID', p.Passenger_ID) +
          row('NIC / Passport', p.NIC) +
          row('Phone', p.Phone) +
          row('Email', p.Email) +
          row('Address', p.Address || 'Not provided') +
          row('Gender', p.Gender || 'Not provided') +
          row('Registered', p.createdAt ? new Date(p.createdAt).toLocaleString() : '—')
        );
        detailsModal.show();
      })
      .fail(function (xhr) { showMessage(errorMessage(xhr), 'error'); });
  }

  function editPassenger(id) {
    var p = $.grep(passengers, function (item) { return item.Passenger_ID === id; })[0];
    if (!p) { return; }
    $.each(FIELDS, function (fieldId, field) {
      $('#' + fieldId).val(p[field] || '');
    });
    $('#passengerId').val(p.Passenger_ID);
    showFormErrors([]);
    $('#formTitle').text('Edit Passenger ' + p.Passenger_ID);
    $('#savePassengerBtn').html('<i class="bi bi-pencil"></i> Update Passenger');
    $('#cancelEditBtn').prop('hidden', false);
    $('html, body').animate({ scrollTop: $('#passengerForm').offset().top - 120 }, 300);
  }

  /* ================================ delete =============================== */

  // DELETE /api/passengers/:id
  function deletePassenger(id) {
    var p = $.grep(passengers, function (item) { return item.Passenger_ID === id; })[0];
    if (!window.confirm('Are you sure you want to delete ' + (p ? p.Full_Name : id) + '?')) { return; }

    api('DELETE', '/' + encodeURIComponent(id))
      .done(function (payload) {
        showMessage(payload.message || 'Passenger deleted successfully.', 'success');
        if ($('#passengerId').val() === id) { resetForm(); }
        loadPassengers();
      })
      .fail(function (xhr) { showMessage(errorMessage(xhr), 'error'); });
  }

  /* ================================ events =============================== */

  function bind() {
    $('#passengerForm').on('submit', savePassenger);
    $('#cancelEditBtn').on('click', resetForm);

    // View / Edit / Delete buttons in the table (event delegation)
    $('#passengerTableBody').on('click', 'button[data-action]', function () {
      var id = $(this).data('id');
      var action = $(this).data('action');
      if (action === 'view') { viewPassenger(id); }
      if (action === 'edit') { editPassenger(id); }
      if (action === 'delete') { deletePassenger(id); }
    });

    // Search asks the server, after the user stops typing for 300 ms
    $('#passengerSearch').on('input', function () {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(loadPassengers, 300);
    });

    // Clear a field's red border as soon as it is corrected
    $('#passengerForm').on('input change', 'input, select', function () {
      $(this).removeClass('is-invalid');
    });

  }

  /* ================================= init ================================ */

  $(function () {
    // Passenger records are admin-only (the API checks this too)
    var Auth = window.MetroFlowAuth;
    if (Auth && !Auth.requireAdmin()) { return; }

    MF.loadPartial('#navbar', 'partials/navbar.html');
    MF.loadPartial('#footer', 'partials/footer.html');
    detailsModal = new window.bootstrap.Modal('#passengerDetailsModal');
    bind();
    loadPassengers();
  });
})(window, jQuery);
