/* ─── STATE ──────────────────────────────────────────────────── */
let songs = JSON.parse(localStorage.getItem('soundtrace_songs') || '[]');
let highlighted = null;

/* ─── GENRE COLORS ────────────────────────────────────────────── */
const genreColors = {
  'Pop':         '#e8c840',
  'Hip-Hop':     '#c0392b',
  'R&B':         '#8b4513',
  'Rock':        '#2c3e50',
  'Electronic':  '#1a6b5a',
  'Jazz':        '#c0392b',
  'Classical':   '#34495e',
  'Country':     '#795548',
  'Latin':       '#c0392b',
  'Other':       '#666',
};

function genreColor(genre) {
  return genreColors[genre] || '#666';
}

/* ─── SAVE ────────────────────────────────────────────────────── */
function save() {
  localStorage.setItem('soundtrace_songs', JSON.stringify(songs));
}

/* ─── FORM SUBMIT ─────────────────────────────────────────────── */
const form = document.getElementById('song-form');
const formError = document.getElementById('form-error');

form.addEventListener('submit', e => {
  e.preventDefault();

  const title  = document.getElementById('song-title').value.trim();
  const artist = document.getElementById('song-artist').value.trim();
  const year   = parseInt(document.getElementById('song-year').value);
  const genre  = document.getElementById('song-genre').value;
  const mood   = document.getElementById('song-mood').value;
  const note   = document.getElementById('song-note').value.trim();

  if (!title || !artist || !year) {
    formError.textContent = '⚠ Title, Artist, and Year are required.';
    return;
  }
  if (year < 1900 || year > 2099) {
    formError.textContent = '⚠ Enter a valid year (1900–2099).';
    return;
  }

  formError.textContent = '';
  songs.push({ id: Date.now(), title, artist, year, genre, mood, note, addedAt: Date.now() });
  save();
  render();
  form.reset();
  document.getElementById('song-title').focus();
});

/* ─── DELETE ──────────────────────────────────────────────────── */
function deleteSong(id) {
  songs = songs.filter(s => s.id !== id);
  if (highlighted === id) highlighted = null;
  save();
  render();
}

/* ─── HIGHLIGHT ───────────────────────────────────────────────── */
function toggleHighlight(id) {
  highlighted = highlighted === id ? null : id;
  render();
}

/* ─── FILTER / SORT ───────────────────────────────────────────── */
function getFiltered() {
  const fGenre = document.getElementById('filter-genre')?.value || '';
  const fMood  = document.getElementById('filter-mood')?.value  || '';
  const sort   = document.getElementById('sort-by')?.value      || 'added';

  let list = songs.filter(s => {
    if (fGenre && s.genre !== fGenre) return false;
    if (fMood  && s.mood  !== fMood)  return false;
    return true;
  });

  list.sort((a, b) => {
    if (sort === 'year')   return a.year  - b.year;
    if (sort === 'title')  return a.title.localeCompare(b.title);
    if (sort === 'artist') return a.artist.localeCompare(b.artist);
    return a.addedAt - b.addedAt;
  });

  return list;
}

function updateFilterOptions() {
  const genres = [...new Set(songs.map(s => s.genre).filter(Boolean))].sort();
  const moods  = [...new Set(songs.map(s => s.mood).filter(Boolean))].sort();

  const fGenre = document.getElementById('filter-genre');
  const fMood  = document.getElementById('filter-mood');
  const curG   = fGenre.value;
  const curM   = fMood.value;

  fGenre.innerHTML = '<option value="">All</option>' + genres.map(g => `<option value="${g}">${g}</option>`).join('');
  fMood.innerHTML  = '<option value="">All</option>' + moods.map(m => `<option value="${m}">${m}</option>`).join('');

  fGenre.value = curG;
  fMood.value  = curM;
}

