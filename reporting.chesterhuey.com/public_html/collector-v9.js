/**
 * collector-v9.js â€” Production-Ready Analytics Collector
 * CSE 135 - Module 10: Production Readiness
 *
 * The final collector, incorporating every feature from Modules 01-09:
 *
 *   - IIFE with full public API: init, track, set, identify, use
 *   - Command queue processing (_cq pattern)
 *   - Consent checking (GPC + consent cookie)
 *   - Bot detection (webdriver, headless UA, automation globals)
 *   - Sampling (configurable session-based sample rate)
 *   - Session management (sessionStorage-based session ID)
 *   - Technographics (browser, device, screen, network, preferences)
 *   - Navigation & resource timing
 *   - Web Vitals (LCP, CLS, INP via PerformanceObserver)
 *   - Error tracking (JS errors, promise rejections, resource failures)
 *   - Plugin system (use() to register extensions)
 *   - Retry queue (sessionStorage-based, capped at 50)
 *   - Time-on-page tracking (visible time only)
 *   - Debug mode (console logging instead of sending)
 *   - Self-measurement (performance.mark / performance.measure)
 *
 * Usage:
 *   <script>
 *     window._cq = window._cq || [];
 *     _cq.push(['init', { endpoint: '/collect' }]);
 *   </script>
 *   <script async src="collector-v9.js"></script>
 */

