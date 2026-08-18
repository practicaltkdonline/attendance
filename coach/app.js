/**
 * 教練課堂管理 - 前端
 * 請把 API_URL 改成你的 Apps Script 網頁應用程式網址
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbx_VuMkR7vnp9Isiy1-SNOuMa7G3ZD8Zgd4Vw4OVlBxmN3Sev_USGiQQ9K0kuAwR_w/exec';

const DOJOS = ['紅磡', '觀塘', '鰂魚涌'];
const PRESET_TIMES = [
  { label: '09:30-10:30', code: '09301030' },
  { label: '10:00-11:00', code: '10001100' },
  { label: '11:30-12:30', code: '11301230' },
  { label: '14:00-15:00', code: '14001500' },
  { label: '16:15-17:15', code: '16151715' },
  { label: '17:30-18:30', code: '17301830' },
  { label: '19:00-20:00', code: '19002000' },
  { label: '20:15-21:15', code: '20152115' },
];

let selectedDojos = new Set(DOJOS);
let currentMonth = new Date(); currentMonth.setDate(1);
let currentDay = null;
let currentSession = null;
let currentMakeup = null;
let studentStats = {};
let coachName = localStorage.getItem('coachName') || '';

function invalidateMonthCache() {
  try {
    Object.keys(sessionStorage).forEach(k => {
      if (k.startsWith('monthSummary_')) sessionStorage.removeItem(k);
    });
  } catch (e) {}
}

function dayCacheKey(dateYmd) {
  return 'day_' + dateYmd + '_' + [...selectedDojos].sort().join(',');
}
function invalidateDayCache(dateYmd) {
  try {
    if (dateYmd) sessionStorage.removeItem(dayCacheKey(dateYmd));
    else Object.keys(sessionStorage).forEach(k => {
      if (k.startsWith('day_')) sessionStorage.removeItem(k);
    });
  } catch (e) {}
}

// ========== API ==========
async function api(action, data = {}) {
  if (!API_URL || API_URL.includes('請貼上')) {
    throw new Error('請先在 app.js 設定 API_URL');
  }
  const body = JSON.stringify({ action, ...data });
  // Apps Script 對 CORS POST 有時較麻煩，用 text/plain 較穩
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'API 失敗');
  return json;
}

function normalizeTimeCode(code) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length === 7) code = '0' + code; // 9301030 → 09301030
  if (code.length === 6) code = code + '00'; // 罕見
  return code;
}

function timeCodeToDisplay(code) {
  code = normalizeTimeCode(code);
  if (code.length !== 8) return code || '';
  const h1 = code.slice(0, 2), m1 = code.slice(2, 4);
  const h2 = code.slice(4, 6), m2 = code.slice(6, 8);
  const f = (h, m) => {
    let hh = parseInt(h, 10);
    if (isNaN(hh)) return h + ':' + m;
    const ampm = hh >= 12 ? 'pm' : 'am';
    if (hh > 12) hh -= 12;
    if (hh === 0) hh = 12;
    return hh + ':' + m + ampm;
  };
  // 列表只顯示開始時間；完整區間需要時再用
  return f(h1, m1);
}

function timeCodeToRange(code) {
  code = normalizeTimeCode(code);
  if (code.length !== 8) return code || '';
  const h1 = code.slice(0, 2), m1 = code.slice(2, 4);
  const h2 = code.slice(4, 6), m2 = code.slice(6, 8);
  const f = (h, m) => {
    let hh = parseInt(h, 10);
    const ampm = hh >= 12 ? 'pm' : 'am';
    if (hh > 12) hh -= 12;
    if (hh === 0) hh = 12;
    return hh + ':' + m + ampm;
  };
  return f(h1, m1) + ' - ' + f(h2, m2);
}

function formatDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function toYmd(dateStr) {
  return String(dateStr || '').replace(/-/g, '');
}
function formatDisplayDate(ymd) {
  const s = String(ymd);
  if (s.length !== 8) return s;
  const d = new Date(s.slice(0,4) + '-' + s.slice(4,6) + '-' + s.slice(6,8) + 'T00:00:00');
  const week = ['日','一','二','三','四','五','六'];
  return (d.getMonth()+1) + '月' + d.getDate() + '日 星期' + week[d.getDay()];
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('show');
  void t.offsetWidth;
  t.classList.add('show');
}

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.getElementById('backBtn').style.display = name === 'month' || name === 'makeup' ? 'none' : 'block';
  const titles = {
    month: '課堂管理', day: '單日課堂', attend: '點名',
    makeup: '待補堂', arrange: '安排補堂', setup: '設定'
  };
  document.getElementById('headerTitle').textContent = titles[name] || '課堂管理';
  document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.remove('active'));
  if (name === 'makeup' || name === 'arrange') {
    document.querySelector('[data-nav="makeup"]')?.classList.add('active');
  } else if (name === 'setup') {
    document.querySelector('[data-nav="setup"]')?.classList.add('active');
  } else {
    document.querySelector('[data-nav="calendar"]')?.classList.add('active');
  }
}

// ========== 道場篩選 ==========
function renderDojoFilter(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.innerHTML = DOJOS.map(d =>
    `<button class="filter-chip ${selectedDojos.has(d)?'active':''}" data-dojo="${d}">${d}</button>`
  ).join('') + `<button class="filter-chip ${selectedDojos.size===DOJOS.length?'active':''}" data-dojo="all">全部</button>`;
  el.querySelectorAll('.filter-chip').forEach(btn => {
    btn.onclick = () => {
      const v = btn.dataset.dojo;
      if (v === 'all') selectedDojos = selectedDojos.size === DOJOS.length ? new Set() : new Set(DOJOS);
      else { selectedDojos.has(v) ? selectedDojos.delete(v) : selectedDojos.add(v); }
      renderDojoFilter('dojoFilterMonth');
      renderDojoFilter('dojoFilterDay');
      if (document.getElementById('view-month').classList.contains('active')) renderMonth();
      if (document.getElementById('view-day').classList.contains('active')) loadDay();
    };
  });
}

// ========== 月曆 ==========
async function renderMonth() {
  const year = currentMonth.getFullYear(), month = currentMonth.getMonth();
  document.getElementById('monthLabel').textContent = `${year}年 ${month+1}月`;
  const startPad = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const todayStr = formatDate(new Date());
  const prevDays = new Date(year, month, 0).getDate();

  // 先畫格子
  let html = '';
  for (let i = startPad - 1; i >= 0; i--) {
    html += `<div class="month-cell other-month"><div class="month-day-num">${prevDays - i}</div></div>`;
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = formatDate(new Date(year, month, day));
    const isToday = dateStr === todayStr;
    html += `<div class="month-cell ${isToday?'today':''}" data-date="${dateStr}">
      <div class="month-day-num">${day}</div>
      <div class="month-dots" data-dots="${toYmd(dateStr)}"></div>
    </div>`;
  }
  document.getElementById('monthGrid').innerHTML = html;
  document.getElementById('monthGrid').querySelectorAll('.month-cell[data-date]').forEach(cell => {
    cell.onclick = () => {
      currentDay = cell.dataset.date;
      loadDay();
    };
  });

  // 背景載入有課的日子（有快取）
  try {
    const dojoKey = [...selectedDojos].sort().join(',');
    const cacheKey = `monthSummary_${year}_${month+1}_${dojoKey}`;
    let days = null;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const obj = JSON.parse(cached);
        if (Date.now() - obj.ts < 5 * 60 * 1000) days = obj.days; // 5 分鐘快取
      }
    } catch (e) {}

    if (!days) {
      const res = await api('getMonthSummary', {
        year,
        month: month + 1,
        dojos: [...selectedDojos]
      });
      days = res.days || {};
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), days }));
      } catch (e) {}
    }

    Object.keys(days).forEach(ymd => {
      const el = document.querySelector(`[data-dots="${ymd}"]`);
      if (!el) return;
      const n = Math.min(days[ymd].count || 0, 4);
      el.innerHTML = Array.from({length: n}, () => '<span class="dot"></span>').join('');
      const cell = el.closest('.month-cell');
      if (cell && n > 0) cell.classList.add('has-class');
    });
  } catch (err) {
    console.warn('月摘要載入失敗', err);
  }
}

async function loadDay(forceRefresh) {
  showView('day');
  const ymd = toYmd(currentDay);
  document.getElementById('dayTitle').textContent = formatDisplayDate(ymd);
  document.getElementById('classList').innerHTML = '<div class="empty">載入中…</div>';
  try {
    const key = dayCacheKey(ymd);
    let res = null;
    if (!forceRefresh) {
      try {
        const cached = sessionStorage.getItem(key);
        if (cached) {
          const obj = JSON.parse(cached);
          if (Date.now() - obj.ts < 2 * 60 * 1000) res = obj.data; // 2 分鐘
        }
      } catch (e) {}
    }
    if (!res) {
      res = await api('getClassesByDate', {
        date: ymd,
        dojos: [...selectedDojos]
      });
      try {
        sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: res }));
      } catch (e) {}
    }
    studentStats = res.stats || {};
    renderDayList(res.sessions || []);
  } catch (err) {
    document.getElementById('classList').innerHTML = `<div class="empty">載入失敗：${err.message}</div>`;
  }
}

function renderDayList(sessions) {
  const pending = sessions.filter(s => !s.attendanceDone).length;
  document.getElementById('daySummary').textContent =
    sessions.length ? `共 ${sessions.length} 堂` + (pending ? ` · ${pending} 堂未點名` : '') : '';

  if (!sessions.length) {
    document.getElementById('classList').innerHTML = '<div class="empty">這一天沒有符合篩選的課堂</div>';
    return;
  }

  const groups = {};
  DOJOS.forEach(d => groups[d] = []);
  sessions.forEach(s => { if (groups[s.dojo]) groups[s.dojo].push(s); });

  let html = '';
  DOJOS.forEach(dojo => {
    const items = groups[dojo];
    if (!items.length) return;
    html += `<div class="dojo-group"><div class="dojo-header">${dojo} <span>${items.length}堂</span></div>`;
    items.forEach(s => {
      const tag = s.isMakeupOnly ? 'makeup' : (s.attendanceDone ? 'done' : 'pending');
      const tagText = s.isMakeupOnly ? '補堂' : (s.attendanceDone ? '已點' : '未點');
      html += `<div class="class-card ${tag}" data-key="${s.sessionKey}">
        <div class="class-time">${timeCodeToDisplay(s.timeCode)}</div>
        <div class="class-body">
          <div class="class-name">${s.className || '課堂'}</div>
          <div class="class-meta">${s.students.length} 人</div>
        </div>
        <span class="status-tag ${tag}">${tagText}</span>
      </div>`;
    });
    html += '</div>';
  });
  document.getElementById('classList').innerHTML = html;
  document.getElementById('classList').querySelectorAll('.class-card').forEach(card => {
    card.onclick = () => {
      currentSession = sessions.find(s => s.sessionKey === card.dataset.key);
      openAttend();
    };
  });
}

function openAttend() {
  showView('attend');
  const s = currentSession;
  document.getElementById('attendClassInfo').innerHTML = `
    <h2>${timeCodeToRange(s.timeCode)}</h2>
    <div style="font-size:0.88rem;color:var(--muted)">
      ${formatDisplayDate(s.date)} · ${s.className} · ${s.dojo}
    </div>`;

  // 初始化狀態
  s.students.forEach(st => {
    if (st.status === '出席') st._ui = 'present';
    else if (st.status === '缺席') st._ui = 'absent';
    else if (st.status === '請假') st._ui = 'leave';
    else st._ui = st._ui || null;
  });

  renderStudentList();
  document.getElementById('logProgress').value = '';
  document.getElementById('logGood').value = '';
  document.getElementById('logImprove').value = '';
  document.getElementById('logNext').value = '';
  document.getElementById('logNote').value = '';
}

function renderStudentList() {
  const s = currentSession;
  document.getElementById('studentList').innerHTML = s.students.map((st, idx) => {
    const stat = studentStats[st.name] || { done: 0, total: 0, remain: 0 };
    const remain = stat.remain || Math.max(0, (stat.total || 0) - (stat.done || 0));
    const badge = st.isMakeup ? ' <span class="status-tag makeup">補堂</span>' : '';
    return `<div class="student-row" data-idx="${idx}">
      <div class="student-name">${st.name}${badge}</div>
      <div class="student-count">已上 ${stat.done || 0}／剩 ${remain}</div>
      <div class="status-btns">
        <button class="status-btn ${st._ui==='present'?'active-present':''}" data-status="present">出席</button>
        <button class="status-btn ${st._ui==='absent'?'active-absent':''}" data-status="absent">缺席</button>
        <button class="status-btn ${st._ui==='leave'?'active-leave':''}" data-status="leave">請假</button>
      </div>
    </div>`;
  }).join('');

  document.getElementById('studentList').querySelectorAll('.status-btn').forEach(btn => {
    btn.onclick = () => {
      const idx = Number(btn.closest('.student-row').dataset.idx);
      const status = btn.dataset.status;
      s.students[idx]._ui = s.students[idx]._ui === status ? null : status;
      renderStudentList();
    };
  });
}

async function saveAll() {
  const s = currentSession;
  const unset = s.students.filter(st => !st._ui);
  if (unset.length && !confirm(`還有 ${unset.length} 位未選擇，確定儲存？`)) return;

  const statusMap = { present: '出席', absent: '缺席', leave: '請假' };
  const records = s.students.filter(st => st._ui).map(st => ({
    classKey: st.classKey,
    name: st.name,
    date: s.date,
    timeCode: s.timeCode,
    dojo: s.dojo,
    status: statusMap[st._ui]
  }));

  const leaveItems = s.students.filter(st => st._ui === 'leave' && !st.isMakeup).map(st => ({
    studentName: st.name,
    originKey: st.classKey,
    originDate: s.date,
    originTime: s.timeCode,
    originDojo: s.dojo,
    className: s.className
  }));

  // 補堂學生請假 → 該補堂ID 回待補
  const makeupLeaveIds = s.students
    .filter(st => st._ui === 'leave' && st.isMakeup && st.makeupId)
    .map(st => st.makeupId);

  const log = {
    sessionKey: s.sessionKey,
    date: s.date,
    timeCode: s.timeCode,
    dojo: s.dojo,
    className: s.className,
    progress: document.getElementById('logProgress').value.trim(),
    good: document.getElementById('logGood').value.trim(),
    improve: document.getElementById('logImprove').value.trim(),
    next: document.getElementById('logNext').value.trim(),
    note: document.getElementById('logNote').value.trim()
  };

  // 樂觀 UI：立刻返回列表
  const msgParts = ['已儲存'];
  if (leaveItems.length) msgParts.push(`新增 ${leaveItems.length} 待補`);
  if (makeupLeaveIds.length) msgParts.push(`${makeupLeaveIds.length} 補堂回待補`);
  showToast(msgParts.join('，'));
  invalidateDayCache(s.date);
  loadDay(true);
  refreshMakeupBadge();

  // 背景寫入
  try {
    await api('saveAll', { records, log, leaveItems, makeupLeaveIds, coach: coachName });
    invalidateMonthCache();
    invalidateDayCache(s.date);
  } catch (err) {
    alert('背景儲存失敗，請再試一次：\n' + err.message);
  }
}

// ========== 待補堂 ==========
async function loadMakeups() {
  showView('makeup');
  document.getElementById('makeupList').innerHTML = '<div class="empty">載入中…</div>';
  try {
    const [pendingRes, arrangedRes] = await Promise.all([
      api('getPendingMakeups'),
      api('getArrangedMakeups')
    ]);
    renderMakeupList(pendingRes.makeups || [], arrangedRes.makeups || []);
    updateBadge((pendingRes.makeups || []).length);
  } catch (err) {
    document.getElementById('makeupList').innerHTML = `<div class="empty">${err.message}</div>`;
  }
}

function renderMakeupList(pending, arranged) {
  let html = '';

  html += `<div style="font-size:0.85rem;font-weight:600;margin-bottom:8px;color:var(--primary)">待安排（${pending.length}）</div>`;
  if (!pending.length) {
    html += '<div class="empty" style="padding:16px">目前沒有待補堂</div>';
  } else {
    html += pending.map(m => `
      <div class="makeup-card">
        <h3>${m.studentName}</h3>
        <div class="makeup-meta">原定：${formatDisplayDate(m.originDate)} ${timeCodeToRange(m.originTime)} · ${m.originDojo}<br>${m.className || ''}</div>
        <button class="btn-arrange" data-id="${m.id}">安排補堂時間</button>
        <button class="btn-cancel-soft" data-id="${m.id}" style="margin-top:6px">取消此待補</button>
      </div>
    `).join('');
  }

  html += `<div style="font-size:0.85rem;font-weight:600;margin:16px 0 8px;color:#7c3aed">已安排（${arranged.length}）</div>`;
  if (!arranged.length) {
    html += '<div class="empty" style="padding:16px">尚未有已安排的補堂</div>';
  } else {
    html += arranged.map(m => `
      <div class="makeup-card" style="border-left-color:#7c3aed">
        <h3>${m.studentName}</h3>
        <div class="makeup-meta">
          補堂：${formatDisplayDate(m.newDate)} ${timeCodeToRange(m.newTime)} · ${m.newDojo}<br>
          原定：${formatDisplayDate(m.originDate)} ${timeCodeToRange(m.originTime)} · ${m.originDojo}
        </div>
        <button class="btn-arrange" data-id="${m.id}" data-mode="edit">更改時間</button>
        <button class="btn-cancel-soft" data-id="${m.id}" data-mode="revert" style="margin-top:6px">取消安排（回待補）</button>
      </div>
    `).join('');
  }

  document.getElementById('makeupList').innerHTML = html;

  document.getElementById('makeupList').querySelectorAll('.btn-arrange').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const mode = btn.dataset.mode || 'new';
      currentMakeup = pending.find(m => m.id === id) || arranged.find(m => m.id === id);
      openArrange(mode === 'edit');
    };
  });

  document.getElementById('makeupList').querySelectorAll('.btn-cancel-soft').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const mode = btn.dataset.mode;
      if (mode === 'revert') {
        if (!confirm('取消此次安排，回到待補堂？')) return;
        try {
          await api('cancelArrangement', { id, coach: coachName });
          invalidateMonthCache();
          showToast('已回待補');
          loadMakeups();
        } catch (e) { alert(e.message); }
      } else {
        if (!confirm('確定取消此待補？（之後可在紀錄中看到「取消」）')) return;
        try {
          await api('cancelMakeup', { id, note: '教練取消待補' });
          showToast('已取消待補');
          loadMakeups();
        } catch (e) { alert(e.message); }
      }
    };
  });
}

function openArrange(isEdit) {
  showView('arrange');
  const m = currentMakeup;
  document.getElementById('arrangeInfo').innerHTML =
    `<h3>${m.studentName}${isEdit ? '（更改時間）' : ''}</h3>
     <div style="font-size:0.88rem;color:var(--muted)">原定：${formatDisplayDate(m.originDate)} ${timeCodeToRange(m.originTime)} · ${m.originDojo}</div>`;
  // 改期時帶入現有值
  if (isEdit && m.newDate) {
    const d = String(m.newDate);
    document.getElementById('arrangeDate').value = d.length === 8 ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : '';
    document.getElementById('arrangeTimeCode').value = normalizeTimeCode(m.newTime || '');
    document.getElementById('arrangeDojo').value = m.newDojo || m.originDojo || '紅磡';
  } else {
    document.getElementById('arrangeDate').value = '';
    document.getElementById('arrangeTimeCode').value = '';
    document.getElementById('arrangeDojo').value = m.originDojo || '紅磡';
  }
  document.getElementById('arrangeNote').value = '';
  const preset = document.getElementById('presetTimes');
  preset.innerHTML = PRESET_TIMES.map(t =>
    `<button type="button" data-code="${t.code}">${t.label}</button>`
  ).join('');
  preset.querySelectorAll('button').forEach(btn => {
    btn.onclick = () => {
      preset.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('arrangeTimeCode').value = btn.dataset.code;
    };
  });
}

async function confirmArrange() {
  const date = document.getElementById('arrangeDate').value;
  let timeCode = document.getElementById('arrangeTimeCode').value.trim();
  const dojo = document.getElementById('arrangeDojo').value;
  const note = document.getElementById('arrangeNote').value.trim();
  if (!date) return alert('請選擇日期');
  timeCode = normalizeTimeCode(timeCode);
  if (!timeCode || timeCode.length !== 8) return alert('請選擇時段（請點常用時段或輸入8位代碼）');
  if (!currentMakeup || !currentMakeup.id) return alert('找不到補堂資料，請返回重試');

  const btn = document.getElementById('btnConfirmArrange');
  btn.disabled = true;
  btn.textContent = '處理中…';
  try {
    await api('arrangeMakeup', {
      id: currentMakeup.id,
      newDate: toYmd(date),
      newTime: timeCode,
      newDojo: dojo,
      note,
      coach: coachName
    });
    invalidateMonthCache();
    invalidateDayCache();
    showToast('已安排補堂');
    loadMakeups();
  } catch (err) {
    alert('失敗：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '確認安排';
  }
}

function updateBadge(n) {
  const badge = document.getElementById('makeupBadge');
  if (n > 0) { badge.style.display = 'flex'; badge.textContent = n; }
  else badge.style.display = 'none';
}

async function refreshMakeupBadge() {
  try {
    const res = await api('getPendingMakeups');
    updateBadge((res.makeups || []).length);
  } catch (e) {}
}

// ========== 事件 ==========
document.getElementById('backBtn').onclick = () => {
  if (document.getElementById('view-attend').classList.contains('active') ||
      document.getElementById('view-arrange').classList.contains('active')) {
    if (document.getElementById('view-arrange').classList.contains('active')) loadMakeups();
    else loadDay();
  } else {
    showView('month');
    renderMonth();
  }
};
document.getElementById('prevMonth').onclick = () => {
  currentMonth.setMonth(currentMonth.getMonth() - 1); renderMonth();
};
document.getElementById('nextMonth').onclick = () => {
  currentMonth.setMonth(currentMonth.getMonth() + 1); renderMonth();
};
document.getElementById('btnAllPresent').onclick = () => {
  currentSession.students.forEach(st => st._ui = 'present');
  renderStudentList();
};
document.getElementById('btnClearStatus').onclick = () => {
  currentSession.students.forEach(st => st._ui = null);
  renderStudentList();
};
document.getElementById('btnSave').onclick = saveAll;
document.getElementById('btnBackDay').onclick = () => loadDay();
document.getElementById('btnConfirmArrange').onclick = confirmArrange;
document.getElementById('btnCancelArrange').onclick = () => loadMakeups();

document.querySelectorAll('.bottom-nav button').forEach(btn => {
  btn.onclick = () => {
    const nav = btn.dataset.nav;
    if (nav === 'calendar') { showView('month'); renderMonth(); }
    else if (nav === 'makeup') loadMakeups();
    else if (nav === 'setup') {
      showView('setup');
      document.getElementById('inputCoach').value = coachName;
    }
  };
});

document.getElementById('btnSaveCoach').onclick = () => {
  coachName = document.getElementById('inputCoach').value.trim();
  localStorage.setItem('coachName', coachName);
  showToast('已儲存教練名稱');
};

document.getElementById('btnTestApi').onclick = async () => {
  try {
    const r = await api('ping');
    showToast('API 連線成功：' + r.time);
  } catch (err) {
    alert('連線失敗：' + err.message);
  }
};

// init
renderDojoFilter('dojoFilterMonth');
renderDojoFilter('dojoFilterDay');
showView('month');
renderMonth();
refreshMakeupBadge();
