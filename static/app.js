// ===== State =====
let allSubmissions = [];
let currentStats = null;
let timeChartInstance = null;

// ===== Verdict color map =====
const VERDICT_COLORS = {
  "OK": "#16a34a",
  "Accepted": "#16a34a",
  "WrongAnswer": "#dc2626",
  "TimeLimitExceeded": "#d97706",
  "MemoryLimitExceeded": "#d97706",
  "RuntimeError": "#be185d",
  "CompilationError": "#7c3aed",
  "PresentationError": "#2563eb",
  "Ignored": "#9ca3af",
  "Pending": "#9ca3af",
};

const VERDICT_LABELS = {
  "OK": "OK",
  "Accepted": "Accepted",
  "WrongAnswer": "WA",
  "TimeLimitExceeded": "TLE",
  "MemoryLimitExceeded": "MLE",
  "RuntimeError": "RE",
  "CompilationError": "CE",
  "PresentationError": "PE",
};

function verdictClass(v) {
  const known = ["OK","Accepted","WrongAnswer","TimeLimitExceeded","MemoryLimitExceeded","RuntimeError","CompilationError","PresentationError"];
  return known.includes(v) ? `verdict-${v}` : "verdict-default";
}

function verdictLabel(v) {
  return VERDICT_LABELS[v] || v;
}

