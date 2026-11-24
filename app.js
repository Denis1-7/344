'use strict';

/* =========================================================================
   Календарь — приложение без зависимостей.
   Данные хранятся в localStorage браузера.
   ========================================================================= */

const STORAGE_KEY = 'calendar.events.v1';
const THEME_KEY = 'calendar.theme';
const HOUR_H = 56;              // высота часа в сетке, должна совпадать с CSS --hour-h
const HOURS_IN_DAY = 24;
const DAY_MIN = 1440;
const MAX_MONTH_CHIPS = 3;

const COLORS = [
  { id: 'blue',   name: 'Синий' },
  { id: 'violet', name: 'Фиолетовый' },
  { id: 'green',  name: 'Зелёный' },
  { id: 'amber',  name: 'Янтарный' },
  { id: 'rose',   name: 'Розовый' },
  { id: 'cyan',   name: 'Голубой' },
];

const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEK_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WEEK_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const REPEAT_LABEL = { none: '', daily: 'каждый день', weekly: 'каждую неделю', monthly: 'каждый месяц', yearly: 'каждый год' };

/* =========================================================================
   Даты и время
   ========================================================================= */

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};
const addMonthsClamped = (d, n) => {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const dim = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(d.getDate(), dim));
  return r;
};
const startOfWeek = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const weekDaysOf = (d) => {
  const s = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
};
const sameDay = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const diffDays = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const monthsBetween = (a, b) =>
  (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth());

const toMin = (t) => {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const minToTime = (m) => {
  const v = Math.max(0, Math.min(DAY_MIN - 1, Math.round(m)));
  return `${pad(Math.floor(v / 60))}:${pad(v % 60)}`;
};
const validTime = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || ''));
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const plural = (n, forms) => {
  const n10 = Math.abs(n) % 10;
  const n100 = Math.abs(n) % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
};

const uid = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (e) { /* ignore */ }
  return 'ev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
};

/* =========================================================================
   Состояние
   ========================================================================= */

const state = {
  view: 'month',
  cursor: startOfDay(new Date()),
  events: [],
  query: '',
  colors: new Set(COLORS.map((c) => c.id)),
  editingId: null,
  visibleCount: 0,
  lastToday: ymd(new Date()),
};

/* =========================================================================
   Хранилище
   ========================================================================= */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Не удалось сохранить данные:', e);
  }
}

