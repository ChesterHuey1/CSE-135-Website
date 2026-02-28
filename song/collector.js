(function() {
  'use strict';

const config = {
  endpoint: 'https://test.chesterhuey.com/collect',
  debug: false
};


  let userId = null;
  let sessionId = sessionStorage.getItem('_collector_sid') || 
  (sessionStorage.setItem('_collector_sid', Math.random().toString(36)+Date.now().toString(36)), 
  sessionStorage.getItem('_collector_sid'));
  let totalVisibleTime = 0;
  let pageShowTime = Date.now();


  function round(n) { return Math.round(n*100)/100; }

  function send(payload) {
    if (config.debug) { console.log(payload); return; }
    const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
    if (!navigator.sendBeacon(config.endpoint, blob)) {
      fetch(config.endpoint, {method:'POST', body:JSON.stringify(payload), headers:{'Content-Type':'application/json'}, keepalive:true});
    }
  }

  function getTechnographics() {
    return {
      userAgent: navigator.userAgent,
      language: navigator.language,
      cookiesEnabled: navigator.cookieEnabled,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: window.screen.width, height: window.screen.height },
      network: navigator.connection ? { type: navigator.connection.effectiveType } : {}
    };
  }

  function getNavigationTiming() {
    const n = performance.getEntriesByType('navigation')[0];
    if (!n) return {};
    return {
      start: n.fetchStart,
      end: n.loadEventEnd,
      total: round(n.loadEventEnd - n.fetchStart)
    };
  }

  // Track pageview
  function collectPageview() {
    send({
      type: 'pageview',
      url: window.location.href,
      timestamp: new Date().toISOString(),
      session: sessionId,
      userId: userId,
      tech: getTechnographics(),
      timing: getNavigationTiming()
    });
  }

  // Track visibility (exit, idle, time-on-page)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      totalVisibleTime += Date.now() - pageShowTime;
      send({
        type: 'page_exit',
        url: window.location.href,
        timeOnPage: totalVisibleTime,
        session: sessionId,
        userId: userId,
        timestamp: new Date().toISOString()
      });
    } else {
      pageShowTime = Date.now();
    }
  });

  // Track errors
  window.addEventListener('error', (e) => {
    send({
      type: 'error',
      message: e.message,
      source: e.filename,
      line: e.lineno,
      column: e.colno,
      session: sessionId,
      timestamp: new Date().toISOString()
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    send({
      type: 'promise_rejection',
      message: e.reason?.message || e.reason,
      session: sessionId,
      timestamp: new Date().toISOString()
    });
  });

  // Track mouse, click, keyboard
  ['click','keydown','keyup','scroll'].forEach(eventType => {
    window.addEventListener(eventType, (e) => {
      send({
        type: 'activity',
        event: eventType,
        details: { x: e.clientX, y: e.clientY, key: e.key, button: e.button, scrollY: window.scrollY },
        session: sessionId,
        timestamp: new Date().toISOString()
      });
    });
  });

 
  collectPageview();

})();