(function () {
  'use strict';

  // â”€â”€ Configuration Defaults â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const config = {
    endpoint: '',
    enableVitals: true,
    enableErrors: true,
    sampleRate: 1.0,
    debug: false,
    respectConsent: true,
    detectBots: true
  };

  // â”€â”€ Internal State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let initialized = false;
  let blocked = false;           // Set true if consent/bot/sampling blocks collection
  const customData = {};           // Data set via set()
  let userId = null;             // Data set via identify()
  const plugins = [];              // Registered plugins
  const reportedErrors = new Set();
  let errorCount = 0;
  const MAX_ERRORS = 10;

  // â”€â”€ Web Vitals State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const vitals = { lcp: null, cls: 0, inp: null };

  // â”€â”€ Time-on-Page State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let pageShowTime = Date.now();
  let totalVisibleTime = 0;

  // â”€â”€ Utility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Round a number to two decimal places.
   */
  function round(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * Merge properties from src into dst (shallow).
   */
  function merge(dst, src) {
    for (const key of Object.keys(src)) {
      dst[key] = src[key];
    }
    return dst;
  }

  // â”€â”€ Consent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Check whether the user has granted analytics consent.
   * Returns false if Global Privacy Control is set or if the
   * analytics_consent cookie is absent or set to 'false'.
   */
  function hasConsent() {
    // Check Global Privacy Control
    if (navigator.globalPrivacyControl) {
      return false;
    }

    // Check consent cookie
    const cookies = document.cookie.split(';');
    for (const c of cookies) {
      const cookie = c.trim();
      if (cookie.indexOf('analytics_consent=') === 0) {
        return cookie.split('=')[1] === 'true';
      }
    }

    // No consent signal â€” default to false (GDPR opt-in model)
    return false;
  }

  // â”€â”€ Bot Detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Detect common bots and automated browsers.
   * Returns true if the visitor appears to be a bot.
   */
  function isBot() {
    // WebDriver flag (Puppeteer, Selenium, Playwright)
    if (navigator.webdriver) return true;

    // Headless browser indicators in user agent
    const ua = navigator.userAgent;
    if (/HeadlessChrome|PhantomJS|Lighthouse/i.test(ua)) return true;

    // Chrome UA without window.chrome object
    if (/Chrome/.test(ua) && !window.chrome) return true;

    // Automation framework globals
    if (window._phantom || window.__nightmare || window.callPhantom) return true;

    return false;
  }

  // â”€â”€ Sampling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Determine whether this session should be sampled.
   * Uses a persistent random value per session so the decision
   * is consistent across page navigations within the same session.
   */
  function isSampled() {
    if (config.sampleRate >= 1.0) return true;
    if (config.sampleRate <= 0) return false;

    const key = '_collector_sample';
    let val = sessionStorage.getItem(key);
    if (val === null) {
      val = Math.random();
      sessionStorage.setItem(key, val);
    } else {
      val = parseFloat(val);
    }
    return val < config.sampleRate;
  }

  // â”€â”€ Session Identity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Generate or retrieve a session ID from sessionStorage.
   */
  function getSessionId() {
    let sid = sessionStorage.getItem('_collector_sid');
    if (!sid) {
      sid = Math.random().toString(36).substring(2) + Date.now().toString(36);
      sessionStorage.setItem('_collector_sid', sid);
    }
    return sid;
  }

  // â”€â”€ Technographics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Collect network information via the Network Information API.
   */
  function getNetworkInfo() {
    if (!('connection' in navigator)) return {};
    const conn = navigator.connection;
    return {
      effectiveType: conn.effectiveType,
      downlink: conn.downlink,
      rtt: conn.rtt,
      saveData: conn.saveData
    };
  }

  /**
   * Collect a complete technographic profile.
   */
  function getTechnographics() {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      cookiesEnabled: navigator.cookieEnabled,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      pixelRatio: window.devicePixelRatio,
      cores: navigator.hardwareConcurrency || 0,
      memory: navigator.deviceMemory || 0,
      network: getNetworkInfo(),
      colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  }

  // â”€â”€ Navigation Timing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Extract key milestones from the Navigation Timing API.
   */
  function getNavigationTiming() {
    const entries = performance.getEntriesByType('navigation');
    if (!entries.length) return {};
    const n = entries[0];
    return {
      dnsLookup: round(n.domainLookupEnd - n.domainLookupStart),
      tcpConnect: round(n.connectEnd - n.connectStart),
      tlsHandshake: n.secureConnectionStart > 0 ? round(n.connectEnd - n.secureConnectionStart) : 0,
      ttfb: round(n.responseStart - n.requestStart),
      download: round(n.responseEnd - n.responseStart),
      domInteractive: round(n.domInteractive - n.fetchStart),
      domComplete: round(n.domComplete - n.fetchStart),
      loadEvent: round(n.loadEventEnd - n.fetchStart),
      fetchTime: round(n.responseEnd - n.fetchStart),
      transferSize: n.transferSize,
      headerSize: n.transferSize - n.encodedBodySize
    };
  }

  // â”€â”€ Resource Timing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Aggregate resource timing data by initiator type.
   */
  function getResourceSummary() {
    const resources = performance.getEntriesByType('resource');
    const summary = {
      script:         { count: 0, totalSize: 0, totalDuration: 0 },
      link:           { count: 0, totalSize: 0, totalDuration: 0 },
      img:            { count: 0, totalSize: 0, totalDuration: 0 },
      font:           { count: 0, totalSize: 0, totalDuration: 0 },
      fetch:          { count: 0, totalSize: 0, totalDuration: 0 },
      xmlhttprequest: { count: 0, totalSize: 0, totalDuration: 0 },
      other:          { count: 0, totalSize: 0, totalDuration: 0 }
    };
    resources.forEach((r) => {
      const type = summary[r.initiatorType] ? r.initiatorType : 'other';
      summary[type].count++;
      summary[type].totalSize += r.transferSize || 0;
      summary[type].totalDuration += r.duration || 0;
    });
    return { totalResources: resources.length, byType: summary };
  }

  // â”€â”€ Web Vitals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Initialize PerformanceObservers for LCP, CLS, and INP.
   */
  function initWebVitals() {
    // Largest Contentful Paint
    try {
      const lcpObs = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) {
          vitals.lcp = round(entries[entries.length - 1].startTime);
        }
      });
      lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch (e) { /* LCP not supported */ }

    // Cumulative Layout Shift
    try {
      const clsObs = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (!entry.hadRecentInput) {
            vitals.cls = round(vitals.cls + entry.value);
          }
        });
      });
      clsObs.observe({ type: 'layout-shift', buffered: true });
    } catch (e) { /* CLS not supported */ }

    // Interaction to Next Paint
    try {
      const inpObs = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (vitals.inp === null || entry.duration > vitals.inp) {
            vitals.inp = round(entry.duration);
          }
        });
      });
      inpObs.observe({ type: 'event', buffered: true, durationThreshold: 16 });
    } catch (e) { /* INP not supported */ }
  }

  /**
   * Return the current vitals snapshot.
   */
  function getWebVitals() {
    return { lcp: vitals.lcp, cls: vitals.cls, inp: vitals.inp };
  }

  // â”€â”€ Error Tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Report an error with deduplication and rate limiting.
   */
  function reportError(errorData) {
    if (errorCount >= MAX_ERRORS) return;

    const key = `${errorData.type}:${errorData.message || ''}:${errorData.source || ''}:${errorData.line || ''}`;
    if (reportedErrors.has(key)) return;
    reportedErrors.add(key);
    errorCount++;

    send({
      type: 'error',
      error: errorData,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      session: getSessionId()
    });

    window.dispatchEvent(new CustomEvent('collector:error', {
      detail: { errorData: errorData, count: errorCount }
    }));
  }

  /**
   * Initialize error listeners for JS errors, resource failures,
   * and unhandled promise rejections.
   */
  function initErrorTracking() {
    // JS runtime errors and resource load failures (capture phase)
    window.addEventListener('error', (event) => {
      if (event instanceof ErrorEvent) {
        reportError({
          type: 'js-error',
          message: event.message,
          source: event.filename,
          line: event.lineno,
          column: event.colno,
          stack: event.error ? event.error.stack : '',
          url: window.location.href
        });
      } else {
        const target = event.target;
        if (target && (target.tagName === 'IMG' || target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
          reportError({
            type: 'resource-error',
            tagName: target.tagName,
            src: target.src || target.href || '',
            url: window.location.href
          });
        }
      }
    }, true);

    // Unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      reportError({
        type: 'promise-rejection',
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : '',
        url: window.location.href
      });
    });
  }

  // â”€â”€ Retry Queue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Queue a failed payload for retry on the next page load.
   */
  function queueForRetry(payload) {
    try {
      const queue = JSON.parse(sessionStorage.getItem('_collector_retry') || '[]');
      if (queue.length >= 50) return;
      queue.push(payload);
      sessionStorage.setItem('_collector_retry', JSON.stringify(queue));
    } catch (e) { /* sessionStorage unavailable or full */ }
  }

  /**
   * Process any queued retries from previous page loads.
   */
  function processRetryQueue() {
    try {
      const queue = JSON.parse(sessionStorage.getItem('_collector_retry') || '[]');
      if (!queue.length) return;
      sessionStorage.removeItem('_collector_retry');
      queue.forEach((payload) => { send(payload); });
    } catch (e) { /* sessionStorage unavailable */ }
  }

  // â”€â”€ Payload Delivery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Send a payload to the analytics endpoint.
   * Uses sendBeacon with fetch fallback. Failed sends are queued
   * for retry. In debug mode, logs to console instead.
   */
  function send(payload) {
    // Self-measurement
    const markSupported = typeof performance.mark === 'function';
    if (markSupported) {
      performance.mark('collector_send_start');
    }

    // Debug mode: log instead of sending
    if (config.debug) {
      console.log('[Collector] Debug payload:', payload);
      return;
    }

    if (!config.endpoint) {
      console.warn('[Collector] No endpoint configured');
      return;
    }

    const json = JSON.stringify(payload);
    let sent = false;

    // Try sendBeacon first
    if (navigator.sendBeacon) {
      sent = navigator.sendBeacon(
        config.endpoint,
        new Blob([json], { type: 'application/json' })
      );
    }

    // Fallback to fetch with keepalive
    if (!sent) {
      fetch(config.endpoint, {
        method: 'POST',
        body: json,
        headers: { 'Content-Type': 'application/json' },
        keepalive: true
      }).catch(() => {
        queueForRetry(payload);
      });
    }

    // Self-measurement
    if (markSupported) {
      performance.mark('collector_send_end');
      performance.measure('collector_send', 'collector_send_start', 'collector_send_end');
    }

    // Notify listeners (for test pages)
    window.dispatchEvent(new CustomEvent('collector:beacon', { detail: payload }));
  }

  // â”€â”€ Collect & Send â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Build and send the full pageview payload.
   */
  function collect(type) {
    let payload = {
      type: type || 'pageview',
      url: window.location.href,
      title: document.title,
      referrer: document.referrer,
      timestamp: new Date().toISOString(),
      session: getSessionId(),
      technographics: getTechnographics(),
      timing: getNavigationTiming(),
      resources: getResourceSummary(),
      vitals: getWebVitals(),
      errorCount: errorCount,
      customData: customData
    };

    if (userId) {
      payload.userId = userId;
    }

    // Let plugins augment the payload
    plugins.forEach((plugin) => {
      if (typeof plugin.beforeSend === 'function') {
        const result = plugin.beforeSend(payload);
        if (result === false) return; // Plugin can suppress the beacon
        if (result && typeof result === 'object') {
          payload = result;
        }
      }
    });

    send(payload);

    window.dispatchEvent(new CustomEvent('collector:payload', { detail: payload }));
  }

  // â”€â”€ Time-on-Page Tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Handle visibility changes: accumulate visible time and send
   * exit beacons when the page is hidden.
   */
  function initTimeOnPage() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        totalVisibleTime += Date.now() - pageShowTime;

        // Send exit beacon with time-on-page
        const exitPayload = {
          type: 'page_exit',
          url: window.location.href,
          timeOnPage: totalVisibleTime,
          vitals: getWebVitals(),
          errorCount: errorCount,
          timestamp: new Date().toISOString(),
          session: getSessionId()
        };

        // Let plugins flush on exit
        plugins.forEach((plugin) => {
          if (typeof plugin.onExit === 'function') {
            plugin.onExit(exitPayload);
          }
        });

        send(exitPayload);
      } else {
        // Page became visible again â€” reset the timer
        pageShowTime = Date.now();
      }
    });
  }

  // â”€â”€ Command Queue Processing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Drain the _cq array and replace it with a live proxy.
   */
  function processQueue() {
    const queue = window._cq || [];
    for (const args of queue) {
      const method = args[0];
      const params = args.slice(1);
      if (typeof publicAPI[method] === 'function') {
        publicAPI[method](...params);
      }
    }
    // Replace array with live proxy
    window._cq = {
      push: (args) => {
        const method = args[0];
        const params = args.slice(1);
        if (typeof publicAPI[method] === 'function') {
          publicAPI[method](...params);
        }
      }
    };
  }

  // â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const publicAPI = {
    /**
     * Initialize the collector with the given options.
     * Checks consent, bot detection, and sampling gates.
     */
    init: function (options) {
      if (initialized) {
        console.warn('[Collector] Already initialized');
        return;
      }

      // Self-measurement: initialization timing
      if (typeof performance.mark === 'function') {
        performance.mark('collector_init_start');
      }

      // Merge user options into config
      if (options) merge(config, options);

      // Gate 1: Consent
      if (config.respectConsent && !hasConsent()) {
        console.log('[Collector] No consent â€” collection disabled');
        blocked = true;
        initialized = true;
        return;
      }

      // Gate 2: Bot detection
      if (config.detectBots && isBot()) {
        console.log('[Collector] Bot detected â€” collection disabled');
        blocked = true;
        initialized = true;
        return;
      }

      // Gate 3: Sampling
      if (!isSampled()) {
        console.log(`[Collector] Session not sampled (rate: ${config.sampleRate})`);
        blocked = true;
        initialized = true;
        return;
      }

      initialized = true;
      console.log('[Collector] Initialized', config);

      // Start subsystems
      if (config.enableVitals) initWebVitals();
      if (config.enableErrors) initErrorTracking();
      initTimeOnPage();

      // Process retry queue from previous page
      processRetryQueue();

      // Collect pageview after the page is fully loaded
      if (document.readyState === 'complete') {
        setTimeout(() => { collect('pageview'); }, 0);
      } else {
        window.addEventListener('load', () => {
          setTimeout(() => { collect('pageview'); }, 0);
        });
      }

      // Self-measurement
      if (typeof performance.mark === 'function') {
        performance.mark('collector_init_end');
        performance.measure('collector_init', 'collector_init_start', 'collector_init_end');
      }
    },

    /**
     * Track a custom event.
     */
    track: function (eventName, eventData) {
      if (!initialized || blocked) return;
      const payload = {
        type: 'event',
        event: eventName,
        data: eventData || {},
        timestamp: new Date().toISOString(),
        url: window.location.href,
        session: getSessionId(),
        customData: customData
      };
      if (userId) payload.userId = userId;
      send(payload);
    },

    /**
     * Set a custom key-value pair on all subsequent payloads.
     */
    set: function (key, value) {
      customData[key] = value;
    },

    /**
     * Identify the current user.
     */
    identify: function (id) {
      userId = id;
    },

    /**
     * Register a plugin/extension.
     * The plugin object may define:
     *   - init(config)       Called on registration
     *   - beforeSend(payload) Called before each beacon
     *   - onExit(payload)    Called on page exit
     */
    use: function (plugin) {
      if (!plugin || typeof plugin !== 'object') {
        console.warn('[Collector] Invalid plugin');
        return;
      }
      plugins.push(plugin);
      if (typeof plugin.init === 'function') {
        plugin.init(config);
      }
      console.log(`[Collector] Plugin registered: ${plugin.name || '(unnamed)'}`);
    }
  };

  // â”€â”€ Bootstrap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Process the command queue immediately
  processQueue();

  // â”€â”€ Expose for test pages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  window.__collector = {
    getNavigationTiming: getNavigationTiming,
    getResourceSummary: getResourceSummary,
    getTechnographics: getTechnographics,
    getWebVitals: getWebVitals,
    getSessionId: getSessionId,
    getNetworkInfo: getNetworkInfo,
    reportError: reportError,
    collect: collect,
    hasConsent: hasConsent,
    isBot: isBot,
    isSampled: isSampled,
    getErrorCount: () => errorCount,
    getConfig: () => config,
    isBlocked: () => blocked,
    api: publicAPI
  };

})();