function normalizeEvent(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const rec = src.recurrence && typeof src.recurrence === 'object' ? src.recurrence : {};
  const freq = ['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(rec.freq) ? rec.freq : 'none';
  return {
    id: src.id || uid(),
    title: String(src.title || 'Без названия').slice(0, 120),
    date: validDate(src.date) ? src.date : ymd(new Date()),
    start: validTime(src.start) ? src.start : '09:00',
    end: validTime(src.end) ? src.end : '10:00',
    allDay: Boolean(src.allDay),
    color: COLORS.some((c) => c.id === src.color) ? src.color : 'blue',
    notes: String(src.notes || '').slice(0, 1000),
    recurrence: {
      freq,
      interval: 1,
      until: freq !== 'none' && validDate(rec.until) ? rec.until : null,
    },
    createdAt: Number(src.createdAt) || Date.now(),
  };
}

function loadEvents() {
  const raw = readJSON(STORAGE_KEY, null);
  if (!Array.isArray(raw)) {
    const seeded = seedEvents().map(normalizeEvent);
    writeJSON(STORAGE_KEY, seeded);
    return seeded;
  }
  return raw.map(normalizeEvent);
}

function saveEvents() {
  writeJSON(STORAGE_KEY, state.events);
}

function seedEvents() {
  const today = startOfDay(new Date());
  const at = (offset) => ymd(addDays(today, offset));
  return [
    {
      title: 'Планёрка команды', color: 'blue', date: at(0), start: '09:30', end: '10:15',
      notes: 'Обсудить задачи на неделю и блокеры.', allDay: false,
      recurrence: { freq: 'weekly', interval: 1, until: null },
    },
    {
      title: 'Обед с Аней', color: 'amber', date: at(1), start: '13:00', end: '14:00',
      notes: '', allDay: false, recurrence: { freq: 'none', interval: 1, until: null },
    },
    {
      title: 'Тренировка', color: 'green', date: at(2), start: '19:00', end: '20:30',
      notes: '', allDay: false, recurrence: { freq: 'weekly', interval: 1, until: null },
    },
    {
      title: 'Сдать отчёт', color: 'violet', date: at(3), start: '18:00', end: '19:00',
      notes: 'Не забыть приложить графики.', allDay: false,
      recurrence: { freq: 'none', interval: 1, until: null },
    },
    {
      title: 'День рождения Максима', color: 'rose', date: at(5), start: '00:00', end: '23:59',
      notes: '', allDay: true, recurrence: { freq: 'yearly', interval: 1, until: null },
    },
  ];
}

/* =========================================================================
   Повторяющиеся события
   ========================================================================= */

/** Дата k-го повторения, отсчитанного от начала серии. */
function occurrenceAt(start, freq, interval, k) {
  switch (freq) {
    case 'daily':   return addDays(start, k * interval);
    case 'weekly':  return addDays(start, k * 7 * interval);
    case 'monthly': return addMonthsClamped(start, k * interval);
    case 'yearly':  return addMonthsClamped(start, k * 12 * interval);
    default:        return addDays(start, k);
  }
}

/** Индекс первого повторения, которое не раньше from. */
function firstIndexAtOrAfter(start, freq, interval, from) {
  if (from <= start) return 0;
  let k;
  switch (freq) {
    case 'daily':   k = Math.ceil(diffDays(from, start) / interval); break;
    case 'weekly':  k = Math.ceil(diffDays(from, start) / (7 * interval)); break;
    case 'monthly': k = Math.ceil(monthsBetween(from, start) / interval); break;
    case 'yearly':  k = Math.ceil((from.getFullYear() - start.getFullYear()) / interval); break;
    default:        k = 0;
  }
  k = Math.max(0, k);

  let guard = 0;
  while (k > 0 && occurrenceAt(start, freq, interval, k) > from && guard++ < 1000) k--;
  guard = 0;
  while (occurrenceAt(start, freq, interval, k) < from && guard++ < 5000) k++;
  return k;
}

/** Все даты повторений события в диапазоне [from, to] (включительно). */
function occurrencesInRange(ev, from, to) {
  const start = parseYmd(ev.date);
  const rec = ev.recurrence || { freq: 'none', interval: 1, until: null };
  if (rec.freq === 'none') {
    return start >= from && start <= to ? [start] : [];
  }
  const until = validDate(rec.until) ? parseYmd(rec.until) : null;
  const end = until && until < to ? until : to;
  if (end < from) return [];

  const interval = Math.max(1, Number(rec.interval) || 1);
  const out = [];
  let k = firstIndexAtOrAfter(start, rec.freq, interval, from);
  for (let i = 0; i < 1000; i++) {
    const d = occurrenceAt(start, rec.freq, interval, k);
    if (d > end) break;
    if (d >= from) out.push(d);
    k++;
  }
  return out;
}

/* =========================================================================
   Фильтрация
   ========================================================================= */

function matchesFilter(ev) {
  if (!state.colors.has(ev.color)) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${ev.title} ${ev.notes}`.toLowerCase();
  return q.split(/\s+/).every((token) => hay.includes(token));
}

const byStart = (a, b) => {
  if (a.ev.allDay !== b.ev.allDay) return a.ev.allDay ? -1 : 1;
  if (a.ev.start !== b.ev.start) return a.ev.start < b.ev.start ? -1 : 1;
  return a.ev.title.localeCompare(b.ev.title, 'ru');
};

/** Карта ymd -> [{ ev, date }] для видимых событий диапазона. */
function collect(from, to) {
  const map = new Map();
  for (const ev of state.events) {
    if (!matchesFilter(ev)) continue;
    const dates = occurrencesInRange(ev, from, to);
    for (const d of dates) {
      const key = ymd(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ ev, date: d });
    }
  }
  for (const arr of map.values()) arr.sort(byStart);
  return map;
}

/* =========================================================================
   DOM-утилиты
   ========================================================================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/* =========================================================================
   Отрисовка: общий вход
   ========================================================================= */

function render() {
  const view = $('#view');
  const prevScroller = view.querySelector('.tg-scroll');
  const scrollTop = prevScroller ? prevScroller.scrollTop : null;

  view.innerHTML = '';
  view.className = 'view view-' + state.view;

  updatePeriodLabel();
  updateViewSwitch();

  state.visibleCount = state.view === 'month' ? renderMonth(view) : renderTime(view);

  const scroller = view.querySelector('.tg-scroll');
  if (scroller) {
    scroller.scrollTop = scrollTop !== null ? scrollTop : 7.5 * HOUR_H;
  }

  updateFilterInfo();
  updateStatus();
  updateResetBtn();
  state.lastToday = ymd(new Date());
}

function updatePeriodLabel() {
  const d = state.cursor;
  let text;
  if (state.view === 'month') {
    text = `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;
  } else if (state.view === 'week') {
    const days = weekDaysOf(d);
    const a = days[0];
    const b = days[6];
    if (a.getFullYear() !== b.getFullYear()) {
      text = `${a.getDate()} ${MONTHS_GEN[a.getMonth()]} ${a.getFullYear()} — ${b.getDate()} ${MONTHS_GEN[b.getMonth()]} ${b.getFullYear()}`;
    } else if (a.getMonth() !== b.getMonth()) {
      text = `${a.getDate()} ${MONTHS_GEN[a.getMonth()]} — ${b.getDate()} ${MONTHS_GEN[b.getMonth()]} ${b.getFullYear()}`;
    } else {
      text = `${a.getDate()} — ${b.getDate()} ${MONTHS_GEN[b.getMonth()]} ${b.getFullYear()}`;
    }
  } else {
    const dow = (d.getDay() + 6) % 7;
    text = `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}, ${WEEK_FULL[dow]}`;
  }
  $('#periodLabel').textContent = cap(text);
}

