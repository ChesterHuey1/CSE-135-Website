/**
 * dashboard.js
 * Fetches data from the /api/* REST endpoints and renders
 * four D3.js charts:
 *   1. Pageviews over time (area + line)
 *   2. Events by type (horizontal bar)
 *   3. Browser breakdown (donut)
 *   4. Web Vitals LCP & TTFB trend (dual line)
 */

// ── Config ────────────────────────────────────────────────────
const API_BASE = '';   // same origin; change to 'https://reporting.chesterhuey.com' if cross-origin

// Blue palette used across all charts
const BLUE = {
  900: '#0f2544',
  800: '#1a3a6b',
  600: '#1d5fc4',
  500: '#2e73e8',
  400: '#5a96f0',
  300: '#8ab8f8',
  200: '#b8d3fa',
  100: '#deeafd',
};

const DONUT_COLORS = [
  BLUE[500], BLUE[400], BLUE[300], BLUE[200], BLUE[600], BLUE[800]
];

// ── Tooltip ───────────────────────────────────────────────────
const tooltip = d3.select('body')
  .append('div')
  .attr('class', 'd3-tooltip');

function showTip(html, event) {
  tooltip.html(html).style('opacity', 1)
    .style('left', (event.pageX + 14) + 'px')
    .style('top',  (event.pageY - 28) + 'px');
}
function hideTip() { tooltip.style('opacity', 0); }

// ── Fetch helpers ─────────────────────────────────────────────
async function apiFetch(path) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

function loading(selector) {
  d3.select(selector).html('<div class="loading">loading…</div>');
}

// ── Utility ───────────────────────────────────────────────────
function parseDate(str) {
  return str ? new Date(str) : null;
}

function fmtDate(d) {
  return d3.timeFormat('%b %d')(d);
}

function fmtNum(n) {
  return n == null ? '—' : d3.format(',')(n);
}

// ── 1. Pageviews Over Time (area + line) ─────────────────────
async function drawPageviewTimeline() {
  loading('#chart-pv-timeline');

  const raw = await apiFetch('/api/pageviews');
  const rows = raw.data || [];

  // Group by date
  const byDay = d3.rollup(
    rows,
    v => v.length,
    d => d3.timeDay.floor(parseDate(d.collected_at))
  );

  let data = Array.from(byDay, ([date, count]) => ({ date, count }))
    .filter(d => d.date)
    .sort((a, b) => a.date - b.date);

  // Fill gaps in the last 14 days
  if (data.length) {
    const maxDate = d3.max(data, d => d.date);
    const minDate = d3.timeDay.offset(maxDate, -13);
    const allDays = d3.timeDays(minDate, d3.timeDay.offset(maxDate, 1));
    const map = new Map(data.map(d => [d.date.toDateString(), d.count]));
    data = allDays.map(date => ({
      date,
      count: map.get(date.toDateString()) || 0
    }));
  }

  const total = d3.sum(data, d => d.count);
  d3.select('#total-pv').text(`total: ${fmtNum(total)}`);
  d3.select('#val-pageviews').text(fmtNum(total));

  const container = document.getElementById('chart-pv-timeline');
  container.innerHTML = '';
  const W = container.clientWidth || 800;
  const H = 180;
  const margin = { top: 12, right: 20, bottom: 32, left: 40 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top - margin.bottom;

  const svg = d3.select('#chart-pv-timeline')
    .append('svg').attr('width', W).attr('height', H);

  // Gradient
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient')
    .attr('id', 'area-gradient').attr('x1', 0).attr('x2', 0)
    .attr('y1', 0).attr('y2', 1);
  grad.append('stop').attr('offset', '0%').attr('stop-color', BLUE[500]).attr('stop-opacity', .25);
  grad.append('stop').attr('offset', '100%').attr('stop-color', BLUE[500]).attr('stop-opacity', 0);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleTime().domain(d3.extent(data, d => d.date)).range([0, iW]);
  const y = d3.scaleLinear().domain([0, d3.max(data, d => d.count) * 1.2 || 1]).range([iH, 0]).nice();

  // Grid
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).tickSize(-iW).tickFormat('').ticks(4));

  // Area
  const area = d3.area()
    .x(d => x(d.date)).y0(iH).y1(d => y(d.count))
    .curve(d3.curveCatmullRom);
  g.append('path').datum(data).attr('class', 'area-path').attr('d', area);

  // Line
  const line = d3.line()
    .x(d => x(d.date)).y(d => y(d.count))
    .curve(d3.curveCatmullRom);
  g.append('path').datum(data).attr('class', 'line-path').attr('d', line);

  // Dots
  g.selectAll('.dot').data(data).join('circle')
    .attr('class', 'dot').attr('r', 3)
    .attr('cx', d => x(d.date)).attr('cy', d => y(d.count))
    .on('mouseover', (e, d) => showTip(`${fmtDate(d.date)}: <b>${d.count}</b> pageviews`, e))
    .on('mouseout', hideTip);

  // Axes
  g.append('g').attr('class', 'axis')
    .attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(Math.min(data.length, 7)).tickFormat(fmtDate));

  g.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format('d')));
}

