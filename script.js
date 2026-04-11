const STORAGE_KEY = "delta-aim-trainer-records";
const DEFAULT_TARGET_SIZE = 42;
const DEFAULT_UI_SIZE = "small";

const app = document.querySelector(".app");
const form = document.querySelector("#settings-form");
const durationInput = document.querySelector("#duration");
const intervalInput = document.querySelector("#interval");
const uiSizeInput = document.querySelector("#ui-size");
const optionGroups = [...document.querySelectorAll(".option-group")];
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

const DURATION_PRESETS = {
  "60": { label: "60s", value: 60000 },
  "120": { label: "120s", value: 120000 },
};

const INTERVAL_PRESETS = {
  slow: { label: "慢", value: 1100 },
  medium: { label: "中", value: 800 },
  fast: { label: "快", value: 550 },
};

const UI_SIZE_PRESETS = {
  small: { label: "小界面" },
  medium: { label: "中界面" },
  large: { label: "大界面" },
};

const TARGET_SCORE_ZONES = [
  { maxRatio: 0.18, points: 3 },
  { maxRatio: 0.5, points: 2 },
  { maxRatio: 1, points: 1 },
];

const state = {
  isRunning: false,
  score: 0,
  hits: 0,
  spawns: 0,
  durationMs: 60000,
  intervalMs: 800,
  targetSize: DEFAULT_TARGET_SIZE,
  uiSize: DEFAULT_UI_SIZE,
  startedAt: 0,
  endsAt: 0,
  spawnTimerId: null,
  clockTimerId: null,
  activeTarget: null,
};

function getPresetFromInput(input, presets, fallbackKey) {
  return presets[input.value] ? input.value : fallbackKey;
}

function findPresetKeyByValue(presets, value, fallbackKey) {
  const match = Object.entries(presets).find(([, preset]) => preset.value === value);
  return match ? match[0] : fallbackKey;
}

function formatDurationLabel(durationSeconds) {
  const preset = DURATION_PRESETS[String(durationSeconds)];
  return preset ? preset.label : `${durationSeconds}s`;
}

function formatIntervalLabel(intervalMs) {
  const presetKey = findPresetKeyByValue(INTERVAL_PRESETS, intervalMs, "");
  return presetKey ? INTERVAL_PRESETS[presetKey].label : `${intervalMs}ms`;
}

function formatUiSizeLabel(uiSizeKey) {
  const preset = UI_SIZE_PRESETS[uiSizeKey];
  return preset ? preset.label : UI_SIZE_PRESETS[DEFAULT_UI_SIZE].label;
}

function applyUiSizePreset(uiSizeKey) {
  const resolvedKey = UI_SIZE_PRESETS[uiSizeKey] ? uiSizeKey : DEFAULT_UI_SIZE;

  if (app) {
    app.dataset.uiSize = resolvedKey;
  }

  return resolvedKey;
}