function updateViewSwitch() {
  $$('.view-switch button').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.view === state.view));
  });
}

function updateFilterInfo() {
  const parts = [];
  const q = state.query.trim();
  if (q) parts.push(`поиск «${q}»`);
  if (state.colors.size !== COLORS.length) parts.push('фильтр по цвету');
  const n = state.visibleCount;
  const countText = `${n} ${plural(n, ['событие', 'события', 'событий'])}`;
  $('#filterInfo').textContent = parts.length ? `${parts.join(' · ')} — ${countText}` : countText;
}

function updateResetBtn() {
  const q = state.query.trim();
  const hasFilters = q || state.colors.size !== COLORS.length;
  $('#resetFilters').hidden = !hasFilters;
}

function updateStatus() {
  const total = state.events.length;
  const recurring = state.events.filter((e) => e.recurrence.freq !== 'none').length;
  $('#statusCount').textContent = `${total} ${plural(total, ['событие', 'события', 'событий'])}` +
    (recurring ? ` · ${recurring} с повтором` : '');
}

function updateNowLines() {
  const now = new Date();
  const min = now.getHours() * 60 + now.getMinutes();
  $$('.nowline').forEach((line) => {
    line.style.top = `${(min / DAY_MIN) * 100}%`;
  });
}

/* =========================================================================
   Вид «Месяц»
   ========================================================================= */