// ── 2. Events by Type (horizontal bar) ───────────────────────
async function drawEventsBar() {
  loading('#chart-events-bar');

  const raw = await apiFetch('/api/events');
  const rows = raw.data || [];

  const byType = d3.rollup(rows, v => v.length, d => d.event_name || 'unknown');
  const data = Array.from(byType, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const total = d3.sum(data, d => d.count);
  d3.select('#total-events-bar').text(`total: ${fmtNum(total)}`);
  d3.select('#val-events').text(fmtNum(total));

  const container = document.getElementById('chart-events-bar');
  container.innerHTML = '';
  const W = container.clientWidth || 380;
  const H = 200;
  const margin = { top: 8, right: 48, bottom: 20, left: 100 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top - margin.bottom;

  const svg = d3.select('#chart-events-bar')
    .append('svg').attr('width', W).attr('height', H);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const y = d3.scaleBand().domain(data.map(d => d.name)).range([0, iH]).padding(.3);
  const x = d3.scaleLinear().domain([0, d3.max(data, d => d.count) || 1]).range([0, iW]).nice();

  // Grid
  g.append('g').attr('class', 'grid')
    .call(d3.axisBottom(x).tickSize(iH).tickFormat('').ticks(4))
    .attr('transform', 'translate(0,0)');

  // Bars
  g.selectAll('.bar').data(data).join('rect')
    .attr('class', 'bar')
    .attr('y', d => y(d.name))
    .attr('height', y.bandwidth())
    .attr('x', 0)
    .attr('width', d => x(d.count))
    .attr('fill', (d, i) => i === 0 ? BLUE[500] : BLUE[300])
    .attr('rx', 3)
    .on('mouseover', (e, d) => showTip(`${d.name}: <b>${d.count}</b>`, e))
    .on('mouseout', hideTip);

  // Value labels
  g.selectAll('.bar-label').data(data).join('text')
    .attr('class', 'bar-label')
    .attr('x', d => x(d.count) + 6)
    .attr('y', d => y(d.name) + y.bandwidth() / 2 + 4)
    .attr('text-anchor', 'start')
    .text(d => d.count);

  // Y axis (event names)
  g.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).tickSize(0))
    .call(g => g.select('.domain').remove());

  // X axis
  g.append('g').attr('class', 'axis')
    .attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format('d')));
}

