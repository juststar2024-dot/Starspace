
const $ = (selector) => document.querySelector(selector);

const STORAGE = {
  tasks: "starspace-tasks",
  projects: "starspace-projects",
  savings: "starspace-piggybanks"
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function load(key, fallback = []) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let tasks = load(STORAGE.tasks).map(task => ({
  ...task,
  type: task.type || "once",
  completed: Boolean(task.completed)
}));

let projects = load(STORAGE.projects).map(project => ({
  ...project,
  children: Array.isArray(project.children) ? project.children : []
}));

let savings = load(STORAGE.savings).map(item => ({
  ...item,
  name: item.name || item.title || "Моя мечта",
  goal: Number(item.goal ?? item.target ?? 0),
  amount: Number(item.amount ?? item.saved ?? 0)
}));

let taskFilter = "all";
let activeParentId = null;
let activeMoneyId = null;
let moneyMode = "deposit";

function persistTasks() {
  save(STORAGE.tasks, tasks);
}

function persistProjects() {
  save(STORAGE.projects, projects);
}

function persistSavings() {
  save(STORAGE.savings, savings);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function money(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} ₽`;
}

function safeDateLabel() {
  return new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

/* ЕЖЕДНЕВНЫЕ ЗАДАЧИ */

function prepareDailyTasks() {
  const current = today();
  const previous = yesterday();

  tasks = tasks.map(task => {
    if (task.type !== "daily") return task;

    // Старые задачи, созданные до обновления, тоже сохраняются.
    if (!task.lastResetDate) {
      return {
        ...task,
        lastResetDate: current,
        completedDate: task.completed ? current : null,
        missedYesterday: false
      };
    }

    if (task.lastResetDate === current) return task;

    const missed =
      task.lastResetDate === previous &&
      !task.completed &&
      task.createdDate !== current;

    return {
      ...task,
      completed: false,
      completedDate: null,
      lastResetDate: current,
      missedYesterday: Boolean(missed || task.missedYesterday)
    };
  });

  persistTasks();
}

function addTask(title, type = "once") {
  const date = today();

  tasks.unshift({
    id: makeId(),
    title,
    type,
    completed: false,
    createdDate: date,
    completedDate: null,
    lastResetDate: type === "daily" ? date : null,
    missedYesterday: false
  });

  persistTasks();
  renderAll();
}

function toggleTask(id, checked) {
  tasks = tasks.map(task => {
    if (task.id !== id) return task;

    return {
      ...task,
      completed: checked,
      completedDate: checked ? today() : null,
      missedYesterday: checked ? false : task.missedYesterday
    };
  });

  persistTasks();
  renderAll();
}

function deleteTask(id) {
  tasks = tasks.filter(task => task.id !== id);
  persistTasks();
  renderAll();
}

function renderTasks() {
  const list = $("#taskList");
  const empty = $("#emptyTasks");
  const notice = $("#missedNotice");

  const missed = tasks.filter(
    task => task.type === "daily" && task.missedYesterday
  );

  if (missed.length) {
    notice.classList.remove("hidden");
    notice.innerHTML =
      `<strong>🌙 Не забудь сделать вчерашнее!</strong><br>` +
      missed.map(task => `• ${escapeHTML(task.title)}`).join("<br>");
  } else {
    notice.classList.add("hidden");
    notice.textContent = "";
  }

  const filtered = tasks.filter(task => {
    if (taskFilter === "daily") return task.type === "daily";
    if (taskFilter === "once") return task.type !== "daily";
    return true;
  });

  list.innerHTML = filtered.map(task => `
    <div class="task-item ${task.completed ? "completed" : ""}">
      <input
        class="task-check"
        type="checkbox"
        data-action="toggle-task"
        data-id="${escapeHTML(task.id)}"
        ${task.completed ? "checked" : ""}
        aria-label="Отметить задачу выполненной"
      >
      <div class="task-content">
        <span class="task-title">
          ${escapeHTML(task.title)}
          ${task.type === "daily"
            ? '<span class="tag">Ежедневная</span>'
            : ""}
        </span>
        <span class="task-meta">
          ${task.type === "daily"
            ? "Обновляется каждый день"
            : "Разовая задача"}
          ${task.missedYesterday ? " · Осталась со вчера" : ""}
        </span>
      </div>
      <button class="icon-button" data-action="delete-task" data-id="${escapeHTML(task.id)}" aria-label="Удалить задачу">✕</button>
    </div>
  `).join("");

  empty.classList.toggle("hidden", filtered.length > 0);
}

/* ПРОЕКТЫ И ВЛОЖЕННЫЕ ЗАДАЧИ */

function addProject(title) {
  projects.unshift({
    id: makeId(),
    title,
    completed: false,
    children: [],
    createdAt: today()
  });

  persistProjects();
  renderAll();
}

function findNode(nodes, id) {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children || [], id);
    if (found) return found;
  }
  return null;
}

function addSubtask(parentId, title) {
  const node = findNode(projects, parentId);
  if (!node) return;

  if (!Array.isArray(node.children)) node.children = [];

  node.children.push({
    id: makeId(),
    title,
    completed: false,
    children: [],
    createdAt: today()
  });

  persistProjects();
  renderAll();
}

function updateNode(nodes, id, callback) {
  for (const node of nodes) {
    if (node.id === id) {
      callback(node);
      return true;
    }

    if (updateNode(node.children || [], id, callback)) return true;
  }
  return false;
}

function removeNode(nodes, id) {
  const index = nodes.findIndex(node => node.id === id);
  if (index !== -1) {
    nodes.splice(index, 1);
    return true;
  }

  for (const node of nodes) {
    if (removeNode(node.children || [], id)) return true;
  }

  return false;
}

function toggleNode(id, checked) {
  updateNode(projects, id, node => {
    node.completed = checked;

    // При отметке проекта целиком меняются и все его подзадачи.
    if (node.children?.length) {
      setChildrenCompleted(node.children, checked);
    }
  });

  persistProjects();
  renderAll();
}

function setChildrenCompleted(nodes, completed) {
  nodes.forEach(node => {
    node.completed = completed;
    setChildrenCompleted(node.children || [], completed);
  });
}

function getProgress(node) {
  const children = node.children || [];

  if (!children.length) {
    return {
      done: node.completed ? 1 : 0,
      total: 1
    };
  }

  return children.reduce((result, child) => {
    const progress = getProgress(child);
    result.done += progress.done;
    result.total += progress.total;
    return result;
  }, { done: 0, total: 0 });
}

function renderTree(nodes) {
  if (!nodes.length) {
    return '<p class="project-empty">Пока нет подзадач — добавь первый шаг ✨</p>';
  }

  return `<div class="tree">${nodes.map(node => `
    <div class="tree-node">
      <div class="tree-row ${node.completed ? "completed" : ""}">
        <input
          type="checkbox"
          class="task-check"
          data-action="toggle-node"
          data-id="${escapeHTML(node.id)}"
          ${node.completed ? "checked" : ""}
          aria-label="Отметить подзадачу выполненной"
        >
        <span class="task-title">${escapeHTML(node.title)}</span>
        <button
          class="small-button secondary"
          data-action="add-child"
          data-id="${escapeHTML(node.id)}"
          data-title="${escapeHTML(node.title)}"
          title="Добавить вложенную задачу"
        >＋</button>
        <button
          class="icon-button"
          data-action="delete-node"
          data-id="${escapeHTML(node.id)}"
          aria-label="Удалить подзадачу"
        >✕</button>
      </div>
      ${node.children?.length ? renderTree(node.children) : ""}
    </div>
  `).join("")}</div>`;
}

function renderProjects() {
  const list = $("#projectList");

  list.innerHTML = projects.map(project => {
    const progress = getProgress(project);
    const percent = progress.total
      ? Math.round(progress.done / progress.total * 100)
      : 0;

    return `
      <article class="project-card">
        <div class="project-top">
          <input
            class="task-check"
            type="checkbox"
            data-action="toggle-node"
            data-id="${escapeHTML(project.id)}"
            ${project.completed ? "checked" : ""}
            aria-label="Завершить проект"
          >
          <div class="project-info">
            <div class="project-title">${escapeHTML(project.title)}</div>
            <div class="project-progress-label">
              <span>Прогресс проекта</span>
              <strong>${percent}% · ${progress.done}/${progress.total}</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width:${percent}%"></div>
            </div>
          </div>
        </div>

        <div class="project-actions">
          <button data-action="add-child" data-id="${escapeHTML(project.id)}" data-title="${escapeHTML(project.title)}">＋ Подзадача</button>
          <button class="secondary" data-action="delete-node" data-id="${escapeHTML(project.id)}">Удалить проект</button>
        </div>

        ${renderTree(project.children || [])}
      </article>
    `;
  }).join("");

  $("#emptyProjects").classList.toggle("hidden", projects.length > 0);
}

/* КОПИЛКИ */

function addSavings(name, goal) {
  savings.unshift({
    id: makeId(),
    name,
    goal,
    amount: 0
  });

  persistSavings();
  renderAll();
}

function openMoneyDialog(id, mode) {
  const item = savings.find(entry => entry.id === id);
  if (!item) return;

  activeMoneyId = id;
  moneyMode = mode;

  $("#moneyTitle").textContent =
    mode === "deposit" ? "Пополнить копилку 🪙" : "Снять деньги";
  $("#moneyDescription").textContent =
    `${item.name} · сейчас ${money(item.amount)}`;
  $("#moneySubmit").textContent =
    mode === "deposit" ? "Пополнить" : "Снять";
  $("#moneyAmount").value = "";

  $("#moneyDialog").showModal();
}

function changeMoney(id, amount, mode) {
  const item = savings.find(entry => entry.id === id);
  if (!item) return;

  if (mode === "withdraw" && amount > item.amount) {
    alert("В копилке недостаточно средств.");
    return;
  }

  item.amount += mode === "deposit" ? amount : -amount;
  persistSavings();
  renderAll();
}

function deleteSavings(id) {
  const item = savings.find(entry => entry.id === id);
  if (!item) return;

  if (!confirm(`Удалить копилку «${item.name}»?`)) return;

  savings = savings.filter(entry => entry.id !== id);
  persistSavings();
  renderAll();
}

function renderSavings() {
  const list = $("#savingsList");

  list.innerHTML = savings.map(item => {
    const percent = item.goal > 0
      ? Math.min(100, Math.round(item.amount / item.goal * 100))
      : 0;

    return `
      <article class="savings-card">
        <div class="savings-name">${escapeHTML(item.name)}</div>
        <div class="savings-amount">${money(item.amount)}</div>
        <div class="savings-target">из ${money(item.goal)} · ${percent}%</div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${percent}%"></div>
        </div>
        ${percent >= 100 ? '<p class="savings-target">🎉 Цель достигнута!</p>' : ""}
        <div class="savings-actions">
          <button data-action="deposit" data-id="${escapeHTML(item.id)}">＋ Пополнить</button>
          <button class="secondary" data-action="withdraw" data-id="${escapeHTML(item.id)}">− Снять</button>
          <button class="danger" data-action="delete-savings" data-id="${escapeHTML(item.id)}">Удалить</button>
        </div>
      </article>
    `;
  }).join("");

  $("#emptySavings").classList.toggle("hidden", savings.length > 0);
}

/* СТАТИСТИКА */

function renderStats() {
  const completedOnce = tasks.filter(
    task => task.type !== "daily" && task.completed
  ).length;

  const completedDaily = tasks.filter(
    task => task.type === "daily" &&
      task.completed &&
      task.completedDate === today()
  ).length;

  const total = tasks.filter(
    task => task.type !== "daily" || task.lastResetDate === today()
  ).length;

  const completedToday = tasks.filter(task =>
    task.completed &&
    (task.type !== "daily" || task.completedDate === today())
  ).length;

  $("#taskStat").textContent = `${completedToday} / ${total}`;
  $("#xpStat").textContent = `${(completedOnce + completedDaily) * 10} XP`;

  const totalSavings = savings.reduce(
    (sum, item) => sum + Number(item.amount || 0), 0
  );

  $("#savingsStat").textContent = money(totalSavings);
}

function renderAll() {
  renderTasks();
  renderProjects();
  renderSavings();
  renderStats();
}

/* СОБЫТИЯ */

$("#todayLabel").textContent = safeDateLabel();

$("#taskForm").addEventListener("submit", event => {
  event.preventDefault();

  const input = $("#taskInput");
  const title = input.value.trim();
  if (!title) return;

  const daily = confirm(
    "Сделать задачу ежедневной?\n\nОК — ежедневная.\nОтмена — обычная разовая."
  );

  addTask(title, daily ? "daily" : "once");
  input.value = "";
  input.focus();
});

document.querySelectorAll("[data-task-filter]").forEach(button => {
  button.addEventListener("click", () => {
    taskFilter = button.dataset.taskFilter;

    document.querySelectorAll("[data-task-filter]").forEach(tab => {
      tab.classList.toggle("active", tab === button);
    });

    renderTasks();
  });
});

$("#projectForm").addEventListener("submit", event => {
  event.preventDefault();

  const input = $("#projectInput");
  const title = input.value.trim();
  if (!title) return;

  addProject(title);
  input.value = "";
});

$("#savingsForm").addEventListener("submit", event => {
  event.preventDefault();

  const name = $("#savingsName").value.trim();
  const goal = Number($("#savingsGoal").value);

  if (!name || !Number.isFinite(goal) || goal <= 0) {
    alert("Введи название копилки и положительную сумму цели.");
    return;
  }

  addSavings(name, goal);
  $("#savingsName").value = "";
  $("#savingsGoal").value = "";
});

document.addEventListener("change", event => {
  const control = event.target;
  const action = control.dataset.action;
  const id = control.dataset.id;

  if (action === "toggle-task") toggleTask(id, control.checked);
  if (action === "toggle-node") toggleNode(id, control.checked);
});

document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const { action, id, title } = button.dataset;

  if (action === "delete-task") deleteTask(id);

  if (action === "add-child") {
    activeParentId = id;
    $("#subtaskParentLabel").textContent = `Внутри: ${title}`;
    $("#subtaskInput").value = "";
    $("#subtaskDialog").showModal();
    $("#subtaskInput").focus();
  }

  if (action === "delete-node") {
    if (!confirm("Удалить этот проект или подзадачу вместе со всеми вложенными шагами?")) {
      return;
    }

    removeNode(projects, id);
    persistProjects();
    renderAll();
  }

  if (action === "deposit") openMoneyDialog(id, "deposit");
  if (action === "withdraw") openMoneyDialog(id, "withdraw");
  if (action === "delete-savings") deleteSavings(id);
});

$("#subtaskForm").addEventListener("submit", event => {
  event.preventDefault();

  const title = $("#subtaskInput").value.trim();
  if (!title || !activeParentId) return;

  addSubtask(activeParentId, title);
  $("#subtaskDialog").close();
  activeParentId = null;
});

$("#cancelSubtask").addEventListener("click", () => {
  $("#subtaskDialog").close();
  activeParentId = null;
});

$("#moneyForm").addEventListener("submit", event => {
  event.preventDefault();

  const amount = Number($("#moneyAmount").value);

  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Введи положительную сумму.");
    return;
  }

  changeMoney(activeMoneyId, amount, moneyMode);
  $("#moneyDialog").close();
  activeMoneyId = null;
});

$("#cancelMoney").addEventListener("click", () => {
  $("#moneyDialog").close();
  activeMoneyId = null;
});

/* ЗАПУСК */

prepareDailyTasks();
renderAll();