/* ─── STATS ───────────────────────────────────────────────────── */
function renderStats() {
  if (!songs.length) return;

  document.getElementById('stat-count').textContent = songs.length;

  const years = songs.map(s => s.year);
  const span  = Math.max(...years) - Math.min(...years);
  document.getElementById('stat-span').textContent = span === 0
    ? String(years[0])
    : `${Math.min(...years)}–${Math.max(...years)}`;

  const genreCounts = {};
  const moodCounts  = {};
  songs.forEach(s => {
    if (s.genre) genreCounts[s.genre] = (genreCounts[s.genre] || 0) + 1;
    if (s.mood)  moodCounts[s.mood]   = (moodCounts[s.mood]   || 0) + 1;
  });

  const topGenre = Object.entries(genreCounts).sort((a,b) => b[1]-a[1])[0];
  const topMood  = Object.entries(moodCounts).sort((a,b) => b[1]-a[1])[0];

  document.getElementById('stat-top-genre').textContent = topGenre ? topGenre[0] : '—';
  document.getElementById('stat-top-mood').textContent  = topMood  ? topMood[0]  : '—';
}

/* ─────────────────────────────────────────────────────────────── */
/*  HORIZONTAL TIMELINE with Framer Motion-style drag + inertia   */
/* ─────────────────────────────────────────────────────────────── */

let tlCurrentX   = 0;   // current translateX of the track
let tlVelocity   = 0;   // pixels/ms velocity for momentum
let tlRafId      = null; // requestAnimationFrame handle
let tlIsDragging = false;
let tlDragStartX = 0;   // pointer X at drag start
let tlDragStartTranslate = 0; // translateX at drag start
let tlLastX      = 0;   // previous pointer position for velocity
let tlLastTime   = 0;   // previous pointer timestamp for velocity

const FRICTION   = 0.93;  // momentum decay per frame (like Framer Motion's default)
const STIFFNESS  = 0.18;  // spring stiffness for boundary bounce
const MIN_VEL    = 0.1;   // stop threshold

function tlGetMaxScroll() {
  const viewport = document.getElementById('tl-viewport');
  const track    = document.getElementById('tl-track');
  if (!viewport || !track) return 0;
  return Math.max(0, track.scrollWidth - viewport.clientWidth + 96); // +96 for padding
}

function tlApplyTransform(x) {
  const track = document.getElementById('tl-track');
  if (!track) return;
  tlCurrentX = x;
  track.style.transform = `translateX(${x}px)`;
}

function tlMomentumLoop() {
  const maxScroll = tlGetMaxScroll();
  const minX = -maxScroll;
  const maxX = 0;

  // spring back if out of bounds
  if (tlCurrentX > maxX) {
    const delta = maxX - tlCurrentX;
    tlVelocity  = delta * STIFFNESS;
  } else if (tlCurrentX < minX) {
    const delta = minX - tlCurrentX;
    tlVelocity  = delta * STIFFNESS;
  } else {
    tlVelocity *= FRICTION;
  }

  if (Math.abs(tlVelocity) < MIN_VEL &&
      tlCurrentX >= minX && tlCurrentX <= maxX) {
    tlVelocity = 0;
    return; // stop RAF
  }

  tlApplyTransform(tlCurrentX + tlVelocity);
  tlRafId = requestAnimationFrame(tlMomentumLoop);
}

function tlStartMomentum() {
  if (tlRafId) cancelAnimationFrame(tlRafId);
  tlRafId = requestAnimationFrame(tlMomentumLoop);
}

function tlOnPointerDown(e) {
  if (e.target.closest('.tl-card')) return; // let card clicks through
  tlIsDragging = true;
  tlDragStartX = e.clientX;
  tlDragStartTranslate = tlCurrentX;
  tlLastX    = e.clientX;
  tlLastTime = performance.now();
  tlVelocity = 0;

  if (tlRafId) cancelAnimationFrame(tlRafId);

  const viewport = document.getElementById('tl-viewport');
  viewport.classList.add('is-dragging');

  e.preventDefault();
}

function tlOnPointerMove(e) {
  if (!tlIsDragging) return;

  const now   = performance.now();
  const dt    = now - tlLastTime;
  const dx    = e.clientX - tlLastX;

  if (dt > 0) {
    // exponential moving average for smoother velocity
    tlVelocity = tlVelocity * 0.5 + (dx / dt) * 16 * 0.5;
  }

  tlLastX    = e.clientX;
  tlLastTime = now;

  const newX = tlDragStartTranslate + (e.clientX - tlDragStartX);
  // allow slight overscroll (rubber-band feel)
  const maxScroll = tlGetMaxScroll();
  const clamped   = Math.max(-maxScroll - 80, Math.min(80, newX));
  tlApplyTransform(clamped);
}