// ── 3. Browser Breakdown (donut) ──────────────────────────────
async function drawBrowserDonut() {
  loading('#chart-browsers');

  const raw = await apiFetch('/api/sessions');
  const rows = raw.data || [];

  function detectBrowser(ua) {
    if (!ua) return 'Unknown';
    if (/Firefox/i.test(ua))  return 'Firefox';
    if (/Edg/i.test(ua))      return 'Edge';
    if (/OPR/i.test(ua))      return 'Opera';
    if (/Chrome/i.test(ua))   return 'Chrome';
    if (/Safari/i.test(ua))   return 'Safari';
    return 'Other';
  }

  const byBrowser = d3.rollup(rows, v => v.length, d => detectBrowser(d.user_agent));
  const data = Array.from(byBrowser, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const total = d3.sum(data, d => d.count);
  d3.select('#total-browsers').text(`${fmtNum(total)} sessions`);
  d3.select('#val-sessions').text(fmtNum(total));

  const container = document.getElementById('chart-browsers');
  container.innerHTML = '';
  const W = container.clientWidth || 380;
  const H = 200;
  const radius = Math.min(W * .45, H * .45);
  const cx = W * .38;

  const svg = d3.select('#chart-browsers')
    .append('svg').attr('width', W).attr('height', H);
  const g = svg.append('g').attr('transform', `translate(${cx},${H / 2})`);

  const color = d3.scaleOrdinal().domain(data.map(d => d.name)).range(DONUT_COLORS);
  const pie   = d3.pie().value(d => d.count).sort(null);
  const arc   = d3.arc().innerRadius(radius * .55).outerRadius(radius);
  const arcHover = d3.arc().innerRadius(radius * .55).outerRadius(radius * 1.06);

  g.selectAll('.arc-slice').data(pie(data)).join('path')
    .attr('class', 'arc-slice')
    .attr('d', arc)
    .attr('fill', d => color(d.data.name))
    .attr('stroke', '#fff').attr('stroke-width', 2)
    .on('mouseover', function(e, d) {
      d3.select(this).attr('d', arcHover);
      const pct = total ? ((d.data.count / total) * 100).toFixed(1) : 0;
      showTip(`${d.data.name}: <b>${d.data.count}</b> (${pct}%)`, e);
    })
    .on('mouseout', function() {
      d3.select(this).attr('d', arc);
      hideTip();
    });

  // Centre label
  g.append('text')
    .attr('text-anchor', 'middle').attr('dy', '-0.2em')
    .style('font-family', "'DM Mono', monospace")
    .style('font-size', '22px').style('font-weight', '500')
    .style('fill', BLUE[800]).text(fmtNum(total));
  g.append('text')
    .attr('text-anchor', 'middle').attr('dy', '1.2em')
    .style('font-family', "'DM Sans', sans-serif")
    .style('font-size', '10px').style('fill', '#9bacc8').text('sessions');

  // Legend
  const legend = svg.append('g').attr('transform', `translate(${cx + radius + 18}, ${H / 2 - (data.length * 18) / 2})`);
  data.forEach((d, i) => {
    const row = legend.append('g').attr('transform', `translate(0,${i * 20})`);
    row.append('rect').attr('width', 10).attr('height', 10).attr('y', -1)
      .attr('rx', 2).attr('fill', color(d.name));
    row.append('text').attr('x', 16).attr('y', 8)
      .style('font-family', "'DM Mono', monospace")
      .style('font-size', '10px').style('fill', '#4e6080')
      .text(`${d.name} (${d.count})`);
  });
}

// ── 4. Web Vitals Trend (dual line) ───────────────────────────
async function drawVitalsTrend() {
  loading('#chart-vitals');

  const raw = await apiFetch('/api/pageviews');
  const rows = raw.data || [];

  // Average LCP & TTFB per day
  const byDay = d3.rollup(
    rows.filter(r => r.lcp != null || r.nt_ttfb != null),
    v => ({
      lcp:  d3.mean(v.filter(r => r.lcp != null), r => r.lcp),
      ttfb: d3.mean(v.filter(r => r.nt_ttfb != null), r => r.nt_ttfb)
    }),
    d => d3.timeDay.floor(parseDate(d.collected_at))
  );

  let data = Array.from(byDay, ([date, vals]) => ({ date, ...vals }))
    .filter(d => d.date)
    .sort((a, b) => a.date - b.date);

  const avgLcp  = d3.mean(data, d => d.lcp)  || 0;
  const avgTtfb = d3.mean(data, d => d.ttfb) || 0;
  d3.select('#total-vitals').text(`avg LCP: ${Math.round(avgLcp)}ms · avg TTFB: ${Math.round(avgTtfb)}ms`);

  const container = document.getElementById('chart-vitals');
  container.innerHTML = '';
  const W = container.clientWidth || 800;
  const H = 180;
  const margin = { top: 12, right: 80, bottom: 32, left: 52 };
  const iW = W - margin.left - margin.right;
  const iH = H - margin.top - margin.bottom;

  const svg = d3.select('#chart-vitals')
    .append('svg').attr('width', W).attr('height', H);
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  if (!data.length) {
    g.append('text').attr('x', iW / 2).attr('y', iH / 2)
      .attr('text-anchor', 'middle')
      .style('fill', '#9bacc8').style('font-size', '12px')
      .text('No vitals data yet');
    return;
  }

  const x = d3.scaleTime().domain(d3.extent(data, d => d.date)).range([0, iW]);
  const allVals = [...data.map(d => d.lcp || 0), ...data.map(d => d.ttfb || 0)];
  const y = d3.scaleLinear().domain([0, d3.max(allVals) * 1.2 || 100]).range([iH, 0]).nice();

  // Grid
  g.append('g').attr('class', 'grid')
    .call(d3.axisLeft(y).tickSize(-iW).tickFormat('').ticks(4));

  // LCP line
  const lcpLine = d3.line()
    .defined(d => d.lcp != null)
    .x(d => x(d.date)).y(d => y(d.lcp))
    .curve(d3.curveCatmullRom);
  g.append('path').datum(data).attr('class', 'line-path').attr('d', lcpLine);

  // TTFB line
  const ttfbLine = d3.line()
    .defined(d => d.ttfb != null)
    .x(d => x(d.date)).y(d => y(d.ttfb))
    .curve(d3.curveCatmullRom);
  g.append('path').datum(data).attr('class', 'line-path-ttfb').attr('d', ttfbLine);

  // Dots LCP
  g.selectAll('.dot').data(data.filter(d => d.lcp != null)).join('circle')
    .attr('class', 'dot').attr('r', 3.5)
    .attr('cx', d => x(d.date)).attr('cy', d => y(d.lcp))
    .on('mouseover', (e, d) => showTip(`${fmtDate(d.date)}<br>LCP: <b>${Math.round(d.lcp)}ms</b>`, e))
    .on('mouseout', hideTip);

  // Dots TTFB
  g.selectAll('.dot-ttfb').data(data.filter(d => d.ttfb != null)).join('circle')
    .attr('class', 'dot-ttfb').attr('r', 3)
    .attr('cx', d => x(d.date)).attr('cy', d => y(d.ttfb))
    .on('mouseover', (e, d) => showTip(`${fmtDate(d.date)}<br>TTFB: <b>${Math.round(d.ttfb)}ms</b>`, e))
    .on('mouseout', hideTip);

  // Axes
  g.append('g').attr('class', 'axis')
    .attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(x).ticks(Math.min(data.length, 7)).tickFormat(fmtDate));
  g.append('g').attr('class', 'axis')
    .call(d3.axisLeft(y).ticks(4).tickFormat(d => d + 'ms'));

  // Legend (top-right)
  const leg = g.append('g').attr('transform', `translate(${iW + 8}, 0)`);
  [['LCP', BLUE[500], ''], ['TTFB', BLUE[200], '4,3']].forEach(([label, color, dash], i) => {
    const row = leg.append('g').attr('transform', `translate(0,${i * 18})`);
    row.append('line').attr('x1', 0).attr('x2', 18).attr('y1', 5).attr('y2', 5)
      .attr('stroke', color).attr('stroke-width', 2)
      .attr('stroke-dasharray', dash || null);
    row.append('text').attr('x', 22).attr('y', 9)
      .style('font-family', "'DM Mono', monospace")
      .style('font-size', '9px').style('fill', '#4e6080').text(label);
  });
}

