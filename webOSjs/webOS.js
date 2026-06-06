/**
 * Minimal webOS.js shim
 *
 * Implements just enough of the official LG `webOS.js` library for this app:
 *   - webOS.platformBack()
 *   - webOS.service.request(uri, params)   // wraps PalmServiceBridge
 *
 * PalmServiceBridge is a built-in webOS TV browser global that dispatches
 * Luna service calls. This shim avoids shipping LG's proprietary webOS.js.
 */
(function (global) {
  'use strict';

  function isWebOS() {
    return /webOS|Web0S/i.test(navigator.userAgent) ||
      typeof global.PalmServiceBridge !== 'undefined';
  }

  if (!isWebOS()) return;

  function serviceRequest(uri, params) {
    params = params || {};
    var method = params.method || '';
    var parameters = params.parameters || {};
    var onSuccess = params.onSuccess || function () {};
    var onFailure = params.onFailure || function () {};
    var onComplete = params.onComplete || function () {};
    var subscribe = !!(params.subscribe || parameters.subscribe);

    // Normalize: strip a trailing '/' from the URI so callers don't have to
    // worry about whether they wrote `luna://foo` or `luna://foo/`. Without
    // this, `luna://foo/` + method `bar` produces `luna://foo//bar` (double
    // slash) which Luna treats as an invalid method lookup and rejects.
    var base = uri.charAt(uri.length - 1) === '/' ? uri.slice(0, -1) : uri;
    var url = base + (method ? '/' + method : '');
    var bridge;
    try {
      bridge = new global.PalmServiceBridge();
    } catch (e) {
      onFailure({ errorCode: -1, errorText: 'PalmServiceBridge unavailable' });
      onComplete();
      return { cancel: function () {} };
    }

    bridge.onservicecallback = function (msg) {
      var response;
      try { response = JSON.parse(msg); } catch (e) { response = {}; }
      if (response && (response.returnValue === false || response.errorCode)) {
        onFailure(response);
      } else {
        onSuccess(response);
      }
      if (!subscribe) onComplete();
    };

    var payload = {};
    for (var k in parameters) if (parameters.hasOwnProperty(k)) payload[k] = parameters[k];
    if (subscribe) payload.subscribe = true;

    bridge.call(url, JSON.stringify(payload));

    return {
      cancel: function () {
        try { bridge.cancel(); } catch (e) { /* ignore */ }
        onComplete();
      },
    };
  }

  function platformBack() {
    serviceRequest('luna://com.webos.service.applicationmanager', {
      method: 'launch',
      parameters: { id: 'com.webos.app.home' },
    });
  }

  global.webOS = global.webOS || {};
  global.webOS.platformBack = platformBack;
  global.webOS.service = global.webOS.service || {};
  global.webOS.service.request = serviceRequest;
})(window);