function tlOnPointerUp(e) {
  if (!tlIsDragging) return;
  tlIsDragging = false;

  const viewport = document.getElementById('tl-viewport');
  viewport.classList.remove('is-dragging');

  tlStartMomentum();
}

function initTimelineDrag() {
  const viewport = document.getElementById('tl-viewport');
  if (!viewport) return;

  viewport.addEventListener('pointerdown', tlOnPointerDown);
  window.addEventListener('pointermove', tlOnPointerMove);
  window.addEventListener('pointerup', tlOnPointerUp);

  // also allow mouse wheel horizontal scroll
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    if (tlRafId) cancelAnimationFrame(tlRafId);
    tlVelocity = -e.deltaY * 0.5 + -e.deltaX * 0.5;
    tlStartMomentum();
  }, { passive: false });
}

/* ─── RENDER HORIZONTAL TIMELINE ─────────────────────────────── */
function renderTimeline(list) {
  const track = document.getElementById('tl-track');
  if (!track) return;

  // Sort by year for timeline
  const sorted = [...list].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

  track.innerHTML = '';

  sorted.forEach((s, i) => {
    const col = document.createElement('div');
    col.className = 'tl-col' + (highlighted === s.id ? ' highlighted' : '');

    const isEven = i % 2 === 0;

    col.innerHTML = `
      <div class="tl-card${highlighted === s.id ? ' highlighted' : ''}" data-id="${s.id}">
        <div class="tl-song-title">${escapeHtml(s.title)}</div>
        <div class="tl-song-artist">${escapeHtml(s.artist)}</div>
        ${s.genre ? `<span class="tl-badge" style="border-color:${genreColor(s.genre)};background:${highlighted===s.id?'#fff':genreColor(s.genre)};color:#fff">${escapeHtml(s.genre)}</span>` : ''}
      </div>
      <div class="tl-connector"></div>
      <div class="tl-dot-axis"></div>
      <div class="tl-year">${s.year}</div>
    `;

    col.querySelector('.tl-card').addEventListener('click', () => toggleHighlight(s.id));

    track.appendChild(col);
  });

  // reset scroll position when list changes
  tlApplyTransform(0);
  tlVelocity = 0;
}

/* ─── SONG GRID ───────────────────────────────────────────────── */
function renderGrid(list) {
  const grid = document.getElementById('song-grid');
  grid.innerHTML = '';

  list.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'song-card' + (highlighted === s.id ? ' highlighted' : '');
    card.onclick = (e) => {
      if (e.target.classList.contains('card-delete')) return;
      toggleHighlight(s.id);
    };

    card.innerHTML = `
      <button class="card-delete" onclick="deleteSong(${s.id})" title="Remove">✕</button>
      <div class="card-number">${String(i + 1).padStart(2, '0')}</div>
      <div class="card-title">${escapeHtml(s.title)}</div>
      <div class="card-artist">${escapeHtml(s.artist)}</div>
      <div class="card-meta">
        <span class="badge badge-year">${s.year}</span>
        ${s.genre ? `<span class="badge badge-genre" style="border-color:${genreColor(s.genre)};color:#fff;background:${genreColor(s.genre)}">${escapeHtml(s.genre)}</span>` : ''}
        ${s.mood  ? `<span class="badge badge-mood">${escapeHtml(s.mood)}</span>` : ''}
      </div>
      ${s.note ? `<div class="card-note">"${escapeHtml(s.note)}"</div>` : ''}
    `;

    grid.appendChild(card);
  });
}

/* ─── GENRE CHART ─────────────────────────────────────────────── */
function renderChart() {
  const chartEl = document.getElementById('genre-chart');
  chartEl.innerHTML = '';

  const counts = {};
  songs.forEach(s => { if (s.genre) counts[s.genre] = (counts[s.genre] || 0) + 1; });
  const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;

  sorted.forEach(([genre, count]) => {
    const row = document.createElement('div');
    row.className = 'chart-row';

    row.innerHTML = `
      <div class="chart-label">${escapeHtml(genre)}</div>
      <div class="chart-bar-track">
        <div class="chart-bar-fill" style="width:0%;background:${genreColor(genre)}"></div>
      </div>
      <div class="chart-count">${count}</div>
    `;

    chartEl.appendChild(row);

    requestAnimationFrame(() => {
      setTimeout(() => {
        row.querySelector('.chart-bar-fill').style.width = `${(count / max) * 100}%`;
      }, 50);
    });
  });
}

