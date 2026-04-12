const STORAGE_KEY = "delta-aim-trainer-records";
const RECORDS_FILE_NAME = `${STORAGE_KEY}.json`;
const RECORDS_SCHEMA_VERSION = 1;
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
const recentRecordsList = document.querySelector("#recent-records-list");

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

const recordsState = {
  cache: [],
  loadPromise: null,
  queue: Promise.resolve([]),
  storageBackend: "localStorage",
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

function createRecordId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `record-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function compareRecords(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  return new Date(b.createdAt) - new Date(a.createdAt);
}

function compareRecordsByNewest(a, b) {
  return new Date(b.createdAt) - new Date(a.createdAt);
}

function normalizeIsoDate(value) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeNonNegativeNumber(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : fallback;
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const createdAt = normalizeIsoDate(record.createdAt) || new Date().toISOString();
  const score = Math.round(normalizeNonNegativeNumber(record.score, 0));
  const hitsFallback = typeof record.hits === "undefined" ? score : 0;
  const hits = Math.round(normalizeNonNegativeNumber(record.hits, hitsFallback));
  const spawns = Math.round(normalizeNonNegativeNumber(record.spawns, 0));
  const durationSeconds = Math.round(
    normalizeNonNegativeNumber(record.durationSeconds, normalizeNonNegativeNumber(record.durationMs, 60000) / 1000),
  );
  const intervalMs = Math.round(normalizeNonNegativeNumber(record.intervalMs, 800));
  const uiSize = UI_SIZE_PRESETS[record.uiSize] ? record.uiSize : DEFAULT_UI_SIZE;

  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : createRecordId(),
    score,
    hits,
    spawns,
    durationSeconds,
    intervalMs,
    uiSize,
    createdAt,
  };
}

function getRecordSignature(record) {
  return [
    record.score,
    record.hits,
    record.spawns,
    record.durationSeconds,
    record.intervalMs,
    record.uiSize,
    record.createdAt,
  ].join("|");
}

function sortAndDedupeRecords(records) {
  const seen = new Set();

  return records
    .map(normalizeRecord)
    .filter((record) => record !== null)
    .sort(compareRecords)
    .filter((record) => {
      const signature = getRecordSignature(record);

      if (seen.has(signature)) {
        return false;
      }

      seen.add(signature);
      return true;
    });
}

function normalizeRecordsPayload(payload) {
  if (Array.isArray(payload)) {
    return sortAndDedupeRecords(payload);
  }

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.records)) {
    return [];
  }

  return sortAndDedupeRecords(payload.records);
}

function serializeRecordsPayload(records) {
  return JSON.stringify(
    {
      version: RECORDS_SCHEMA_VERSION,
      records: sortAndDedupeRecords(records),
    },
    null,
    2,
  );
}

function readLegacyRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return normalizeRecordsPayload(records);
  } catch {
    return [];
  }
}

function writeLegacyRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sortAndDedupeRecords(records)));
}

function clearLegacyRecords() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore cleanup failures after the source of truth has moved elsewhere.
  }
}

async function getRecordsFileHandle() {
  if (!navigator.storage || typeof navigator.storage.getDirectory !== "function") {
    return null;
  }

  try {
    const rootDirectory = await navigator.storage.getDirectory();
    return rootDirectory.getFileHandle(RECORDS_FILE_NAME, { create: true });
  } catch {
    return null;
  }
}

async function requestPersistentStorage() {
  if (!navigator.storage || typeof navigator.storage.persist !== "function") {
    return;
  }

  try {
    await navigator.storage.persist();
  } catch {
    // Ignore best-effort persistence failures and keep the app usable.
  }
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

async function readRecordsFromFile() {
  const fileHandle = await getRecordsFileHandle();

  if (!fileHandle) {
    return null;
  }

  try {
    const file = await fileHandle.getFile();
    const content = await file.text();

    recordsState.storageBackend = "opfs";

    if (!content.trim()) {
      return [];
    }

    return normalizeRecordsPayload(JSON.parse(content));
  } catch {
    return null;
  }
}

async function loadRecords() {
  if (recordsState.loadPromise) {
    return recordsState.loadPromise;
  }

  recordsState.loadPromise = (async () => {
    await requestPersistentStorage();

    const fileRecords = await readRecordsFromFile();
    const legacyRecords = readLegacyRecords();

    if (fileRecords !== null && fileRecords.length > 0) {
      const mergedRecords = sortAndDedupeRecords([...fileRecords, ...legacyRecords]);

      recordsState.cache = mergedRecords;

      if (legacyRecords.length > 0 || mergedRecords.length !== fileRecords.length) {
        await writeRecords(mergedRecords);
      }

      return [...recordsState.cache];
    }

    recordsState.cache = legacyRecords;
    recordsState.storageBackend = "localStorage";
    return [...recordsState.cache];
  })();

  return recordsState.loadPromise;
}

async function readRecords() {
  if (!recordsState.loadPromise) {
    await loadRecords();
  }

  return [...recordsState.cache];
}

async function writeRecords(records) {
  const nextRecords = sortAndDedupeRecords(records);
  const fileHandle = await getRecordsFileHandle();

  if (fileHandle) {
    try {
      const writable = await fileHandle.createWritable();
      await writable.write(serializeRecordsPayload(nextRecords));
      await writable.close();
      recordsState.cache = nextRecords;
      recordsState.storageBackend = "opfs";
      clearLegacyRecords();
      return [...recordsState.cache];
    } catch {
      // Fall through to localStorage below.
    }
  }

  writeLegacyRecords(nextRecords);
  recordsState.cache = nextRecords;
  recordsState.storageBackend = "localStorage";
  return [...recordsState.cache];
}

function enqueueRecordMutation(mutateRecords) {
  const runMutation = async () => {
    const currentRecords = await readRecords();
    return writeRecords(mutateRecords([...currentRecords]));
  };

  recordsState.queue = recordsState.queue.then(runMutation, runMutation);
  return recordsState.queue;
}

function renderEmptyRecordsState(list, message) {
  const empty = document.createElement("li");

  empty.className = "empty-records";
  empty.textContent = message;
  list.append(empty);
}

function createRecordListItem(record) {
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
  scoreText.textContent = `${record.score} 分`;
  accuracyText.textContent = `${accuracy}%`;
  meta.className = "record-meta";
  meta.textContent = `${date} · ${formatDurationLabel(record.durationSeconds)} · ${formatIntervalLabel(record.intervalMs)} · ${formatUiSizeLabel(record.uiSize ?? DEFAULT_UI_SIZE)}`;

  scoreRow.append(scoreText, accuracyText);
  item.append(scoreRow, meta);
  return item;
}

async function renderRecords() {
  const records = await readRecords();
  const recentRecords = [...records].sort(compareRecordsByNewest).slice(0, 10);

  recentRecordsList.innerHTML = "";

  if (recentRecords.length === 0) {
    renderEmptyRecordsState(recentRecordsList, "还没有记录，开始第一局吧。");
    return;
  }

  recentRecords.forEach((record) => {
    recentRecordsList.append(createRecordListItem(record));
  });
}

async function saveRecord() {
  const newRecord = {
    id: createRecordId(),
    score: state.score,
    hits: state.hits,
    spawns: state.spawns,
    durationSeconds: state.durationMs / 1000,
    intervalMs: state.intervalMs,
    uiSize: state.uiSize,
    createdAt: new Date().toISOString(),
  };

  await enqueueRecordMutation((records) => {
    records.push(newRecord);
    return records;
  });
  await renderRecords();
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
    const statusText = `训练结束，${state.score} 分，命中率 ${accuracyEl.textContent}`;
    gameStatus.textContent = statusText;
    void saveRecord().catch(() => {
      gameStatus.textContent = `${statusText}，成绩保存失败`;
    });
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
  void enqueueRecordMutation(() => []).then(() => {
    void renderRecords();
    gameStatus.textContent = "成绩记录已清空";
  });
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
void loadRecords().then(() => {
  void renderRecords();
});
updateHud();
