const STORAGE_KEY = "delta-aim-trainer-records";

const form = document.querySelector("#settings-form");
const durationInput = document.querySelector("#duration");
const intervalInput = document.querySelector("#interval");
const targetSizeInput = document.querySelector("#target-size");
const startButton = document.querySelector("#start-button");
const resetButton = document.querySelector("#reset-button");
const clearRecordsButton = document.querySelector("#clear-records");
const gameArea = document.querySelector("#game-area");
const gameStatus = document.querySelector("#game-status");
const scoreEl = document.querySelector("#score");
const timeLeftEl = document.querySelector("#time-left");
const spawnCountEl = document.querySelector("#spawn-count");
const accuracyEl = document.querySelector("#accuracy");
const recordsList = document.querySelector("#records-list");

const state = {
  isRunning: false,
  score: 0,
  spawns: 0,
  durationMs: 60000,
  intervalMs: 800,
  targetSize: 42,
  startedAt: 0,
  endsAt: 0,
  spawnTimerId: null,
  clockTimerId: null,
  activeTarget: null,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSettings() {
  return {
    durationMs: clamp(Number(durationInput.value) || 60, 5, 300) * 1000,
    intervalMs: clamp(Number(intervalInput.value) || 800, 150, 5000),
    targetSize: clamp(Number(targetSizeInput.value) || 42, 12, 120),
  };
}

function applySettingsToInputs(settings) {
  durationInput.value = String(settings.durationMs / 1000);
  intervalInput.value = String(settings.intervalMs);
  targetSizeInput.value = String(settings.targetSize);
}

function updateHud() {
  const timeLeftMs = state.isRunning ? Math.max(0, state.endsAt - performance.now()) : state.durationMs;
  const accuracy = state.spawns === 0 ? 0 : Math.round((state.score / state.spawns) * 100);

  scoreEl.textContent = String(state.score);
  timeLeftEl.textContent = `${(timeLeftMs / 1000).toFixed(1)}s`;
  spawnCountEl.textContent = String(state.spawns);
  accuracyEl.textContent = `${accuracy}%`;
}

function setSettingsEnabled(isEnabled) {
  durationInput.disabled = !isEnabled;
  intervalInput.disabled = !isEnabled;
  targetSizeInput.disabled = !isEnabled;
  startButton.disabled = !isEnabled;
}

function removeTarget() {
  if (state.activeTarget) {
    state.activeTarget.remove();
    state.activeTarget = null;
  }
}

function spawnTarget() {
  if (!state.isRunning) {
    return;
  }

  if (performance.now() >= state.endsAt) {
    endGame(true);
    return;
  }

  removeTarget();

  const rect = gameArea.getBoundingClientRect();
  const radius = state.targetSize / 2;
  const x = Math.random() * Math.max(0, rect.width - state.targetSize) + radius;
  const y = Math.random() * Math.max(0, rect.height - state.targetSize) + radius;
  const target = document.createElement("button");

  target.type = "button";
  target.className = "target";
  target.style.width = `${state.targetSize}px`;
  target.style.height = `${state.targetSize}px`;
  target.style.left = `${x}px`;
  target.style.top = `${y}px`;
  target.setAttribute("aria-label", "点击目标");

  target.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!state.isRunning || target !== state.activeTarget) {
      return;
    }

    state.score += 1;
    removeTarget();
    updateHud();
  });

  gameArea.append(target);
  state.activeTarget = target;
  state.spawns += 1;
  updateHud();
}

function scheduleNextTarget() {
  window.clearTimeout(state.spawnTimerId);

  if (!state.isRunning) {
    return;
  }

  state.spawnTimerId = window.setTimeout(() => {
    if (!state.isRunning) {
      return;
    }

    spawnTarget();

    if (state.isRunning) {
      scheduleNextTarget();
    }
  }, state.intervalMs);
}

function readRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function writeRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 10)));
}

function renderRecords() {
  const records = readRecords();
  recordsList.innerHTML = "";

  if (records.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-records";
    empty.textContent = "还没有记录，开始第一局吧。";
    recordsList.append(empty);
    return;
  }

  records.forEach((record, index) => {
    const item = document.createElement("li");
    const scoreRow = document.createElement("span");
    const scoreText = document.createElement("span");
    const accuracyText = document.createElement("span");
    const meta = document.createElement("span");
    const accuracy = record.spawns === 0 ? 0 : Math.round((record.score / record.spawns) * 100);
    const date = new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(record.createdAt));

    scoreRow.className = "record-score";
    scoreText.textContent = `#${index + 1} ${record.score} 分`;
    accuracyText.textContent = `${accuracy}%`;
    meta.className = "record-meta";
    meta.textContent = `${date} · ${record.durationSeconds}s · ${record.intervalMs}ms · ${record.targetSize}px`;

    scoreRow.append(scoreText, accuracyText);
    item.append(scoreRow, meta);
    recordsList.append(item);
  });
}

function saveRecord() {
  const newRecord = {
    score: state.score,
    spawns: state.spawns,
    durationSeconds: state.durationMs / 1000,
    intervalMs: state.intervalMs,
    targetSize: state.targetSize,
    createdAt: new Date().toISOString(),
  };
  const records = readRecords();

  records.push(newRecord);
  records.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  writeRecords(records);
  renderRecords();
}

function endGame(shouldSave = true) {
  if (!state.isRunning) {
    return;
  }

  state.isRunning = false;
  window.clearTimeout(state.spawnTimerId);
  window.clearInterval(state.clockTimerId);
  removeTarget();
  setSettingsEnabled(true);
  updateHud();

  if (shouldSave) {
    saveRecord();
    gameStatus.textContent = `训练结束：${state.score} 分，命中率 ${accuracyEl.textContent}`;
  } else {
    gameStatus.textContent = "训练已重置";
  }
}

function startGame(event) {
  event.preventDefault();

  const settings = getSettings();
  applySettingsToInputs(settings);

  state.durationMs = settings.durationMs;
  state.intervalMs = settings.intervalMs;
  state.targetSize = settings.targetSize;
  state.score = 0;
  state.spawns = 0;
  state.startedAt = performance.now();
  state.endsAt = state.startedAt + state.durationMs;
  state.isRunning = true;

  removeTarget();
  setSettingsEnabled(false);
  gameArea.focus();
  gameStatus.textContent = "训练中：点中目标即可得分";
  updateHud();

  spawnTarget();
  scheduleNextTarget();

  state.clockTimerId = window.setInterval(() => {
    if (performance.now() >= state.endsAt) {
      endGame(true);
      return;
    }
    updateHud();
  }, 100);
}

function resetGame() {
  if (state.isRunning) {
    endGame(false);
  }

  state.score = 0;
  state.spawns = 0;
  state.durationMs = getSettings().durationMs;
  removeTarget();
  updateHud();
}

form.addEventListener("submit", startGame);
resetButton.addEventListener("click", resetGame);
clearRecordsButton.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  renderRecords();
});

durationInput.addEventListener("input", () => {
  if (!state.isRunning) {
    state.durationMs = getSettings().durationMs;
    updateHud();
  }
});

renderRecords();
updateHud();