/* ─── MAIN RENDER ─────────────────────────────────────────────── */
function render() {
  const hasSongs = songs.length > 0;

  document.getElementById('empty-state').style.display      = hasSongs ? 'none'  : 'block';
  document.getElementById('stats-bar').style.display        = hasSongs ? 'flex'  : 'none';
  document.getElementById('filter-bar').style.display       = hasSongs ? 'flex'  : 'none';
  document.getElementById('timeline-section').style.display = hasSongs ? 'block' : 'none';
  document.getElementById('songs-section').style.display    = hasSongs ? 'block' : 'none';
  document.getElementById('chart-section').style.display    = hasSongs ? 'block' : 'none';

  if (!hasSongs) return;

  updateFilterOptions();
  const list = getFiltered();

  renderStats();
  renderTimeline(list);
  renderGrid(list);
  renderChart();
}

/* ─── FILTER / SORT LISTENERS ─────────────────────────────────── */
document.getElementById('filter-genre').addEventListener('change', render);
document.getElementById('filter-mood').addEventListener('change', render);
document.getElementById('sort-by').addEventListener('change', render);

document.getElementById('clear-all').addEventListener('click', () => {
  if (confirm('Remove all songs from your playlist?')) {
    songs = [];
    highlighted = null;
    save();
    render();
  }
});

/* ─── UTILS ───────────────────────────────────────────────────── */
function escapeHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

/* ─── SEED DATA ───────────────────────────────────────────────── */
if (!songs.length) {
  songs = [
    { id: 1,  title: 'Blinding Lights',   artist: 'The Weeknd',       year: 2019, genre: 'Pop',        mood: 'Energetic',   note: 'Never gets old.',       addedAt: 1 },
    { id: 2,  title: 'HUMBLE.',           artist: 'Kendrick Lamar',   year: 2017, genre: 'Hip-Hop',    mood: 'Dark',        note: 'Peak Kendrick.',        addedAt: 2 },
    { id: 3,  title: 'Redbone',           artist: 'Childish Gambino', year: 2016, genre: 'R&B',        mood: 'Chill',       note: 'Sunday morning vibes.', addedAt: 3 },
    { id: 4,  title: 'Bohemian Rhapsody', artist: 'Queen',            year: 1975, genre: 'Rock',       mood: 'Melancholic', note: 'Timeless epic.',        addedAt: 4 },
    { id: 5,  title: 'Take Five',         artist: 'Dave Brubeck',     year: 1959, genre: 'Jazz',       mood: 'Chill',       note: 'Perfect 5/4 groove.',   addedAt: 5 },
    { id: 6,  title: 'One More Time',     artist: 'Daft Punk',        year: 2000, genre: 'Electronic', mood: 'Energetic',   note: 'Instant happiness.',    addedAt: 6 },
    { id: 7,  title: 'As It Was',         artist: 'Harry Styles',     year: 2022, genre: 'Pop',        mood: 'Melancholic', note: 'Modern heartbreak.',    addedAt: 7 },
    { id: 8,  title: "God's Plan",        artist: 'Drake',            year: 2018, genre: 'Hip-Hop',    mood: 'Happy',       note: 'Always in rotation.',   addedAt: 8 },
    { id: 9,  title: 'Superstition',      artist: 'Stevie Wonder',    year: 1972, genre: 'R&B',        mood: 'Energetic',   note: 'Groove forever.',       addedAt: 9 },
    { id: 10, title: 'Around the World',  artist: 'Daft Punk',        year: 1997, genre: 'Electronic', mood: 'Energetic',   note: 'Repetition is art.',    addedAt: 10 },
    { id: 11, title: 'Hotel California',  artist: 'Eagles',           year: 1977, genre: 'Rock',       mood: 'Melancholic', note: 'Classic.',              addedAt: 11 },
    { id: 12, title: 'Flowers',           artist: 'Miley Cyrus',      year: 2023, genre: 'Pop',        mood: 'Uplifting',   note: 'Self-love anthem.',     addedAt: 12 },
  ];
  save();
}

/* ─── INIT ────────────────────────────────────────────────────── */
render();
initTimelineDrag();