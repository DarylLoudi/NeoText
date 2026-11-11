/**
 * The runtime the preview page starts with, before any project script. It runs inside the
 * sandboxed, opaque-origin frame and talks to the app only by `postMessage` (see protocol.ts):
 *
 * - relays `console.*`, uncaught errors, rejected promises and CSP violations;
 * - gives the page a `localStorage` (the opaque origin has none) seeded from `#__nt_storage`,
 *   capped at 1 MB, whose changes the app keeps per chat; `sessionStorage` lives in memory;
 * - stubs WebRTC, which CSP does not cover;
 * - turns link clicks into page switches inside the preview, and blocks the rest.
 *
 * Plain ES5 in a string: it is written into the page as is.
 */
export const PRELUDE_SOURCE = `(function () {
  var post = function (message) {
    try { parent.postMessage(message, '*'); } catch (e) {}
  };
  var show = function (value) {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.name + ': ' + value.message;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  };
  var line = function (args) {
    return Array.prototype.map.call(args, show).join(' ').slice(0, 2000);
  };
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      post({ type: 'nt-console', level: level === 'debug' ? 'log' : level, text: line(arguments) });
      if (original) original.apply(console, arguments);
    };
  });
  addEventListener('error', function (event) {
    var where = event.lineno ? ' (line ' + event.lineno + ')' : '';
    post({ type: 'nt-console', level: 'error', text: String(event.message || 'Error').slice(0, 1900) + where });
  });
  addEventListener('unhandledrejection', function (event) {
    post({ type: 'nt-console', level: 'error', text: line(['Unhandled rejection:', event.reason]) });
  });
  document.addEventListener('securitypolicyviolation', function (event) {
    post({ type: 'nt-blocked', url: String(event.blockedURI || event.violatedDirective).slice(0, 2000) });
  });

  var LIMIT = 1048576;
  function makeStorage(seed, onChange) {
    var data = Object.create(null);
    Object.keys(seed).forEach(function (k) { data[k] = String(seed[k]); });
    var size = function () {
      var total = 0;
      for (var k in data) total += k.length + data[k].length;
      return total;
    };
    var changed = function () { if (onChange) onChange(Object.assign({}, data)); };
    var store = {
      getItem: function (k) { k = String(k); return k in data ? data[k] : null; },
      setItem: function (k, v) {
        k = String(k); v = String(v);
        var before = data[k];
        data[k] = v;
        if (size() > LIMIT) {
          if (before === undefined) delete data[k]; else data[k] = before;
          throw new DOMException('The preview storage is full.', 'QuotaExceededError');
        }
        changed();
      },
      removeItem: function (k) { k = String(k); if (k in data) { delete data[k]; changed(); } },
      clear: function () { data = Object.create(null); changed(); },
      key: function (i) { var keys = Object.keys(data); return i < keys.length ? keys[i] : null; }
    };
    Object.defineProperty(store, 'length', { get: function () { return Object.keys(data).length; } });
    return store;
  }
  var seedEl = document.getElementById('__nt_storage');
  var seed = {};
  try { seed = JSON.parse(seedEl ? seedEl.textContent : '{}') || {}; } catch (e) {}
  var local = makeStorage(seed, function (items) { post({ type: 'nt-storage', items: items }); });
  var session = makeStorage({}, null);
  try { Object.defineProperty(window, 'localStorage', { value: local, configurable: false }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: session, configurable: false }); } catch (e) {}

  var RTC_NAMES = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel'];
  var noRtc = function () { throw new Error('WebRTC is not available in the preview.'); };
  function stubRtc(win) {
    if (!win) return win;
    RTC_NAMES.forEach(function (name) {
      try { Object.defineProperty(win, name, { value: noRtc, configurable: false, writable: false }); } catch (e) {}
    });
    return win;
  }
  stubRtc(window);
  // A frame the page adds runs its own scripts with the real WebRTC (a srcdoc frame needs no
  // network to load). Frames are taken out as soon as they appear, before their page loads.
  var FRAMES = 'iframe, frame, object, embed';
  var toldFrames = false;
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      Array.prototype.forEach.call(record.addedNodes, function (node) {
        if (node.nodeType !== 1) return;
        var found = node.matches(FRAMES) ? [node] : Array.prototype.slice.call(node.querySelectorAll(FRAMES));
        found.forEach(function (frame) { frame.remove(); });
        if (found.length > 0 && !toldFrames) {
          toldFrames = true;
          post({ type: 'nt-console', level: 'warn', text: 'Frames are not available in the preview.' });
        }
      });
    });
  }).observe(document, { childList: true, subtree: true });

  document.addEventListener('click', function (event) {
    var target = event.target;
    var link = target && target.closest ? target.closest('a[href]') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (href === '' || href.charAt(0) === '#') return;
    event.preventDefault();
    if (/^([a-z][a-z0-9+.-]*:|[/][/])/i.test(href)) {
      post({ type: 'nt-blocked', url: href.slice(0, 2000) });
      return;
    }
    post({ type: 'nt-navigate', path: href.split('#')[0].split('?')[0].slice(0, 500) });
  }, true);

  // Escape twice within half a second, when the page did not take it (checked once every
  // handler had its turn), lets the app take focus back out of the frame. One Escape stays the
  // page's own: games pause with it and dialogs close with it.
  var lastEscape = 0;
  addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || event.repeat) return;
    setTimeout(function () {
      if (event.defaultPrevented) return;
      var now = Date.now();
      if (now - lastEscape <= 500) {
        lastEscape = 0;
        post({ type: 'nt-escape' });
      } else {
        lastEscape = now;
      }
    }, 0);
  });

  addEventListener('load', function () { post({ type: 'nt-loaded' }); });
})();
`;