// ── Update timestamp ──────────────────────────────────────────
function updateTimestamp() {
  d3.select('#last-updated').text('updated ' + d3.timeFormat('%H:%M:%S')(new Date()));
}

// ── KPI for errors ────────────────────────────────────────────
async function loadErrorCount() {
  const raw = await apiFetch('/api/errors');
  d3.select('#val-errors').text(fmtNum((raw.data || []).length));
}

// ── Analyst Commentary ────────────────────────────────────────
async function drawCommentary() {
  const container = document.getElementById('commentary-cards');

  try {
    const [pvRaw, evtRaw, errRaw, exitRaw] = await Promise.all([
      apiFetch('/api/pageviews'),
      apiFetch('/api/events'),
      apiFetch('/api/errors'),
      apiFetch('/api/page_exits')
    ]);

    const pageviews  = pvRaw.data  || [];
    const events     = evtRaw.data || [];
    const errors     = errRaw.data || [];
    const exits      = exitRaw.data || [];

    const comments = [];

    // ── 1. LCP Performance ───────────────────────────────────
    const lcpVals  = pageviews.filter(r => r.lcp != null).map(r => r.lcp);
    const avgLcp   = lcpVals.length ? d3.mean(lcpVals) : null;

    if (avgLcp != null) {
      if (avgLcp < 2500) {
        comments.push({
          type: 'good',
          title: 'Page Load Performance is Good',
          text: `Average LCP (Largest Contentful Paint) is <strong>${Math.round(avgLcp)}ms</strong>, within Google's "Good" threshold of under 2500ms. Users see the main content of the Pokemon Shop quickly, reducing the chance they leave before the page finishes loading.`
        });
      } else if (avgLcp < 4000) {
        comments.push({
          type: 'warn',
          title: 'Page Load Needs Improvement',
          text: `Average LCP is <strong>${Math.round(avgLcp)}ms</strong>, in Google's "Needs Improvement" range (2500–4000ms). Users are waiting longer than ideal to see the Pokemon cards. Consider optimizing the PokeAPI sprite images or adding a loading skeleton.`
        });
      } else {
        comments.push({
          type: 'bad',
          title: 'Page Load is Slow',
          text: `Average LCP is <strong>${Math.round(avgLcp)}ms</strong>, exceeding Google's 4000ms "Poor" threshold. At this speed users are likely leaving before the Pokemon cards appear. Image optimization and server-side caching should be addressed immediately.`
        });
      }
    }

    // ── 2. TTFB vs Total Load ────────────────────────────────
    const ttfbVals = pageviews.filter(r => r.nt_ttfb != null && r.nt_load_event != null);
    const avgTtfb  = ttfbVals.length ? d3.mean(ttfbVals, r => r.nt_ttfb) : null;
    const avgLoad  = ttfbVals.length ? d3.mean(ttfbVals, r => r.nt_load_event) : null;

    if (avgTtfb != null && avgLoad != null && avgLoad > 0) {
      const pct = Math.round((avgTtfb / avgLoad) * 100);
      if (pct > 40) {
        comments.push({
          type: 'warn',
          title: 'Server Response Time is the Biggest Bottleneck',
          text: `TTFB averages <strong>${Math.round(avgTtfb)}ms</strong> and accounts for <strong>${pct}%</strong> of total page load time. The server — not the browser — is responsible for the majority of the wait. Adding response caching or optimizing the Node.js collect endpoint would have the highest impact on load speed.`
        });
      } else {
        comments.push({
          type: 'good',
          title: 'Server Response Time is Healthy',
          text: `TTFB averages <strong>${Math.round(avgTtfb)}ms</strong> and accounts for only <strong>${pct}%</strong> of total load time. The server is responding quickly — the remaining load time is spent in the browser parsing and rendering assets, which is normal.`
        });
      }
    }

    // ── 3. Cart click comparison ─────────────────────────────
    const cartEvents = events.filter(e => e.event_name === 'add_to_cart');
    const byItem = d3.rollup(cartEvents, v => v.length, e => {
      try { return JSON.parse(e.event_data).name; } catch { return 'unknown'; }
    });
    const itemArr = Array.from(byItem, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    if (itemArr.length >= 2) {
      const ratio = itemArr[1].count > 0
        ? (itemArr[0].count / itemArr[1].count).toFixed(1)
        : '∞';
      comments.push({
        type: 'info',
        title: `${itemArr[0].name} Dominates Cart Clicks`,
        text: `<strong>${itemArr[0].name}</strong> was added to cart <strong>${itemArr[0].count}</strong> times vs <strong>${itemArr[1].count}</strong> for ${itemArr[1].name} — a <strong>${ratio}x</strong> difference. Since both items are similarly priced and positioned on the page, brand recognition is the likely driver. If the goal is to balance conversions, a featured badge or discount on ${itemArr[1].name} could help.`
      });
    } else if (itemArr.length === 1) {
      comments.push({
        type: 'info',
        title: 'Cart Click Data Collected',
        text: `<strong>${itemArr[0].name}</strong> has been added to cart <strong>${itemArr[0].count}</strong> time(s). Click "Add to Cart" on both items to generate a meaningful comparison between products.`
      });
    } else {
      comments.push({
        type: 'info',
        title: 'No Cart Clicks Yet',
        text: `No add-to-cart events have been recorded yet. Visit <a href="https://test.chesterhuey.com">test.chesterhuey.com</a> and click "Add to Cart" on the Pokemon items to start tracking purchase intent.`
      });
    }

    // ── 4. Time on page ──────────────────────────────────────
    const exitTimes = exits.filter(e => e.time_on_page_ms != null).map(e => e.time_on_page_ms / 1000);
    const avgSecs   = exitTimes.length ? d3.mean(exitTimes) : null;

    if (avgSecs != null) {
      if (avgSecs < 10) {
        comments.push({
          type: 'warn',
          title: 'Users Are Leaving Very Quickly',
          text: `Average time on page is only <strong>${avgSecs.toFixed(1)} seconds</strong>. This suggests users are not engaging with the content and may be bouncing immediately. Check whether slow load times are causing early exits, or whether the page content matches what users expect to find.`
        });
      } else if (avgSecs < 60) {
        comments.push({
          type: 'info',
          title: 'Session Engagement is Brief but Expected',
          text: `Users spend an average of <strong>${avgSecs.toFixed(1)} seconds</strong> on the page. For a simple two-item product listing, this is normal — users can scan and decide quickly. If more products are added, tracking whether this number increases would indicate deeper browsing behavior.`
        });
      } else {
        comments.push({
          type: 'good',
          title: 'Strong Time-on-Page Engagement',
          text: `Users spend an average of <strong>${avgSecs.toFixed(1)} seconds</strong> on the page, indicating genuine engagement beyond a casual glance. This is a positive signal that the Pokemon Shop is holding user attention.`
        });
      }
    }

    // ── 5. Error signal ──────────────────────────────────────
    if (errors.length === 0) {
      comments.push({
        type: 'good',
        title: 'No Errors Detected',
        text: `Zero JavaScript errors, resource failures, or promise rejections have been recorded. The collector script and all page assets are loading and running cleanly across all tracked sessions.`
      });
    } else {
      const jsErrors  = errors.filter(e => e.error_type === 'js-error').length;
      const resErrors = errors.filter(e => e.error_type === 'resource-error').length;
      comments.push({
        type: 'bad',
        title: `${errors.length} Error${errors.length > 1 ? 's' : ''} Recorded`,
        text: `<strong>${errors.length} error${errors.length > 1 ? 's have' : ' has'}</strong> been captured: ${jsErrors} JS error${jsErrors !== 1 ? 's' : ''} and ${resErrors} resource failure${resErrors !== 1 ? 's' : ''}. These may be affecting user experience. Check the <a href="/errors">Errors table</a> to identify which files or lines are responsible.`
      });
    }

    // ── Render ───────────────────────────────────────────────
    container.innerHTML = comments.map(c => `
      <div class="commentary-card ${c.type === 'warn' ? 'warn' : c.type === 'bad' ? 'bad' : c.type === 'good' ? 'good' : ''}">
        <div class="commentary-body">
          <div class="commentary-card-title">${c.title}</div>
          <div class="commentary-card-text">${c.text}</div>
        </div>
      </div>`).join('');

  } catch(e) {
    container.innerHTML = `<div class="loading">Could not load commentary: ${e.message}</div>`;
  }
}

// ── Bootstrap ─────────────────────────────────────────────────
async function init() {
  try {
    await Promise.all([
      drawPageviewTimeline(),
      drawEventsBar(),
      drawBrowserDonut(),
      drawVitalsTrend(),
      loadErrorCount(),
      drawCommentary()
    ]);
    updateTimestamp();
  } catch (e) {
    console.error('Dashboard error:', e);
  }
}

// Re-draw on resize (debounced)
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(init, 300);
});

init();