function renderMonth(root) {
  const first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const gridEnd = addDays(gridStart, 41);
  const map = collect(gridStart, gridEnd);
  const today = startOfDay(new Date());

  const wrap = el('div', 'month');

  const head = el('div', 'month-head');
  WEEK_SHORT.forEach((w, i) => head.append(el('div', 'dow' + (i >= 5 ? ' weekend' : ''), cap(w))));
  wrap.append(head);

  const grid = el('div', 'month-grid');
  let total = 0;
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const items = map.get(ymd(date)) || [];
    total += items.length;
    grid.append(buildMonthCell(date, items, today));
  }
  wrap.append(grid);
  root.append(wrap);
  return total;
}

function buildMonthCell(date, items, today) {
  const cell = el('div', 'day');
  cell.dataset.date = ymd(date);

  const sameMonth = date.getMonth() === state.cursor.getMonth() && date.getFullYear() === state.cursor.getFullYear();
  if (!sameMonth) cell.classList.add('other-month');
  if (date.getDay() === 0 || date.getDay() === 6) cell.classList.add('weekend');
  if (sameDay(date, today)) cell.classList.add('today');

  const num = el('button', 'daynum', String(date.getDate()));
  num.type = 'button';
  num.title = 'Открыть день';
  num.addEventListener('click', (e) => {
    e.stopPropagation();
    openDay(date);
  });
  cell.append(num);

  const list = el('div', 'day-events');
  items.slice(0, MAX_MONTH_CHIPS).forEach((item) => list.append(buildChip(item)));
  if (items.length > MAX_MONTH_CHIPS) {
    const rest = items.length - MAX_MONTH_CHIPS;
    const more = el('button', 'more', `+${rest} ${plural(rest, ['событие', 'события', 'событий'])}`);
    more.type = 'button';
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      openDay(date);
    });
    list.append(more);
  }
  cell.append(list);

  cell.addEventListener('click', () => createAt(date, defaultStartMinutes(date)));
  return cell;
}

function buildChip(item) {
  const ev = item.ev;
  const chip = el('button', 'chip');
  chip.type = 'button';
  chip.dataset.color = ev.color;
  chip.dataset.id = ev.id;
  if (ev.allDay) chip.classList.add('allday');

  const repeatNote = ev.recurrence.freq !== 'none' ? ` · повтор: ${REPEAT_LABEL[ev.recurrence.freq]}` : '';
  chip.title = `${ev.title}${ev.allDay ? ' · весь день' : ` · ${ev.start}–${ev.end}`}${repeatNote}` +
    (ev.notes ? `\n${ev.notes}` : '');

  if (!ev.allDay) chip.append(el('span', 'chip-time', ev.start));
  chip.append(el('span', 'chip-title', ev.title));
  if (ev.recurrence.freq !== 'none') {
    const rec = el('span', 'rec', '↻');
    rec.setAttribute('aria-hidden', 'true');
    chip.append(rec);
  }

  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    openEdit(ev);
  });
  return chip;
}

/* =========================================================================
   Виды «Неделя» и «День»
   ========================================================================= */

