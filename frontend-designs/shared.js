const state = { running: false, activeFile: "Game1.cs", activePanel: "output" };

function updateState(next) {
  Object.assign(state, next);
  document.body.dataset.running = String(state.running);
  document.querySelectorAll("[data-run]").forEach((el) => el.disabled = state.running);
  document.querySelectorAll("[data-stop]").forEach((el) => el.disabled = !state.running);
  document.querySelectorAll("[data-status]").forEach((el) => {
    el.textContent = state.running ? "RUNNING" : "STOPPED";
  });
  document.querySelectorAll("[data-preview-label]").forEach((el) => {
    el.textContent = state.running ? "GAME LOOP ACTIVE" : "PRESS RUN TO START";
  });
}

function log(message, kind = "info") {
  document.querySelectorAll("[data-log]").forEach((el) => {
    const row = document.createElement("div");
    row.className = `log-row ${kind}`;
    row.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour12: false })}</time><span>${message}</span>`;
    el.append(row);
    el.scrollTop = el.scrollHeight;
  });
}

function run() {
  if (state.running) return;
  document.body.dataset.phase = "compiling";
  document.querySelectorAll("[data-status]").forEach((el) => el.textContent = "COMPILING");
  log("Compiler: emitting Playground.Game.dll + portable PDB");
  window.setTimeout(() => {
    document.body.dataset.phase = "ready";
    updateState({ running: true });
    log("Preview: Game1 started · WebGL2 · 800×480", "success");
  }, 650);
}

function stop() {
  if (!state.running) return;
  document.body.dataset.phase = "stopping";
  document.querySelectorAll("[data-status]").forEach((el) => el.textContent = "STOPPING");
  window.setTimeout(() => {
    document.body.dataset.phase = "ready";
    updateState({ running: false });
    log("Preview: cooperative stop complete · resources released");
  }, 350);
}

function bind() {
  document.querySelectorAll("[data-run]").forEach((el) => el.addEventListener("click", run));
  document.querySelectorAll("[data-stop]").forEach((el) => el.addEventListener("click", stop));

  document.querySelectorAll("[data-file]").forEach((el) => el.addEventListener("click", () => {
    state.activeFile = el.dataset.file;
    document.querySelectorAll("[data-file]").forEach((item) => item.classList.toggle("active", item === el));
    document.querySelectorAll("[data-file-name]").forEach((item) => item.textContent = state.activeFile);
    log(`Editor: opened ${state.activeFile}`);
  }));

  document.querySelectorAll("[data-panel]").forEach((el) => el.addEventListener("click", () => {
    state.activePanel = el.dataset.panel;
    document.querySelectorAll("[data-panel]").forEach((item) => item.classList.toggle("active", item === el));
    document.querySelectorAll("[data-panel-view]").forEach((item) => item.hidden = item.dataset.panelView !== state.activePanel);
  }));

  document.querySelectorAll("[data-diagnostic]").forEach((el) => el.addEventListener("click", () => {
    document.querySelectorAll("[data-code-line]").forEach((line) => line.classList.toggle("selected", line.dataset.codeLine === "18"));
    log("Problems: navigated to Game1.cs:18:29");
  }));

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      run();
    }
    if (event.key === "Escape") stop();
  });

  updateState(state);
}

document.addEventListener("DOMContentLoaded", bind);