// ===== Load submissions =====
async function loadSubmissions(exactAuthorLogin = null) {
  let contestInputVal = document.getElementById("contest-id").value.trim();
  let contestId = parseInt(contestInputVal, 10);
  let deadline = document.getElementById("deadline").value;
  const authorInput = document.getElementById("author-filter").value.trim();
  const author = exactAuthorLogin || authorInput;

  if (isNaN(contestId)) { showError("Выберите контест из списка или введите ID"); return; }
  
  if (!deadline) { 
      // User requested to automatically fill and proceed
      await fetchContestInfo(); 
      deadline = document.getElementById("deadline").value;
      if (!deadline) {
          showError("Укажите дату и время дедлайна"); 
          return; 
      }
  }

  setLoading(true);
  hideError();

  try {
    const params = new URLSearchParams({
      contest_id: contestId,
      deadline: deadline,
    });
    if (author) {
      params.append("author", author);
      if (exactAuthorLogin) {
        params.append("exact_match", "true");
      }
    }

    const res = await fetch(`/api/submissions?${params}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    const data = await res.json();
    
    if (data.status === "multiple") {
        showDisambiguationModal(data.matches);
        setLoading(false);
        return;
    }

    allSubmissions = data.submissions;
    currentStats = data.stats;

    renderStats(currentStats, author);
    renderSubmissions(allSubmissions);
    
    // We already have authors if we fetched them for autocomplete, 
    // but we can update if needed.
    if (currentStats.verdict_counts) {
        populateVerdictFilter(currentStats.verdict_counts);
    }

    document.getElementById("results").classList.remove("hidden");
  } catch (e) {
    showError(`Ошибка: ${e.message}`);
  } finally {
    setLoading(false);
  }
}

async function fetchAuthors() {
  const contestInputVal = document.getElementById("contest-id").value.trim();
  const contestId = parseInt(contestInputVal, 10);
  if (isNaN(contestId) || contestId < 100) return;
  
  try {
    const res = await fetch(`/api/authors?contest_id=${contestId}`);
    if (!res.ok) return;
    const data = await res.json();
    const datalist = document.getElementById("authors-datalist");
    datalist.innerHTML = data.authors.map(a => `<option value="${escapeHtml(a)}">`).join("");
  } catch (e) {
    console.error("Failed to fetch authors", e);
  }
}

// ===== Modal Logic =====
function showDisambiguationModal(matches) {
  const modal = document.getElementById("disambiguation-modal");
  const listContainer = document.getElementById("modal-authors-list");
  
  listContainer.innerHTML = matches.map(m => `
    <button class="author-btn" onclick="selectAuthor('${escapeHtml(m.author)}')">
      <span class="author-btn-name">${escapeHtml(m.name)}</span>
      <span class="author-btn-login">${escapeHtml(m.author)}</span>
    </button>
  `).join("");
  
  modal.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("disambiguation-modal").classList.add("hidden");
}

function selectAuthor(login) {
  closeModal();
  document.getElementById("author-filter").value = login;
  loadSubmissions(login);
}

function clearResults() {
  allSubmissions = [];
  currentStats = null;
  document.getElementById("results").classList.add("hidden");
  document.getElementById("contest-id").value = "";
  document.getElementById("deadline").value = "";
  document.getElementById("author-filter").value = "";
  hideError();
  if (timeChartInstance) { timeChartInstance.destroy(); timeChartInstance = null; }
}

// ===== Stats rendering =====
function renderStats(stats, author) {
  const title = author
    ? `Статистика для: ${author}`
    : "Глобальная статистика";
  document.getElementById("stats-title").textContent = title;

  document.getElementById("stat-total").textContent = stats.total;
  document.getElementById("stat-avg-score").textContent =
    stats.avg_score !== null ? stats.avg_score : "—";
  document.getElementById("stat-before").textContent = stats.before_deadline;
  document.getElementById("stat-after").textContent = stats.after_deadline;

  const cardSolved = document.getElementById("card-solved");
  const cardGrade = document.getElementById("card-grade");
  if (stats.solved_tasks !== undefined && stats.grade !== undefined) {
    document.getElementById("stat-solved").textContent = `${stats.solved_tasks} / ${stats.total_tasks}`;
    document.getElementById("stat-grade").textContent = stats.grade;
    cardSolved.classList.remove("hidden");
    cardGrade.classList.remove("hidden");
  } else {
    cardSolved.classList.add("hidden");
    cardGrade.classList.add("hidden");
  }

  renderVerdictBars(stats.verdict_counts, stats.total);
  renderTimeChart(stats.time_distribution);
}

function renderVerdictBars(counts, total) {
  const container = document.getElementById("verdict-bars");
  container.innerHTML = "";
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  sorted.forEach(([verdict, count]) => {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const color = VERDICT_COLORS[verdict] || "#9ca3af";
    container.innerHTML += `
      <div class="verdict-bar-item">
        <div class="verdict-bar-label">
          <span>${verdict}</span>
          <span>${count} (${pct}%)</span>
        </div>
        <div class="verdict-bar-track">
          <div class="verdict-bar-fill" style="width:${pct}%; background:${color};"></div>
        </div>
      </div>
    `;
  });
}

function renderTimeChart(distribution) {
  const labels = Object.keys(distribution);
  const values = Object.values(distribution);

  if (timeChartInstance) { timeChartInstance.destroy(); }

  const ctx = document.getElementById("time-chart").getContext("2d");
  timeChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Посылки",
        data: values,
        backgroundColor: "rgba(79,110,247,0.7)",
        borderColor: "rgba(79,110,247,1)",
        borderWidth: 1,
        borderRadius: 3,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, maxRotation: 45 }
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,.05)" },
          ticks: { font: { size: 11 }, precision: 0 }
        }
      }
    }
  });
}

// ===== Submissions rendering =====
function renderSubmissions(subs) {
  const container = document.getElementById("submissions-container");
  const header = document.getElementById("sub-table-header");
  document.getElementById("sub-count").textContent = subs.length;

  if (subs.length === 0) {
    container.innerHTML = '<div class="empty-state">Посылки не найдены</div>';
    if (header) header.classList.add("hidden");
    return;
  }

  if (header) header.classList.remove("hidden");
  container.innerHTML = subs.map((s, idx) => buildSubItem(s, idx)).join("");
  
  // Apply highlight.js syntax highlighting
  container.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });
}

function buildSubItem(s, idx) {
  const deadlineHtml = s.deadline_diff
    ? `<span class="sub-cell--deadline ${s.deadline_diff.is_late ? 'late' : 'on-time'}">
         ${s.deadline_diff.is_late ? '▲ +' : '▼ '}${s.deadline_diff.label}
       </span>`
    : `<span class="sub-cell--deadline">—</span>`;

  let prevSub = null;
  for (let i = 0; i < allSubmissions.length; i++) {
     if (allSubmissions[i].author === s.author && allSubmissions[i].timestamp < s.timestamp) {
         if (!prevSub || allSubmissions[i].timestamp > prevSub.timestamp) {
             prevSub = allSubmissions[i];
         }
     }
  }

  let timeDiffHtml = `<span class="sub-cell sub-cell--timediff">—</span>`;
  if (prevSub && s.timestamp && prevSub.timestamp) {
       const diffSec = s.timestamp - prevSub.timestamp;
       if (diffSec >= 0) {
           const h = Math.floor(diffSec / 3600);
           const m = Math.floor((diffSec % 3600) / 60);
           const s_sec = Math.floor(diffSec % 60);
           
           let label = "";
           if (h > 0) label = `+${h}ч ${m}м`;
           else if (m > 0) label = `+${m}м ${s_sec}с`;
           else label = `+${s_sec}с`;
           
           timeDiffHtml = `<span class="sub-cell sub-cell--timediff" title="После предыдущей: ${label}" style="color: var(--text-secondary); font-size: 11.5px;">${label}</span>`;
       }
  }

  const vClass = verdictClass(s.verdict);
  const vLabel = verdictLabel(s.verdict);

  return `
    <div class="sub-item" id="sub-${idx}">
      <div class="sub-header" onclick="toggleDetail(${idx})">
        <span class="sub-cell sub-cell--id">#${s.id}</span>
        <span class="sub-cell sub-cell--task">Задача ${s.problem_alias}</span>
        <span class="sub-cell sub-cell--author" title="${s.author}">${s.author}</span>
        <span class="sub-cell sub-cell--compiler">${s.compiler}</span>
        <span class="sub-cell sub-cell--time">${s.submission_time_msk}</span>
        <span class="sub-cell"><span class="verdict-badge ${vClass}">${vLabel}</span></span>
        <span class="sub-cell">${s.score !== null ? s.score : '—'}</span>
        ${deadlineHtml}
        ${timeDiffHtml}
        <span class="sub-cell sub-cell--expand">
          <span>Подробнее</span>
          <span class="chevron-${idx}">▼</span>
        </span>
      </div>
      <div class="sub-detail" id="detail-${idx}">
        ${buildDetailContent(s, idx)}
      </div>
    </div>
  `;
}

function buildDetailContent(s, idx) {
  const problemInfo = s.problem_name
    ? `<div style="margin-bottom:12px;font-size:13px;color:var(--text-secondary)">Задача: <strong>${s.problem_name}</strong> (${s.problem_alias})</div>`
    : "";

  let prevSubId = null;
  let prevSubTime = 0;
  for (let i = 0; i < allSubmissions.length; i++) {
     if (allSubmissions[i].author === s.author && allSubmissions[i].problem_alias === s.problem_alias && allSubmissions[i].timestamp < s.timestamp) {
         if (!prevSubId || allSubmissions[i].timestamp > prevSubTime) {
             prevSubId = allSubmissions[i].id;
             prevSubTime = allSubmissions[i].timestamp;
         }
     }
  }

  const diffTabHtml = prevSubId 
    ? `<button class="tab-btn" onclick="switchTab(${idx}, 'diff', this); loadDiff(${idx}, ${prevSubId}, ${s.id})">Разница с пред. (#${prevSubId})</button>`
    : "";

  const diffPanelHtml = prevSubId
    ? `<div class="tab-panel" id="tab-diff-${idx}">
         <div id="diff-content-${idx}" style="padding:16px"><div class="empty-state">Нажмите чтобы загрузить...</div></div>
       </div>`
    : "";

  // If reports haven't been loaded, buildTestsList will handle empty tests
  const testsAllHtml = buildTestsList(s.tests_all, `tests-all-${idx}`);
  const testsFailedHtml = s.tests_failed && s.tests_failed.length > 0
    ? buildTestsList(s.tests_failed, `tests-failed-${idx}`)
    : (s.has_full_report ? '<div class="empty-state" style="padding:16px">Все тесты прошли успешно ✓</div>' : '');

  return `
    <div class="detail-tabs">
      <button class="tab-btn active" onclick="switchTab(${idx}, 'source', this)">Код</button>
      ${diffTabHtml}
      <button class="tab-btn" onclick="switchTab(${idx}, 'tests-all', this)">Все тесты (${s.tests_all ? s.tests_all.length : 0})</button>
      <button class="tab-btn" onclick="switchTab(${idx}, 'tests-failed', this)">Не OK (${s.tests_failed ? s.tests_failed.length : 0})</button>
    </div>
    ${problemInfo}
    <div class="tab-panel active" id="tab-source-${idx}">
      <pre class="code-block"><code class="language-${getHighlightLang(s.compiler)}">${escapeHtml(s.source || '— нет кода —')}</code></pre>
    </div>
    ${diffPanelHtml}
    <div class="tab-panel" id="tab-tests-all-${idx}">
      ${testsAllHtml}
    </div>
    <div class="tab-panel" id="tab-tests-failed-${idx}">
      ${testsFailedHtml}
    </div>
  `;
}

function buildTestsList(tests, containerId) {
  if (!tests || tests.length === 0) {
    return '<div class="empty-state" style="padding:16px">Тесты отсутствуют</div>';
  }
  return tests.map((t, i) => {
    const vClass = verdictClass(t.verdict);
    const hasContent = t.input || t.output || t.answer || t.message || t.error;
    const ms = t.runningTime ? `${t.runningTime} мс` : "";
    const mb = t.memoryUsed ? `${(t.memoryUsed / 1024 / 1024).toFixed(1)} МБ` : "";
    const resources = [ms, mb].filter(Boolean).join(" · ");
    const isSample = t.isSample ? ' 🔑' : '';
    
    let tOut = t.output;
    let tCorr = t.answer;
    if (t.message && !tOut && !tCorr) {
      // Regex to match: out: \n >...< \n corr: \n >...<
      const m1 = t.message.match(/out:\s*>([^<]*)<\s*corr:\s*>([^<]*)</is);
      if (m1) { tOut = m1[1]; tCorr = m1[2]; }
      else {
        // Regex to match: expected '...', found '...'
        const m2 = t.message.match(/expected\s*:?\s*['"](.*?)['"],\s*found\s*:?\s*['"](.*?)['"]/is);
        if (m2) { tOut = m2[2]; tCorr = m2[1]; }
      }
    }

    return `
      <div class="test-item">
        <div class="test-item-header" onclick="toggleTest('${containerId}-${i}')">
          <span class="verdict-badge ${vClass}">${verdictLabel(t.verdict)}</span>
          <span class="test-name">${escapeHtml(t.testName || `Тест ${i+1}`)}${isSample}</span>
          <span class="test-time">${resources}</span>
          <span class="test-chevron" id="chevron-${containerId}-${i}">▼</span>
        </div>
        <div class="test-item-body" id="testbody-${containerId}-${i}">
          ${t.message ? `<div class="test-field"><div class="test-field-label">Сообщение</div><div class="test-msg">${escapeHtml(t.message)}</div></div>` : ""}
          ${t.input ? `<div class="test-field"><div class="test-field-label">Входные данные</div><div class="test-field-value">${escapeHtml(t.input)}</div></div>` : ""}
          ${(tOut || tCorr) ? `
            <div class="test-diff-row">
              ${tOut ? `<div class="test-diff-col"><div class="test-field-label">Ответ участника</div><div class="test-field-value">${escapeHtml(tOut)}</div></div>` : ""}
              ${tCorr ? `<div class="test-diff-col"><div class="test-field-label">Правильный ответ</div><div class="test-field-value">${escapeHtml(tCorr)}</div></div>` : ""}
            </div>
          ` : ""}
          ${t.error ? `<div class="test-field"><div class="test-field-label">Ошибка</div><div class="test-field-value">${escapeHtml(t.error)}</div></div>` : ""}
          ${!t.message && !t.input && !tOut && !tCorr && !t.error ? `<div class="test-msg" style="color:var(--text-muted)">Нет дополнительной информации</div>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

// ===== Toggle functions =====
async function toggleDetail(idx) {
  const s = allSubmissions[idx];
  const detail = document.getElementById(`detail-${idx}`);
  const header = detail.previousElementSibling;
  const chevron = header.querySelector(`.chevron-${idx}`);
  const isVisible = detail.classList.contains("visible");

  if (!isVisible && !s.has_full_report) {
    // Lazy load full report
    const contestId = document.getElementById("contest-id").value;
    try {
      detail.innerHTML = '<div class="loader-container" style="padding:40px; text-align:center;"><span class="spinner spinner--small"></span> <span style="margin-left:12px; color:var(--text-secondary)">Загрузка отчета...</span></div>';
      detail.classList.add("visible");
      
      const res = await fetch(`/api/submissions/${contestId}/${s.id}/full`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const full = await res.json();
      
      // Update state
      s.source = full.source;
      s.tests_all = full.checkerLog || [];
      s.tests_failed = s.tests_all.filter(t => t.verdict !== "OK");
      if (full.problemName) s.problem_name = full.problemName;
      s.has_full_report = true;
      
      // Re-render detail content
      detail.innerHTML = buildDetailContent(s, idx);
      // Syntax highlight
      detail.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
    } catch (e) {
      detail.innerHTML = `<div class="error-msg" style="padding:20px; color:var(--danger)">Ошибка загрузки: ${e.message}</div>`;
      return;
    }
  } else {
    detail.classList.toggle("visible", !isVisible);
  }

  header.classList.toggle("expanded", !isVisible);
  chevron.textContent = isVisible ? "▼" : "▲";
}

function toggleTest(id) {
  const body = document.getElementById(`testbody-${id}`);
  const chevron = document.getElementById(`chevron-${id}`);
  const header = body.previousElementSibling;
  const isVisible = body.classList.contains("visible");
  body.classList.toggle("visible", !isVisible);
  header.classList.toggle("expanded", !isVisible);
  if (chevron) chevron.classList.toggle("up", !isVisible);
}

function switchTab(idx, tabName, btn) {
  const detail = document.getElementById(`detail-${idx}`);
  detail.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  detail.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  btn.classList.add("active");
  const panel = document.getElementById(`tab-${tabName}-${idx}`);
  if (panel) panel.classList.add("active");
}

async function loadDiff(idx, prevId, currentId) {
    const contentDiv = document.getElementById(`diff-content-${idx}`);
    if (contentDiv.dataset.loaded) return;
    
    contentDiv.innerHTML = '<div class="loader-container" style="padding:40px; text-align:center;"><span class="spinner spinner--small"></span> <span style="margin-left:12px; color:var(--text-secondary)">Сравнение кода...</span></div>';
    
    try {
        const contestId = document.getElementById("contest-id").value.trim();
        const res = await fetch(`/api/submissions/${contestId}/diff?sub1=${prevId}&sub2=${currentId}`);
        if (!res.ok) throw new Error("Ошибка загрузки");
        const data = await res.json();
        
        if (!data.diff) {
             contentDiv.innerHTML = '<div class="empty-state" style="padding:16px">Изменений в коде нет</div>';
        } else {
             contentDiv.innerHTML = `<pre class="code-block"><code class="language-diff">${escapeHtml(data.diff)}</code></pre>`;
             hljs.highlightElement(contentDiv.querySelector('code'));
        }
        contentDiv.dataset.loaded = "true";
    } catch (e) {
        contentDiv.innerHTML = `<div class="error-msg" style="padding:20px; color:var(--danger)">Ошибка: ${e.message}</div>`;
    }
}

// ===== Filtering =====
function filterTable() {
  const search = document.getElementById("search-input").value.toLowerCase();
  const verdict = document.getElementById("verdict-filter").value;

  const filtered = allSubmissions.filter(s => {
    const matchSearch = !search ||
      s.author.toLowerCase().includes(search) ||
      s.problem_alias.toLowerCase().includes(search) ||
      (s.problem_name || "").toLowerCase().includes(search);
    const matchVerdict = !verdict || s.verdict === verdict;
    return matchSearch && matchVerdict;
  });

  renderSubmissions(filtered);
}

function populateVerdictFilter(counts) {
  const select = document.getElementById("verdict-filter");
  select.innerHTML = '<option value="">Все вердикты</option>';
  Object.keys(counts).sort().forEach(v => {
    select.innerHTML += `<option value="${v}">${v} (${counts[v]})</option>`;
  });
}

// ===== UI helpers =====
function setLoading(loading) {
  const btnLoad = document.getElementById("load-btn");
  const btnSearch = document.getElementById("search-btn");
  const text = document.getElementById("btn-text");
  const spinnerLoad = document.getElementById("btn-spinner");
  const spinnerSearch = document.getElementById("search-spinner");
  
  if (btnLoad) {
    btnLoad.disabled = loading;
    if (text) text.textContent = loading ? "Загрузка..." : "Загрузить";
    if (spinnerLoad) spinnerLoad.classList.toggle("hidden", !loading);
  }
  if (btnSearch) {
    btnSearch.disabled = loading;
    if (spinnerSearch) spinnerSearch.classList.toggle("hidden", !loading);
  }
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError() {
  document.getElementById("error-msg").classList.add("hidden");
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getHighlightLang(compiler) {
  if (!compiler) return 'plaintext';
  compiler = compiler.toLowerCase();
  if (compiler.includes('python')) return 'python';
  if (compiler.includes('gnu c') || compiler.includes('gcc') || compiler.includes('clang')) return 'cpp';
  if (compiler.includes('java')) return 'java';
  if (compiler.includes('go')) return 'go';
  if (compiler.includes('c#') || compiler.includes('mcs')) return 'csharp';
  if (compiler.includes('ruby')) return 'ruby';
  if (compiler.includes('rust')) return 'rust';
  if (compiler.includes('js') || compiler.includes('node')) return 'javascript';
  if (compiler.includes('pascal') || compiler.includes('fpc')) return 'pascal';
  return 'plaintext';
}

async function fetchContestInfo() {
  const contestInputVal = document.getElementById("contest-id").value.trim();
  const contestId = parseInt(contestInputVal, 10);
  if (isNaN(contestId) || contestId < 100) return;

  const dlInput = document.getElementById("deadline");
  if (dlInput.value) return; // do not overwrite if already set

  try {
    const res = await fetch(`/api/contest-info?contest_id=${contestId}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.startTime) {
      if (dlInput.value) return; // double check
      const startDt = new Date(data.startTime);
      startDt.setDate(startDt.getDate() + 14); // 2 weeks

      const yyyy = startDt.getFullYear();
      const MM = String(startDt.getMonth() + 1).padStart(2, '0');
      const dd = String(startDt.getDate()).padStart(2, '0');
      
      dlInput.value = `${yyyy}-${MM}-${dd}T22:00`;
    }
  } catch (e) {
    console.error("Failed to fetch contest info", e);
  }
}

// ===== Contest Combo Box Logic =====
let savedContests = [];
let comboOpen = false;

async function fetchSavedContests() {
  try {
    const res = await fetch("/api/contests");
    if (res.ok) {
      const data = await res.json();
      savedContests = data.contests || [];
      renderComboList();
    }
  } catch(e) { console.error("Error fetching contests", e); }
}

function initContestCombo() {
  const comboInput = document.getElementById("contest-id");
  const comboToggle = document.getElementById("combo-toggle");
  const comboDropdown = document.getElementById("combo-dropdown");
  const chevron = comboToggle.querySelector(".combo-chevron");
  
  fetchSavedContests();

  comboToggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    comboOpen = !comboOpen;
    comboDropdown.classList.toggle("hidden", !comboOpen);
    chevron.classList.toggle("open", comboOpen);
    if (comboOpen) {
      comboInput.focus();
      renderComboList();
    }
  });

  comboInput.addEventListener("focus", () => {
    comboOpen = true;
    comboDropdown.classList.remove("hidden");
    chevron.classList.add("open");
    renderComboList();
  });

  comboInput.addEventListener("input", () => {
    comboOpen = true;
    comboDropdown.classList.remove("hidden");
    chevron.classList.add("open");
    renderComboList();
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".contest-combo")) {
      comboOpen = false;
      comboDropdown.classList.add("hidden");
      chevron.classList.remove("open");
    }
  });
}

function renderComboList() {
  const list = document.getElementById("combo-list");
  const query = document.getElementById("contest-id").value.trim().toLowerCase();
  
  let filtered = savedContests;
  if (query && !(/^\d+$/.test(query))) {
    filtered = savedContests.filter(c => 
      c.id.toString().includes(query) || 
      (c.name && c.name.toLowerCase().includes(query))
    );
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="combo-empty">Контесты не найдены</div>';
    return;
  }

  list.innerHTML = filtered.map(c => {
    let nameHtml = escapeHtml(c.name || `Contest #${c.id}`);
    let idHtml = escapeHtml(c.id);
    if (query && !(/^\d+$/.test(query))) {
       const reg = new RegExp(`(${query})`, 'gi');
       nameHtml = nameHtml.replace(reg, '<span class="combo-highlight">$1</span>');
       idHtml = idHtml.replace(reg, '<span class="combo-highlight">$1</span>');
    }
    
    return `
      <div class="combo-item" onclick="selectContest(${c.id})">
        <span class="combo-item-id">${idHtml}</span>
        <span class="combo-item-name" title="${escapeHtml(c.name)}">${nameHtml}</span>
        <button class="combo-item-delete" onclick="deleteContest(event, ${c.id})" title="Удалить из списка">×</button>
      </div>
    `;
  }).join("");
}

window.selectContest = function(id) {
  const comboInput = document.getElementById("contest-id");
  comboInput.value = id;
  comboOpen = false;
  document.getElementById("combo-dropdown").classList.add("hidden");
  document.querySelector(".combo-chevron").classList.remove("open");
  
  fetchAuthors();
  fetchContestInfo();
};

window.deleteContest = async function(e, id) {
  e.preventDefault();
  e.stopPropagation();
  if(!confirm("Удалить контест из списка?")) return;
  try {
    const res = await fetch(`/api/contests/${id}`, { method: "DELETE" });
    if(res.ok) await fetchSavedContests();
  } catch(err) { console.error("Error deleting contest", err); }
};

// ===== Add Contest Modal Logic =====
function initAddContestModal() {
  document.getElementById("open-add-modal").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById("combo-dropdown").classList.add("hidden");
    document.querySelector(".combo-chevron").classList.remove("open");
    comboOpen = false;
    
    document.getElementById("add-contest-modal").classList.remove("hidden");
    document.getElementById("add-contest-input").focus();
    document.getElementById("add-contest-input").value = "";
    document.getElementById("added-contests-list").innerHTML = "";
    document.getElementById("add-contest-error").classList.add("hidden");
  });

  document.getElementById("add-contest-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") window.addContestFromModal();
  });
}

window.closeAddContestModal = function() {
  document.getElementById("add-contest-modal").classList.add("hidden");
  fetchSavedContests(); // update dropdown
};

window.addContestFromModal = async function() {
  const input = document.getElementById("add-contest-input");
  const btn = document.getElementById("add-contest-btn");
  const spinner = document.getElementById("add-contest-spinner");
  const btnText = document.getElementById("add-contest-btn-text");
  const errEl = document.getElementById("add-contest-error");
  const listEl = document.getElementById("added-contests-list");
  
  const val = input.value.trim();
  if (!val) return;
  
  const idStr = val.match(/\d+/);
  if (!idStr) {
      errEl.textContent = "Некорректный ID контеста";
      errEl.classList.remove("hidden");
      return;
  }
  const id = parseInt(idStr[0], 10);
  
  errEl.classList.add("hidden");
  
  btn.disabled = true;
  spinner.classList.remove("hidden");
  btnText.textContent = "Загрузка...";
  
  try {
    const res = await fetch(`/api/contests/add?contest_id=${id}`, { method: "POST" });
    if (!res.ok) {
        let errData = { detail: "Ошибка добавления" };
        try { errData = await res.json(); } catch(e) {}
        throw new Error(errData.detail || "Ошибка добавления");
    }
    const data = await res.json();
    
    // Add to list UI
    const c = data.contest;
    let stClass = data.status === "exists" ? "exists" : "success";
    let stText = data.status === "exists" ? "Обновлён" : "Добавлен";
    
    const html = `
      <div class="added-contest-item">
        <span class="added-contest-id">${c.id}</span>
        <span class="added-contest-name">${escapeHtml(c.name)}</span>
        <span class="added-contest-status ${stClass}">${stText}</span>
      </div>
    `;
    listEl.insertAdjacentHTML("afterbegin", html);
    input.value = "";
    input.focus();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    spinner.classList.add("hidden");
    btnText.textContent = "Добавить";
  }
};

// Initialization
document.addEventListener("DOMContentLoaded", () => {
  const contestInput = document.getElementById("contest-id");
  const authorInput = document.getElementById("author-filter");
  let fetchTimeout = null;

  initContestCombo();
  initAddContestModal();

  contestInput.addEventListener("keydown", e => {
    if (e.key === "Enter") loadSubmissions();
  });
  
  contestInput.addEventListener("input", () => {
    clearTimeout(fetchTimeout);
    fetchTimeout = setTimeout(() => {
        fetchAuthors();
        fetchContestInfo();
    }, 500);
  });
  contestInput.addEventListener("change", () => {
      fetchAuthors();
      fetchContestInfo();
  });

  document.getElementById("deadline").addEventListener("keydown", e => {
    if (e.key === "Enter") loadSubmissions();
  });
  
  authorInput.addEventListener("keydown", e => {
    if (e.key === "Enter") loadSubmissions();
  });

  authorInput.addEventListener("input", (e) => {
    const val = e.target.value;
    const datalist = document.getElementById("authors-datalist");
    if (!datalist) return;
    const options = datalist.options;
    for (let i = 0; i < options.length; i++) {
        if (options[i].value === val) {
            loadSubmissions();
            break;
        }
    }
  });
});