function renderTime(root) {
  const days = state.view === 'week' ? weekDaysOf(state.cursor) : [startOfDay(state.cursor)];
  const from = days[0];
  const to = days[days.length - 1];
  const map = collect(from, to);
  const today = startOfDay(new Date());
  const cols = days.length;

  const tg = el('div', 'tg');

  /* --- шапка с днями --- */
  const head = el('div', 'tg-head');
  head.style.gridTemplateColumns = `var(--gutter) repeat(${cols}, minmax(0, 1fr))`;
  head.append(el('div', 'tg-head-gutter'));
  days.forEach((d) => {
    const dow = (d.getDay() + 6) % 7;
    const btn = el('button', 'tg-dayhead');
    btn.type = 'button';
    if (sameDay(d, today)) btn.classList.add('today');
    if (d.getDay() === 0 || d.getDay() === 6) btn.classList.add('weekend');
    btn.append(el('span', 'dow', cap(WEEK_FULL[dow])));
    btn.append(el('span', 'dnum', String(d.getDate())));
    btn.title = 'Открыть этот день';
    btn.addEventListener('click', () => openDay(d));
    head.append(btn);
  });
  tg.append(head);

  /* --- строка «весь день» --- */
  const allday = el('div', 'tg-allday');
  allday.style.gridTemplateColumns = `var(--gutter) repeat(${cols}, minmax(0, 1fr))`;
  allday.append(el('div', 'gutter-label', 'весь день'));
  let total = 0;
  days.forEach((d) => {
    const cell = el('div', 'allday-cell');
    cell.dataset.date = ymd(d);
    const items = (map.get(ymd(d)) || []).filter((it) => it.ev.allDay);
    total += items.length;
    items.forEach((it) => cell.append(buildChip(it)));
    cell.addEventListener('click', () => createAt(d, null, true));
    allday.append(cell);
  });
  tg.append(allday);

  /* --- сетка часов --- */
  const scroll = el('div', 'tg-scroll');
  const inner = el('div', 'tg-inner');
  inner.style.height = `${HOURS_IN_DAY * HOUR_H}px`;

  const hours = el('div', 'tg-hours');
  for (let h = 0; h < HOURS_IN_DAY; h++) hours.append(el('div', 'tg-hour', `${pad(h)}:00`));

  const colsWrap = el('div', 'tg-cols');
  colsWrap.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;

  days.forEach((d) => {
    const col = el('div', 'tg-col');
    col.dataset.date = ymd(d);
    if (sameDay(d, today)) col.classList.add('today');
    if (d.getDay() === 0 || d.getDay() === 6) col.classList.add('weekend');

    const items = (map.get(ymd(d)) || [])
      .filter((it) => !it.ev.allDay)
      .map((it) => {
        const s = toMin(it.ev.start);
        const e = Math.max(toMin(it.ev.end), s + 20);
        return { ev: it.ev, startMin: s, endMin: Math.min(e, DAY_MIN) };
      });
    total += items.length;

    layoutDayEvents(items).forEach((it) => col.append(buildTimedEvent(it)));
    if (sameDay(d, today)) col.append(buildNowLine());

    col.addEventListener('click', (e) => {
      if (e.target !== col) return;
      const rect = col.getBoundingClientRect();
      const raw = ((e.clientY - rect.top) / rect.height) * DAY_MIN;
      const snapped = Math.min(DAY_MIN - 30, Math.max(0, Math.round(raw / 30) * 30));
      createAt(d, snapped);
    });

    colsWrap.append(col);
  });

  inner.append(hours, colsWrap);
  scroll.append(inner);
  tg.append(scroll);
  root.append(tg);
  return total;
}

/** Раскладка пересекающихся событий по колонкам. */
function layoutDayEvents(list) {
  list.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const clusters = [];
  let current = null;
  for (const item of list) {
    if (!current || item.startMin >= current.end) {
      current = { items: [], end: item.endMin };
      clusters.push(current);
    }
    current.items.push(item);
    current.end = Math.max(current.end, item.endMin);
  }
  for (const cluster of clusters) {
    const ends = [];
    for (const item of cluster.items) {
      let col = ends.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = ends.length;
        ends.push(item.endMin);
      } else {
        ends[col] = item.endMin;
      }
      item.col = col;
    }
    for (const item of cluster.items) item.cols = ends.length || 1;
  }
  return list;
}

function buildTimedEvent(item) {
  const ev = item.ev;
  const node = el('button', 'ev');
  node.type = 'button';
  node.dataset.color = ev.color;
  node.dataset.id = ev.id;

  const top = (item.startMin / DAY_MIN) * 100;
  const height = ((item.endMin - item.startMin) / DAY_MIN) * 100;
  node.style.top = `calc(${top}% + 1px)`;
  node.style.height = `calc(${height}% - 3px)`;
  node.style.left = `calc(${(item.col / item.cols) * 100}% + 3px)`;
  node.style.width = `calc(${(1 / item.cols) * 100}% - 6px)`;
  if (item.endMin - item.startMin < 45) node.classList.add('tiny');

  node.append(el('span', 'ev-title', ev.title));
  node.append(el('span', 'ev-time', `${ev.start}–${ev.end}`));

  const repeatNote = ev.recurrence.freq !== 'none' ? `\nповтор: ${REPEAT_LABEL[ev.recurrence.freq]}` : '';
  node.title = `${ev.title}\n${ev.start}–${ev.end}${repeatNote}${ev.notes ? '\n' + ev.notes : ''}`;

  node.addEventListener('click', (e) => {
    e.stopPropagation();
    openEdit(ev);
  });
  return node;
}

