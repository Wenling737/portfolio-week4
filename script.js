// ====== Shared interactions (multi-page site) ======
(function () {
  'use strict';

  var nav = document.getElementById('nav');
  var navToggle = document.getElementById('navToggle');
  var navLinks = document.getElementById('navLinks');
  var toTop = document.getElementById('toTop');

  // --- Nav shadow on scroll + back-to-top visibility ---
  function onScroll() {
    var y = window.scrollY;
    if (nav) nav.classList.toggle('is-scrolled', y > 10);
    if (toTop) toTop.classList.toggle('is-visible', y > 500);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // --- Mobile menu toggle ---
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      var open = navToggle.classList.toggle('is-open');
      navLinks.classList.toggle('is-open', open);
      navToggle.setAttribute('aria-expanded', String(open));
    });

    navLinks.addEventListener('click', function (e) {
      if (e.target.classList.contains('nav__link')) {
        navToggle.classList.remove('is-open');
        navLinks.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // --- Back to top ---
  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // --- Reveal-on-scroll animations ---
  var revealTargets = document.querySelectorAll(
    '.hero__text > *, .hero__avatar, .like, .about-block, .project, .tl-item, .edu-item, .card, .channel, .form, .page__head, .section__head, .todo'
  );
  if ('IntersectionObserver' in window) {
    revealTargets.forEach(function (el, i) {
      el.classList.add('reveal');
      el.style.transitionDelay = (i % 4) * 0.08 + 's';
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealTargets.forEach(function (el) { io.observe(el); });
  }

  // --- Contact form: friendly client-side handling ---
  var form = document.getElementById('contactForm');
  if (form) {
    var success = document.getElementById('formSuccess');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.querySelector('#name');
      var email = form.querySelector('#email');
      var message = form.querySelector('#message');

      // Simple, gentle validation
      if (!name.value.trim() || !email.value.trim() || !message.value.trim()) {
        // Highlight the first empty required field
        if (!name.value.trim()) { name.focus(); return; }
        if (!email.value.trim()) { email.focus(); return; }
        message.focus();
        return;
      }
      // Basic email check
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
        email.focus();
        return;
      }

      if (success) {
        success.classList.add('is-visible');
        success.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      form.reset();
      // Hide the success message after a few seconds
      setTimeout(function () {
        if (success) success.classList.remove('is-visible');
      }, 6000);
    });
  }
})();

// ====== To-Do app (Projects page) ======
(function () {
  'use strict';

  var app = document.getElementById('todoApp');
  if (!app) return;

  var grid = app.querySelector('[data-cal-grid]');
  var titleEl = app.querySelector('[data-cal-title]');
  var prevBtn = app.querySelector('[data-cal-prev]');
  var nextBtn = app.querySelector('[data-cal-next]');
  var form = app.querySelector('[data-todo-form]');
  var input = app.querySelector('[data-todo-input]');
  var listEl = app.querySelector('[data-todo-list]');
  var emptyEl = app.querySelector('[data-todo-empty]');
  var countEl = app.querySelector('[data-todo-count]');
  var dateLabel = app.querySelector('[data-todo-date]');
  var pickerEl = app.querySelector('[data-todo-picker]');

  var MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ---- Supabase ----
  var SB_URL = 'https://txoxgqmifewlzqmmeaxu.supabase.co';
  var SB_KEY = 'sb_publishable_uF58wWgaxnILVZi1hRApNw_3qSd8xNR';
  var sb = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SB_URL, SB_KEY)
    : null;

  var viewDate = new Date();        // the month currently displayed
  var selectedDate = today();       // the date new tasks will attach to (defaults to today)
  var selectedEmoji = '';           // currently picked emoji tag ('' = none)
  var selectedPriority = 'medium';  // currently picked priority
  var editingId = null;             // id of the task currently being inline-edited

  var tasks = [];                   // loaded from Supabase on init

  // ---- Date helpers ----
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { var d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function fromKey(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function formatDate(d) { return MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }
  function formatDateShort(d) { return MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate(); }
  function priLabel(p) { return p === 'high' ? 'High' : p === 'low' ? 'Low' : 'Med'; }

  // ---- Supabase data layer ----
  // Map a DB row to the in-memory task shape the app already uses.
  // DB columns: task, is_complete, date, emoji, priority, created_at
  // Only trust short, non-ASCII emoji values — guards against malformed
  // column defaults (e.g. the literal string '"::text').
  function cleanEmoji(v) {
    v = String(v || '');
    return v.length <= 4 && /[^\u0000-\u007F]/.test(v) ? v : '';
  }
  function cleanPriority(v) {
    return (v === 'low' || v === 'high' || v === 'medium') ? v : 'medium';
  }

  function normalizeRow(r) {
    return {
      id: String(r.id),
      text: r.task || '',
      date: r.date || toKey(today()),
      done: !!r.is_complete,
      emoji: cleanEmoji(r.emoji),
      priority: cleanPriority(r.priority),
      created: r.created_at ? new Date(r.created_at).getTime() : Date.now()
    };
  }

  // Read all todos ordered by creation time (oldest first).
  async function loadTasks() {
    if (!sb) return [];
    var res = await sb.from('todos').select('*').order('created_at', { ascending: true });
    if (res.error) { console.error('[todo] load failed:', res.error); return []; }
    return (res.data || []).map(normalizeRow);
  }

  // Insert a new todo; returns the server-created row (with id + created_at).
  // Sends all app columns: task, date, is_complete, emoji, priority.
  // (Explicit values avoid the table's malformed column defaults.)
  async function insertTask(payload) {
    if (!sb) return null;
    var row = {
      task: payload.task,
      date: payload.date,
      is_complete: payload.is_complete,
      emoji: payload.emoji || '',
      priority: payload.priority || 'medium'
    };
    var res = await sb.from('todos').insert(row).select();
    if (res.error) { console.error('[todo] insert failed:', res.error); return null; }
    return res.data && res.data[0] ? normalizeRow(res.data[0]) : null;
  }

  async function updateTask(id, patch) {
    if (!sb) return;
    var res = await sb.from('todos').update(patch).eq('id', id);
    if (res.error) console.error('[todo] update failed:', res.error);
  }

  async function deleteTask(id) {
    if (!sb) return;
    var res = await sb.from('todos').delete().eq('id', id);
    if (res.error) console.error('[todo] delete failed:', res.error);
  }

  // Reload from the server and re-render (used to recover from sync errors).
  async function reload() {
    tasks = await loadTasks();
    render();
  }

  // ---- Calendar ----
  function renderCalendar() {
    titleEl.textContent = MONTHS_LONG[viewDate.getMonth()] + ' ' + viewDate.getFullYear();

    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    var first = new Date(year, month, 1);
    var startDay = first.getDay();                                   // 0 = Sunday
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var prevDays = new Date(year, month, 0).getDate();

    var todayK = toKey(today());
    var selectedK = toKey(selectedDate);
    var taskDates = {};
    tasks.forEach(function (t) { taskDates[t.date] = true; });

    var html = '';
    // Leading cells (previous month)
    for (var i = startDay - 1; i >= 0; i--) {
      var pd = prevDays - i;
      html += '<button type="button" class="cal__day is-other" data-day="' + pd + '" data-jump="prev">' + pd + '</button>';
    }
    // Current month days
    for (var day = 1; day <= daysInMonth; day++) {
      var cellDate = new Date(year, month, day);
      var key = toKey(cellDate);
      var classes = 'cal__day';
      if (key === todayK) classes += ' is-today';
      if (key === selectedK) classes += ' is-selected';
      if (taskDates[key]) classes += ' has-tasks';
      html += '<button type="button" class="' + classes + '" data-day="' + day + '">' + day + '</button>';
    }
    // Trailing cells (next month) to complete the final week
    var totalCells = startDay + daysInMonth;
    var trailing = (7 - (totalCells % 7)) % 7;
    for (var t = 1; t <= trailing; t++) {
      html += '<button type="button" class="cal__day is-other" data-day="' + t + '" data-jump="next">' + t + '</button>';
    }

    grid.innerHTML = html;
  }

  // ---- List ----
  function renderList() {
    var sorted = tasks.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.created - b.created;
    });
    listEl.innerHTML = '';
    sorted.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'todo__item' + (t.done ? ' is-done' : '');
      li.dataset.id = t.id;
      var d = fromKey(t.date);
      li.innerHTML =
        '<input type="checkbox" class="todo__check" data-todo-toggle' + (t.done ? ' checked' : '') + ' aria-label="Mark task done" />' +
        (t.emoji ? '<span class="todo__emoji" aria-hidden="true">' + t.emoji + '</span>' : '') +
        '<div class="todo__content">' +
          '<span class="todo__text" role="button" tabindex="0" title="Click to edit"></span>' +
          '<span class="todo__when">' + formatDateShort(d) + '</span>' +
        '</div>' +
        '<span class="todo__pri todo__pri--' + t.priority + '">' + priLabel(t.priority) + '</span>' +
        '<button type="button" class="todo__del" data-todo-del aria-label="Delete task">×</button>';
      li.querySelector('.todo__text').textContent = t.text;   // safe text injection
      listEl.appendChild(li);
    });
    emptyEl.style.display = sorted.length ? 'none' : 'block';
    renderCount();
  }

  function renderCount() {
    var total = tasks.length;
    var done = tasks.filter(function (t) { return t.done; }).length;
    if (total) {
      countEl.classList.add('is-visible');
      countEl.classList.toggle('is-complete', done === total);
      countEl.innerHTML = '<strong>' + done + ' of ' + total + '</strong> tasks completed';
    } else {
      countEl.classList.remove('is-visible');
      countEl.classList.remove('is-complete');
    }
  }

  function renderDateLabel() {
    dateLabel.innerHTML = 'Adding for <strong>' + formatDate(selectedDate) + '</strong>';
  }

  function render() { renderCalendar(); renderList(); renderDateLabel(); }

  // ---- Events: month navigation ----
  prevBtn.addEventListener('click', function () {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    renderCalendar();
  });
  nextBtn.addEventListener('click', function () {
    viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
    renderCalendar();
  });

  // ---- Events: date selection (delegated) ----
  grid.addEventListener('click', function (e) {
    var btn = e.target.closest('.cal__day');
    if (!btn) return;
    var day = parseInt(btn.dataset.day, 10);
    var jump = btn.dataset.jump;
    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    if (jump === 'prev') { month -= 1; if (month < 0) { month = 11; year -= 1; } }
    else if (jump === 'next') { month += 1; if (month > 11) { month = 0; year += 1; } }
    selectedDate = new Date(year, month, day);
    selectedDate.setHours(0, 0, 0, 0);
    // If the chosen day lives in a neighbouring month, bring it into view
    if (selectedDate.getMonth() !== viewDate.getMonth() || selectedDate.getFullYear() !== viewDate.getFullYear()) {
      viewDate = new Date(year, month, 1);
    }
    renderCalendar();
    renderDateLabel();
    input.focus();
  });

  // ---- Events: emoji + priority picker (delegated) ----
  pickerEl.addEventListener('click', function (e) {
    var emojiBtn = e.target.closest('[data-emoji]');
    var priBtn = e.target.closest('[data-pri]');
    if (emojiBtn) {
      // Toggle: clicking the active emoji clears it, otherwise swap selection
      var wasActive = emojiBtn.classList.contains('is-active');
      pickerEl.querySelectorAll('[data-emoji]').forEach(function (b) { b.classList.remove('is-active'); });
      if (wasActive) { selectedEmoji = ''; }
      else { emojiBtn.classList.add('is-active'); selectedEmoji = emojiBtn.dataset.emoji; }
      return;
    }
    if (priBtn) {
      pickerEl.querySelectorAll('[data-pri]').forEach(function (b) { b.classList.remove('is-active'); });
      priBtn.classList.add('is-active');
      selectedPriority = priBtn.dataset.pri;
    }
  });

  // ---- Events: add task ----
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    var payload = {
      task: text,
      date: toKey(selectedDate),
      is_complete: false,
      emoji: selectedEmoji,
      priority: selectedPriority
    };
    // Optimistic: show the task immediately with a temporary id.
    var tempId = 'tmp' + Date.now();
    tasks.push({
      id: tempId,
      text: payload.text,
      date: payload.date,
      done: false,
      created: Date.now(),
      emoji: payload.emoji,
      priority: payload.priority
    });
    input.value = '';
    selectedEmoji = '';
    pickerEl.querySelectorAll('[data-emoji].is-active').forEach(function (b) { b.classList.remove('is-active'); });
    render();
    input.focus();

    // Sync to Supabase and swap the temp id for the real server row.
    var real = await insertTask(payload);
    if (!real) {
      // Insert failed — roll the optimistic task back out.
      tasks = tasks.filter(function (t) { return t.id !== tempId; });
      render();
      return;
    }
    tasks = tasks.map(function (t) { return t.id === tempId ? real : t; });
    render();
  });

  // ---- Events: inline edit + delete (delegated) ----
  listEl.addEventListener('click', function (e) {
    // Click the task text to edit it inline
    var textSpan = e.target.closest('.todo__text');
    if (textSpan) {
      var li = textSpan.closest('.todo__item');
      var task = tasks.find(function (t) { return t.id === li.dataset.id; });
      if (task) beginEdit(li, task);
      return;
    }
    var delBtn = e.target.closest('[data-todo-del]');
    if (!delBtn) return;
    var delLi = delBtn.closest('.todo__item');
    if (!delLi) return;
    var id = delLi.dataset.id;
    // Optimistic remove, then sync to the database.
    tasks = tasks.filter(function (t) { return t.id !== id; });
    render();
    deleteTask(id);
  });

  // ---- Events: toggle done (delegated, change fires for label-box clicks too) ----
  listEl.addEventListener('change', function (e) {
    if (!e.target.matches('[data-todo-toggle]')) return;
    var li = e.target.closest('.todo__item');
    if (!li) return;
    var task = tasks.find(function (t) { return t.id === li.dataset.id; });
    if (!task) return;
    task.done = e.target.checked;
    li.classList.toggle('is-done', task.done);
    renderCount();
    updateTask(task.id, { is_complete: task.done });
  });

  // ---- Inline editing helpers ----
  function beginEdit(li, task) {
    if (editingId) return;                       // only one edit at a time
    var span = li.querySelector('.todo__text');
    if (!span) return;
    editingId = task.id;
    li.classList.add('is-editing');
    var field = document.createElement('input');
    field.type = 'text';
    field.className = 'todo__edit';
    field.value = task.text;
    field.setAttribute('aria-label', 'Edit task');
    field.setAttribute('autocomplete', 'off');
    span.replaceWith(field);
    field.focus();
    field.select();
  }

  function finishEdit(field, save) {
    if (!editingId) return;
    var id = editingId;
    editingId = null;
    var task = tasks.find(function (t) { return t.id === id; });
    var next = field.value.trim();
    if (save && task && next) {                  // blank input cancels instead of clearing
      task.text = next;
      updateTask(task.id, { task: next });
    }
    render();                                    // rebuilds the list, dropping the input
  }

  // Enter saves, Escape cancels; Enter/Space on a title starts editing
  listEl.addEventListener('keydown', function (e) {
    // role=button activation: focus a title, press Enter/Space to edit
    if (e.target.classList && e.target.classList.contains('todo__text')) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        var li = e.target.closest('.todo__item');
        var task = tasks.find(function (t) { return t.id === li.dataset.id; });
        if (task) beginEdit(li, task);
      }
      return;
    }
    if (!e.target.classList || !e.target.classList.contains('todo__edit')) return;
    if (e.key === 'Enter') { e.preventDefault(); finishEdit(e.target, true); }
    else if (e.key === 'Escape') { e.preventDefault(); finishEdit(e.target, false); }
  });

  // Clicking away also saves (fires before render tears the field down)
  listEl.addEventListener('focusout', function (e) {
    if (!e.target.classList || !e.target.classList.contains('todo__edit')) return;
    finishEdit(e.target, true);
  });

  // Render the shell immediately, then hydrate with tasks from Supabase.
  render();
  (async function init() {
    tasks = await loadTasks();
    render();
  })();
})();
