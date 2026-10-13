(function () {
  'use strict';

  var CONFIG = window.BYD_CONFIG || {};
  var TIMEOUT_MS = 20000;
  var NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'\-]{1,59}$/u; // mirrors apps-script/Code.gs
  var PHONE_RE = /^[5-9]\d{7}$/;

  var MSG = {
    nameEmpty: 'Нэрээ оруулна уу.',
    nameInvalid: 'Нэрээ зөвхөн үсгээр оруулна уу.',
    phoneEmpty: 'Утасны дугаараа оруулна уу.',
    phoneInvalid: '8 оронтой утасны дугаар оруулна уу.',
    slot: 'Ирэх цагаа сонгоно уу.',
    network: 'Бүртгэл хийгдсэнгүй. Интернэт холболтоо шалгаад дахин оролдоно уу.',
    timeout: 'Сервер хариу өгсөнгүй. Бүртгэл баталгаажаагүй тул дахин оролдоно уу.',
    busy: 'Одоогоор хүсэлт их байна. Хэдэн секундын дараа дахин оролдоно уу.',
    server: 'Бүртгэл хадгалагдсангүй. Дахин оролдоно уу.',
    unavailable: 'Онлайн бүртгэл түр ажиллахгүй байна.',
    help: 'Асуудал давтагдвал ',
    helpTail: ' дугаарт залгана уу.',
    submitting: 'ИЛГЭЭЖ БАЙНА…',
    duplicateTitle: 'Та бүртгүүлсэн байна',
    duplicateMsg: 'Энэ дугаараар өмнө нь бүртгүүлсэн байна. Таны бүртгэл хүчинтэй.',
  };

  var form = document.getElementById('register-form');
  var submitBtn = document.getElementById('submit');
  var submitLabel = submitBtn.querySelector('.btn__label');
  var alertBox = document.getElementById('form-alert');
  var summary = document.getElementById('slot-summary');
  var slotsFieldset = form.querySelector('.slots');
  var nameInput = form.elements.name;
  var phoneInput = form.elements.phone;
  var registerSection = document.getElementById('register');
  var submitting = false;
  var attempted = false;

  // ---------- Config-driven links ----------
  document.querySelectorAll('[data-map-link]').forEach(function (a) {
    a.href = CONFIG.mapUrl || '#';
  });

  // ---------- Tracking (never blocks registration) ----------
  var tracking = (function () {
    var out = { source: 'landing', referrer: '' };
    try {
      var params = new URLSearchParams(window.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'].forEach(function (k) {
        out[k] = (params.get(k) || '').slice(0, 150);
      });
      out.referrer = (document.referrer || '').slice(0, 300);
    } catch (e) { /* tracking is best-effort */ }
    return out;
  })();

  // ---------- Phone formatting: "9911 2233" on screen, "99112233" on the wire ----------
  function phoneDigits(value) {
    var d = String(value).replace(/\D/g, '');
    if (d.length > 8 && d.indexOf('976') === 0) d = d.slice(3);
    return d.slice(0, 8);
  }
  function formatPhone(d) {
    return d.length > 4 ? d.slice(0, 4) + ' ' + d.slice(4) : d;
  }
  phoneInput.addEventListener('input', function () {
    var formatted = formatPhone(phoneDigits(phoneInput.value));
    if (formatted !== phoneInput.value) phoneInput.value = formatted;
    if (attempted) validateField('phone');
  });
  nameInput.addEventListener('input', function () {
    if (attempted) validateField('name');
  });

  // ---------- Slot selection ----------
  function selectedSlot() {
    var checked = form.querySelector('input[name="slot"]:checked');
    return checked ? checked.value : '';
  }
  form.addEventListener('change', function (e) {
    if (e.target.name !== 'slot') return;
    summary.textContent = selectedSlot() || '—';
    validateField('slot');
  });

  // ---------- Validation ----------
  function checks() {
    var name = nameInput.value.replace(/\s+/g, ' ').trim();
    var phone = phoneDigits(phoneInput.value);
    return {
      slot: selectedSlot() ? '' : MSG.slot,
      name: !name ? MSG.nameEmpty : NAME_RE.test(name) ? '' : MSG.nameInvalid,
      phone: !phone ? MSG.phoneEmpty : PHONE_RE.test(phone) ? '' : MSG.phoneInvalid,
    };
  }

  function setError(field, message) {
    form.querySelector('[data-error-for="' + field + '"]').textContent = message;
    if (field === 'slot') {
      slotsFieldset.classList.toggle('is-invalid', !!message);
    } else {
      var input = form.elements[field];
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function validateField(field) {
    var message = checks()[field];
    setError(field, message);
    return !message;
  }

  function validateAll() {
    var result = checks();
    var firstInvalid = null;
    ['slot', 'name', 'phone'].forEach(function (f) {
      setError(f, result[f]);
      if (result[f] && !firstInvalid) firstInvalid = f;
    });
    return firstInvalid;
  }

  function focusField(field) {
    var el = field === 'slot' ? form.querySelector('input[name="slot"]') : form.elements[field];
    el.focus({ preventScroll: true });
    (field === 'slot' ? slotsFieldset : el).scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // ---------- Alerts (built with text nodes only) ----------
  function showAlert(message) {
    alertBox.textContent = '';
    alertBox.appendChild(document.createTextNode(message + ' ' + MSG.help));
    var tel = document.createElement('a');
    tel.href = 'tel:+97689102070';
    tel.textContent = '8910-2070';
    alertBox.appendChild(tel);
    alertBox.appendChild(document.createTextNode(MSG.helpTail));
    alertBox.hidden = false;
  }
  function clearAlert() {
    alertBox.hidden = true;
    alertBox.textContent = '';
  }

  function setSubmitting(on) {
    submitting = on;
    submitBtn.disabled = on;
    submitBtn.classList.toggle('is-loading', on);
    submitBtn.setAttribute('aria-busy', on ? 'true' : 'false');
    submitLabel.textContent = on ? MSG.submitting : 'БҮРТГЭЛ БАТАЛГААЖУУЛАХ';
  }

  // ---------- Submit ----------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (submitting) return;
    attempted = true;
    clearAlert();

    var invalid = validateAll();
    if (invalid) {
      focusField(invalid);
      return;
    }
    if (!CONFIG.endpoint) {
      showAlert(MSG.unavailable);
      return;
    }

    var payload = {
      name: nameInput.value.replace(/\s+/g, ' ').trim(),
      phone: phoneDigits(phoneInput.value),
      slot: selectedSlot(),
      website: form.elements.website.value,
      source: tracking.source,
      utm_source: tracking.utm_source || '',
      utm_medium: tracking.utm_medium || '',
      utm_campaign: tracking.utm_campaign || '',
      utm_content: tracking.utm_content || '',
      referrer: tracking.referrer,
    };

    setSubmitting(true);
    var controller = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, TIMEOUT_MS);

    // text/plain keeps this a "simple" CORS request, which Apps Script can answer.
    fetch(CONFIG.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        // The server was reached: HTTP errors or unreadable bodies are "not saved", not a connection problem.
        if (!res.ok) return { ok: false, code: 'http_' + res.status };
        return res.json().catch(function () { return { ok: false, code: 'bad_response' }; });
      })
      .then(function (data) {
        // Success only on an explicit confirmation carrying the stored registration ID.
        if (data && data.ok === true && typeof data.id === 'string' && data.id) {
          showSuccess(data);
          return;
        }
        var code = data && data.code;
        var fieldMsg = code === 'invalid' && { slot: MSG.slot, name: MSG.nameInvalid, phone: MSG.phoneInvalid }[data.field];
        if (fieldMsg) {
          setError(data.field, fieldMsg);
          focusField(data.field);
        } else {
          showAlert(code === 'busy' ? MSG.busy : MSG.server);
        }
      })
      .catch(function (err) {
        showAlert(err && err.name === 'AbortError' ? MSG.timeout : MSG.network);
      })
      .then(function () {
        clearTimeout(timer);
        if (!form.hidden) setSubmitting(false);
      });
  });

  // ---------- Success ----------
  function showSuccess(data) {
    document.getElementById('success-slot').textContent = String(data.slot || selectedSlot());
    document.getElementById('success-id').textContent = String(data.id);
    if (data.duplicate) {
      document.getElementById('success-title').textContent = MSG.duplicateTitle;
      document.getElementById('success-msg').textContent = MSG.duplicateMsg;
    }
    form.hidden = true;
    var success = document.getElementById('success');
    success.hidden = false;
    registerSection.scrollIntoView({ block: 'start', behavior: 'smooth' });
    document.getElementById('success-title').focus({ preventScroll: true });
    updateSticky();
  }

  // ---------- CTA links: scroll to the form without jumping focus into a text field ----------
  document.querySelectorAll('[data-cta]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      registerSection.scrollIntoView({ block: 'start', behavior: 'smooth' });
      registerSection.focus({ preventScroll: true });
    });
  });

  // ---------- Sticky mobile CTA: only once both the hero and the form have scrolled out of view ----------
  var sticky = document.getElementById('sticky-cta');
  var stickyLink = sticky.querySelector('a');
  var hero = document.querySelector('.hero'); // the form sits directly below it on mobile
  var seen = { hero: true, register: false };
  var mobile = window.matchMedia('(max-width: 1023px)'); // desktop shows the form beside the hero

  function updateSticky() {
    var show = mobile.matches && !seen.hero && !seen.register && !form.hidden;
    sticky.classList.toggle('is-visible', show);
    sticky.setAttribute('aria-hidden', show ? 'false' : 'true');
    stickyLink.tabIndex = show ? 0 : -1;
    document.body.classList.toggle('has-sticky', show);
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        seen[entry.target === hero ? 'hero' : 'register'] = entry.isIntersecting;
      });
      updateSticky();
    });
    io.observe(hero);
    io.observe(registerSection);
  }
})();