function buildNowLine() {
  const now = new Date();
  const min = now.getHours() * 60 + now.getMinutes();
  const line = el('div', 'nowline');
  line.style.top = `${(min / DAY_MIN) * 100}%`;
  return line;
}

/* =========================================================================
   Действия
   ========================================================================= */

function openDay(date) {
  state.view = 'day';
  state.cursor = startOfDay(date);
  render();
}

function setView(view) {
  state.view = view;
  render();
}

function shift(delta) {
  if (state.view === 'month') {
    state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
  } else if (state.view === 'week') {
    state.cursor = addDays(state.cursor, 7 * delta);
  } else {
    state.cursor = addDays(state.cursor, delta);
  }
  render();
}

function defaultStartMinutes(date) {
  const now = new Date();
  if (sameDay(date, now)) {
    const min = now.getHours() * 60 + now.getMinutes();
    return Math.min(DAY_MIN - 60, Math.ceil(min / 30) * 30);
  }
  return 9 * 60;
}

function createAt(date, startMin, allDay = false) {
  const s = allDay ? '00:00' : minToTime(startMin === null || startMin === undefined ? 9 * 60 : startMin);
  const e = allDay ? '23:59' : minToTime(Math.min(DAY_MIN - 1, toMin(s) + 60));
  openEventModal({ date: ymd(date), start: s, end: e, allDay });
}

/* =========================================================================
   Модальное окно события
   ========================================================================= */

let lastFocused = null;

function openEdit(ev) {
  openEventModal({ id: ev.id });
}

function openEventModal({ id = null, date = null, start = '09:00', end = '10:00', allDay = false } = {}) {
  const ev = id ? state.events.find((e) => e.id === id) : null;
  state.editingId = ev ? ev.id : null;
  lastFocused = document.activeElement;

  $('#modalTitle').textContent = ev ? 'Редактировать событие' : 'Новое событие';
  $('#fTitle').value = ev ? ev.title : '';
  $('#fDate').value = ev ? ev.date : (date || defaultNewDate());
  $('#fStart').value = ev ? ev.start : start;
  $('#fEnd').value = ev ? ev.end : end;
  $('#fAllDay').checked = ev ? ev.allDay : allDay;
  $('#fNotes').value = ev ? ev.notes : '';

  const rec = ev ? ev.recurrence : { freq: 'none', until: null };
  $('#fRepeat').value = rec.freq;
  $('#fUntil').value = rec.until || '';

  selectColor(ev ? ev.color : 'blue');
  toggleAllDayFields();
  toggleUntilField();

  $('#deleteBtn').hidden = !ev;
  $('#seriesHint').hidden = !(ev && rec.freq !== 'none');
  const err = $('#formError');
  err.hidden = true;
  err.textContent = '';

  $('#modal').hidden = false;
  setTimeout(() => $('#fTitle').focus(), 0);
}

function defaultNewDate() {
  const today = startOfDay(new Date());
  const c = state.cursor;
  if (state.view === 'month' && c.getMonth() === today.getMonth() && c.getFullYear() === today.getFullYear()) {
    return ymd(today);
  }
  if (state.view !== 'month') return ymd(today);
  return ymd(c);
}

function closeModal() {
  $('#modal').hidden = true;
  state.editingId = null;
  if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
}

function selectColor(id) {
  $$('#fColors .swatch').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.color === id));
  });
}

function currentColor() {
  const active = $('#fColors .swatch[aria-checked="true"]');
  return active ? active.dataset.color : 'blue';
}