function syncOptionGroup(group, value) {
  if (!group) {
    return;
  }

  group.querySelectorAll(".option-button").forEach((button) => {
    const isActive = button.dataset.value === value;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function syncAllOptionGroups() {
  optionGroups.forEach((group) => {
    const targetInput = document.querySelector(`#${group.dataset.target}`);
    syncOptionGroup(group, targetInput ? targetInput.value : "");
  });
}

function getSettings() {
  const durationKey = getPresetFromInput(durationInput, DURATION_PRESETS, "60");
  const intervalKey = getPresetFromInput(intervalInput, INTERVAL_PRESETS, "medium");
  const uiSizeKey = getPresetFromInput(uiSizeInput, UI_SIZE_PRESETS, DEFAULT_UI_SIZE);

  return {
    durationMs: DURATION_PRESETS[durationKey].value,
    intervalMs: INTERVAL_PRESETS[intervalKey].value,
    targetSize: DEFAULT_TARGET_SIZE,
    uiSize: uiSizeKey,
  };
}

function applySettingsToInputs(settings) {
  durationInput.value = findPresetKeyByValue(DURATION_PRESETS, settings.durationMs, "60");
  intervalInput.value = findPresetKeyByValue(INTERVAL_PRESETS, settings.intervalMs, "medium");
  uiSizeInput.value = UI_SIZE_PRESETS[settings.uiSize] ? settings.uiSize : DEFAULT_UI_SIZE;
  syncAllOptionGroups();
  state.uiSize = applyUiSizePreset(uiSizeInput.value);
}

function updateHud() {
  const timeLeftMs = state.isRunning ? Math.max(0, state.endsAt - performance.now()) : state.durationMs;
  const accuracy = state.spawns === 0 ? 0 : Math.round((state.hits / state.spawns) * 100);

  scoreEl.textContent = String(state.score);
  timeLeftEl.textContent = `${(timeLeftMs / 1000).toFixed(1)}s`;
  spawnCountEl.textContent = String(state.spawns);
  accuracyEl.textContent = `${accuracy}%`;
}

function setSettingsEnabled(isEnabled) {
  durationInput.disabled = !isEnabled;
  intervalInput.disabled = !isEnabled;
  uiSizeInput.disabled = !isEnabled;
  optionGroups.forEach((group) => {
    group.querySelectorAll(".option-button").forEach((button) => {
      button.disabled = !isEnabled;
    });
  });
  startButton.disabled = !isEnabled;
}

function removeTarget() {
  if (state.activeTarget) {
    state.activeTarget.remove();
    state.activeTarget = null;
  }
}

function getHitPoints(target, event) {
  const rect = target.getBoundingClientRect();
  const radius = rect.width / 2;
  const centerX = rect.left + radius;
  const centerY = rect.top + radius;
  const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
  const hitRatio = radius === 0 ? 0 : distance / radius;
  const zone = TARGET_SCORE_ZONES.find(({ maxRatio }) => hitRatio <= maxRatio);

  return zone ? zone.points : 0;
}

function showScorePopup(points, event) {
  const areaRect = gameArea.getBoundingClientRect();
  const popup = document.createElement("span");
  const x = Math.min(Math.max(event.clientX - areaRect.left, 24), areaRect.width - 24);
  const y = Math.min(Math.max(event.clientY - areaRect.top - 12, 24), areaRect.height - 24);

  popup.className = "score-popup";
  popup.textContent = `+${points}`;
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
  popup.setAttribute("aria-hidden", "true");
  popup.addEventListener(
    "animationend",
    () => {
      popup.remove();
    },
    { once: true },
  );
  gameArea.append(popup);
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

    const points = getHitPoints(target, event);

    if (points === 0) {
      return;
    }

    state.score += points;
    state.hits += 1;
    showScorePopup(points, event);
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
    const hits = record.hits ?? record.score;
    const accuracy = record.spawns === 0 ? 0 : Math.round((hits / record.spawns) * 100);
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
    meta.textContent = `${date} · ${formatDurationLabel(record.durationSeconds)} · ${formatIntervalLabel(record.intervalMs)} · ${formatUiSizeLabel(record.uiSize ?? DEFAULT_UI_SIZE)}`;

    scoreRow.append(scoreText, accuracyText);
    item.append(scoreRow, meta);
    recordsList.append(item);
  });
}

function saveRecord() {
  const newRecord = {
    score: state.score,
    hits: state.hits,
    spawns: state.spawns,
    durationSeconds: state.durationMs / 1000,
    intervalMs: state.intervalMs,
    uiSize: state.uiSize,
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
    gameStatus.textContent = `训练结束，${state.score} 分，命中率 ${accuracyEl.textContent}`;
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
  state.uiSize = settings.uiSize;
  state.score = 0;
  state.hits = 0;
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

  const settings = getSettings();
  state.score = 0;
  state.hits = 0;
  state.spawns = 0;
  state.durationMs = settings.durationMs;
  state.intervalMs = settings.intervalMs;
  state.targetSize = settings.targetSize;
  state.uiSize = settings.uiSize;
  removeTarget();
  updateHud();
}

form.addEventListener("submit", startGame);
resetButton.addEventListener("click", resetGame);
clearRecordsButton.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  renderRecords();
});

optionGroups.forEach((group) => {
  group.addEventListener("click", (event) => {
    const button = event.target.closest(".option-button");
    const targetInput = document.querySelector(`#${group.dataset.target}`);

    if (!button || !targetInput || button.disabled) {
      return;
    }

    if (targetInput.value === button.dataset.value) {
      return;
    }

    targetInput.value = button.dataset.value;
    syncOptionGroup(group, targetInput.value);
    targetInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
});

durationInput.addEventListener("change", () => {
  if (!state.isRunning) {
    state.durationMs = getSettings().durationMs;
    updateHud();
  }
});

uiSizeInput.addEventListener("change", () => {
  if (!state.isRunning) {
    state.uiSize = getSettings().uiSize;
    applyUiSizePreset(state.uiSize);
  }
});

applySettingsToInputs({
  durationMs: state.durationMs,
  intervalMs: state.intervalMs,
  targetSize: state.targetSize,
  uiSize: state.uiSize,
});
renderRecords();
updateHud();
