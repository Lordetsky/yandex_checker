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
  const contestId = document.getElementById("contest-id").value.trim();
  const deadline = document.getElementById("deadline").value;
  const authorInput = document.getElementById("author-filter").value.trim();
  const author = exactAuthorLogin || authorInput;

  if (!contestId) { showError("Введите ID контеста"); return; }
  if (!deadline) { showError("Укажите дату и время дедлайна"); return; }

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
  const contestId = document.getElementById("contest-id").value.trim();
  if (!contestId || contestId.length < 3) return;
  
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
  document.getElementById("sub-count").textContent = subs.length;

  if (subs.length === 0) {
    container.innerHTML = '<div class="empty-state">Посылки не найдены</div>';
    return;
  }

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

  // If reports haven't been loaded, buildTestsList will handle empty tests
  const testsAllHtml = buildTestsList(s.tests_all, `tests-all-${idx}`);
  const testsFailedHtml = s.tests_failed && s.tests_failed.length > 0
    ? buildTestsList(s.tests_failed, `tests-failed-${idx}`)
    : (s.has_full_report ? '<div class="empty-state" style="padding:16px">Все тесты прошли успешно ✓</div>' : '');

  return `
    <div class="detail-tabs">
      <button class="tab-btn active" onclick="switchTab(${idx}, 'source', this)">Код</button>
      <button class="tab-btn" onclick="switchTab(${idx}, 'tests-all', this)">Все тесты (${s.tests_all ? s.tests_all.length : 0})</button>
      <button class="tab-btn" onclick="switchTab(${idx}, 'tests-failed', this)">Не OK (${s.tests_failed ? s.tests_failed.length : 0})</button>
    </div>
    ${problemInfo}
    <div class="tab-panel active" id="tab-source-${idx}">
      <pre class="code-block"><code class="language-${getHighlightLang(s.compiler)}">${escapeHtml(s.source || '— нет кода —')}</code></pre>
    </div>
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

// Support Enter key
document.addEventListener("DOMContentLoaded", () => {
  const contestInput = document.getElementById("contest-id");
  const authorInput = document.getElementById("author-filter");
  let fetchTimeout = null;

  contestInput.addEventListener("keydown", e => {
    if (e.key === "Enter") loadSubmissions();
  });
  
  // Fetch authors for autocomplete when contest ID changes
  contestInput.addEventListener("input", () => {
    clearTimeout(fetchTimeout);
    fetchTimeout = setTimeout(fetchAuthors, 500);
  });
  contestInput.addEventListener("change", fetchAuthors);

  document.getElementById("deadline").addEventListener("keydown", e => {
    if (e.key === "Enter") loadSubmissions();
  });
  
  // Trigger search when Enter is pressed
  authorInput.addEventListener("keydown", e => {
    if (e.key === "Enter") loadSubmissions();
  });

  // Automatically trigger search when an option is selected from the datalist
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