function toggleAllDayFields() {
  const allDay = $('#fAllDay').checked;
  $('#fStart').disabled = allDay;
  $('#fEnd').disabled = allDay;
  $('#startField').classList.toggle('is-disabled', allDay);
  $('#endField').classList.toggle('is-disabled', allDay);
}

function toggleUntilField() {
  const repeat = $('#fRepeat').value;
  $('#untilField').hidden = repeat === 'none';
  $('#seriesHint').hidden = !(state.editingId && repeat !== 'none');
}

function showFormError(message) {
  const box = $('#formError');
  box.textContent = message;
  box.hidden = false;
  return false;
}

function readForm() {
  return {
    title: $('#fTitle').value.trim(),
    date: $('#fDate').value,
    start: $('#fStart').value || '09:00',
    end: $('#fEnd').value || '10:00',
    allDay: $('#fAllDay').checked,
    color: currentColor(),
    notes: $('#fNotes').value.trim(),
    repeat: $('#fRepeat').value,
    until: $('#fUntil').value || null,
  };
}

function submitForm(event) {
  event.preventDefault();
  const data = readForm();

  if (!data.title) return showFormError('Введите название события');
  if (!validDate(data.date)) return showFormError('Укажите дату события');

  if (data.allDay) {
    data.start = '00:00';
    data.end = '23:59';
  } else if (toMin(data.end) <= toMin(data.start)) {
    return showFormError('Время окончания должно быть позже времени начала');
  }

  if (data.repeat !== 'none' && data.until && data.until < data.date) {
    return showFormError('Дата окончания повтора не может быть раньше даты события');
  }

  const payload = {
    title: data.title,
    date: data.date,
    start: data.start,
    end: data.end,
    allDay: data.allDay,
    color: data.color,
    notes: data.notes,
    recurrence: {
      freq: data.repeat,
      interval: 1,
      until: data.repeat === 'none' ? null : data.until,
    },
  };

  const existing = state.editingId ? state.events.find((e) => e.id === state.editingId) : null;
  if (existing) {
    Object.assign(existing, payload);
  } else {
    state.events.push(normalizeEvent({ ...payload, id: uid(), createdAt: Date.now() }));
  }

  saveEvents();
  closeModal();
  render();
  toast(existing ? 'Событие обновлено' : 'Событие добавлено');
  return true;
}

function deleteCurrent() {
  const ev = state.events.find((e) => e.id === state.editingId);
  if (!ev) return;
  const series = ev.recurrence.freq !== 'none';
  const message = series
    ? `Удалить серию «${ev.title}»?\nВсе повторения этого события исчезнут.`
    : `Удалить событие «${ev.title}»?`;
  if (!window.confirm(message)) return;

  state.events = state.events.filter((e) => e.id !== ev.id);
  saveEvents();
  closeModal();
  render();
  toast('Событие удалено');
}

/* =========================================================================
   Тема, тосты, поиск
   ========================================================================= */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  if (saved === 'light' || saved === 'dark') {
    applyTheme(saved);
    return;
  }
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(prefersLight ? 'light' : 'dark');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

let toastTimer = null;
function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 2400);
}

let searchTimer = null;
function onSearchInput(event) {
  state.query = event.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 120);
}

function resetFilters() {
  state.query = '';
  state.colors = new Set(COLORS.map((c) => c.id));
  $('#searchInput').value = '';
  $$('.fdot').forEach((b) => b.setAttribute('aria-pressed', 'true'));
  render();
}

function buildColorFilters() {
  const box = $('#colorFilters');
  COLORS.forEach((c) => {
    const btn = el('button', 'fdot');
    btn.type = 'button';
    btn.dataset.color = c.id;
    btn.title = `Показать: ${c.name.toLowerCase()}`;
    btn.setAttribute('aria-label', c.name);
    btn.setAttribute('aria-pressed', 'true');
    btn.addEventListener('click', () => {
      if (state.colors.has(c.id)) {
        if (state.colors.size === 1) return; // хотя бы один цвет должен остаться
        state.colors.delete(c.id);
      } else {
        state.colors.add(c.id);
      }
      btn.setAttribute('aria-pressed', String(state.colors.has(c.id)));
      render();
    });
    box.append(btn);
  });
}

function buildSwatches() {
  const box = $('#fColors');
  COLORS.forEach((c) => {
    const btn = el('button', 'swatch');
    btn.type = 'button';
    btn.dataset.color = c.id;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.setAttribute('aria-label', c.name);
    btn.title = c.name;
    btn.addEventListener('click', () => selectColor(c.id));
    box.append(btn);
  });
}

/* =========================================================================
   Фокус в модальном окне
   ========================================================================= */

function trapFocus(event, container) {
  const nodes = $$('button, input, select, textarea, [href]', container)
    .filter((n) => !n.disabled && n.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* =========================================================================
   Обработчики
   ========================================================================= */

function wireEvents() {
  $('#prevBtn').addEventListener('click', () => shift(-1));
  $('#nextBtn').addEventListener('click', () => shift(1));
  $('#todayBtn').addEventListener('click', () => {
    state.cursor = startOfDay(new Date());
    render();
  });

  $$('.view-switch button').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  $('#themeBtn').addEventListener('click', toggleTheme);
  $('#newBtn').addEventListener('click', () => {
    const base = defaultNewDate();
    const date = parseYmd(base);
    createAt(date, defaultStartMinutes(date));
  });

  $('#searchInput').addEventListener('input', onSearchInput);
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.target.value = '';
      state.query = '';
      e.target.blur();
      render();
    }
  });

  $('#resetFilters').addEventListener('click', resetFilters);

  $('#modalClose').addEventListener('click', closeModal);
  $('#cancelBtn').addEventListener('click', closeModal);
  $('#deleteBtn').addEventListener('click', deleteCurrent);
  $('#eventForm').addEventListener('submit', submitForm);
  $('#fAllDay').addEventListener('change', toggleAllDayFields);
  $('#fRepeat').addEventListener('change', toggleUntilField);

  $('#modal').addEventListener('mousedown', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  document.addEventListener('keydown', onGlobalKeyDown);

  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      state.events = loadEvents();
      render();
    }
  });

  // обновление линии «сейчас» и смена суток
  setInterval(() => {
    const todayKey = ymd(new Date());
    if (todayKey !== state.lastToday) {
      render();
    } else {
      updateNowLines();
    }
  }, 30000);
}

function onGlobalKeyDown(event) {
  const modal = $('#modal');

  if (!modal.hidden) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    } else if (event.key === 'Tab') {
      trapFocus(event, modal);
    }
    return;
  }

  const tag = (event.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;

  switch (event.code) {
    case 'KeyN':
      event.preventDefault();
      $('#newBtn').click();
      break;
    case 'KeyT':
      event.preventDefault();
      state.cursor = startOfDay(new Date());
      render();
      break;
    case 'KeyM':
      setView('month');
      break;
    case 'KeyW':
      setView('week');
      break;
    case 'KeyD':
      setView('day');
      break;
    case 'Slash':
      event.preventDefault();
      $('#searchInput').focus();
      break;
    case 'ArrowLeft':
      event.preventDefault();
      shift(-1);
      break;
    case 'ArrowRight':
      event.preventDefault();
      shift(1);
      break;
    default:
      break;
  }
}

/* =========================================================================
   Старт
   ========================================================================= */

function init() {
  initTheme();
  state.events = loadEvents();
  state.lastToday = ymd(new Date());
  buildColorFilters();
  buildSwatches();
  wireEvents();
  render();

  // подсказка при первом запуске
  try {
    if (!localStorage.getItem('calendar.greeted')) {
      localStorage.setItem('calendar.greeted', '1');
      setTimeout(() => toast('Кликните по дню, чтобы добавить событие'), 700);
    }
  } catch (e) { /* ignore */ }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
