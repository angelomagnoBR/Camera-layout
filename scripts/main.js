/**
 * Camera Layout Manager
 * Foundry VTT v13 — Módulo para destacar câmeras A/V em janelas livres
 * e salvar/sincronizar layouts entre jogadores.
 */

const MODULE_ID = "camera-layout";
const SOCKET_EVENT = `module.${MODULE_ID}`;
const SETTING_LAYOUTS = "savedLayouts";

// ─────────────────────────────────────────────────────────────
// Registro de configurações
// ─────────────────────────────────────────────────────────────
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_LAYOUTS, {
    name: "Layouts salvos",
    scope: "world",          // salvo no servidor, visível a todos
    config: false,
    type: Object,
    default: {},
  });
});

// ─────────────────────────────────────────────────────────────
// Socket — sincronização entre clientes
// ─────────────────────────────────────────────────────────────
Hooks.once("ready", () => {
  game.socket.on(SOCKET_EVENT, (data) => {
    if (data.action === "applyLayout") {
      CameraLayoutManager.applyLayout(data.layout, false);
    }
  });

  // Injeta os botões de controle na barra A/V
  CameraLayoutManager.injectControls();
});

// ─────────────────────────────────────────────────────────────
// Utilitários
// ─────────────────────────────────────────────────────────────
function getSavedLayouts() {
  return game.settings.get(MODULE_ID, SETTING_LAYOUTS) ?? {};
}

async function saveLayouts(layouts) {
  await game.settings.set(MODULE_ID, SETTING_LAYOUTS, layouts);
}

function localize(key) {
  return game.i18n.localize(`CAMERA_LAYOUT.${key}`);
}

// ─────────────────────────────────────────────────────────────
// Classe principal
// ─────────────────────────────────────────────────────────────
class CameraLayoutManager {

  /** Mapa de janelas flutuantes abertas: userId → elemento DOM */
  static _windows = new Map();
  static _detached = false;

  // ── Injeção de controles na sidebar A/V ──────────────────
  static injectControls() {
    // Aguarda o elemento A/V aparecer no DOM
    const tryInject = () => {
      const avSection =
        document.querySelector("#av-dock") ??
        document.querySelector("#camera-views") ??
        document.querySelector(".camera-views");

      if (!avSection) {
        // Tenta novamente após renderização
        Hooks.once("renderCameraViews", () => this.injectControls());
        return;
      }

      if (document.querySelector("#camera-layout-controls")) return;

      const bar = document.createElement("div");
      bar.id = "camera-layout-controls";

      const btnDetach = document.createElement("button");
      btnDetach.id = "clm-btn-detach";
      btnDetach.textContent = localize("DetachCameras");
      btnDetach.title = localize("DetachCameras");
      btnDetach.addEventListener("click", () => this.toggleDetach());

      const btnManage = document.createElement("button");
      btnManage.textContent = localize("ManageLayouts");
      btnManage.title = localize("ManageLayouts");
      btnManage.addEventListener("click", () => new LayoutManagerDialog().render(true));

      bar.appendChild(btnDetach);
      bar.appendChild(btnManage);
      avSection.appendChild(bar);
    };

    tryInject();
  }

  // ── Alternar modo destacado ───────────────────────────────
  static toggleDetach() {
    if (this._detached) {
      this.attachAll();
    } else {
      this.detachAll();
    }
  }

  static detachAll() {
    const cameras = this._getCameraElements();
    if (!cameras.length) {
      ui.notifications.warn(localize("NoCamerasFound"));
      return;
    }

    cameras.forEach(({ userId, el, name }) => {
      this._createFloatingWindow(userId, el, name);
    });

    this._detached = true;
    this._updateDetachButton();
  }

  static attachAll() {
    this._windows.forEach((win) => win.remove());
    this._windows.clear();
    this._detached = false;
    this._updateDetachButton();
  }

  static _updateDetachButton() {
    const btn = document.querySelector("#clm-btn-detach");
    if (!btn) return;
    if (this._detached) {
      btn.textContent = localize("AttachCameras");
      btn.classList.add("active");
    } else {
      btn.textContent = localize("DetachCameras");
      btn.classList.remove("active");
    }
  }

  // ── Obter elementos de câmera do DOM ─────────────────────
  static _getCameraElements() {
    const results = [];

    // Foundry v13 usa <camera-view> como custom element ou .camera-view
    const views = document.querySelectorAll(
      "camera-view, .camera-view, .av-camera, [data-user]"
    );

    views.forEach((el) => {
      const userId =
        el.dataset.user ??
        el.getAttribute("data-user") ??
        el.id?.replace("camera-view-", "");

      if (!userId) return;

      const user = game.users.get(userId);
      if (!user) return;

      // Clona o vídeo/avatar para não quebrar o original
      const media =
        el.querySelector("video") ??
        el.querySelector("img.avatar") ??
        el.querySelector("img");

      results.push({ userId, el, name: user.name, media });
    });

    return results;
  }

  // ── Criar janela flutuante ────────────────────────────────
  static _createFloatingWindow(userId, sourceEl, name, pos = null) {
    // Remove janela anterior se existir
    if (this._windows.has(userId)) {
      this._windows.get(userId).remove();
    }

    const win = document.createElement("div");
    win.classList.add("camera-layout-window");
    win.dataset.userId = userId;

    // Posição inicial: cascata simples ou posição salva
    const defaultPos = {
      left: 20 + this._windows.size * 20,
      top: 20 + this._windows.size * 20,
      width: 200,
      height: 150,
    };
    const p = pos ?? defaultPos;

    win.style.left   = `${p.left}px`;
    win.style.top    = `${p.top}px`;
    win.style.width  = `${p.width}px`;
    win.style.height = `${p.height}px`;

    // Barra de título
    const titlebar = document.createElement("div");
    titlebar.classList.add("cam-titlebar");

    const nameSpan = document.createElement("span");
    nameSpan.classList.add("cam-name");
    nameSpan.textContent = name;

    const closeBtn = document.createElement("button");
    closeBtn.classList.add("cam-close");
    closeBtn.innerHTML = "✕";
    closeBtn.title = "Reencaixar esta câmera";
    closeBtn.addEventListener("click", () => {
      win.remove();
      this._windows.delete(userId);
      if (this._windows.size === 0) {
        this._detached = false;
        this._updateDetachButton();
      }
    });

    titlebar.appendChild(nameSpan);
    titlebar.appendChild(closeBtn);

    // Corpo — clona o conteúdo de mídia
    const body = document.createElement("div");
    body.classList.add("cam-body");

    const media =
      sourceEl.querySelector("video") ??
      sourceEl.querySelector("img");

    if (media) {
      const clone = media.cloneNode(true);

      // Para vídeo, conecta ao mesmo srcObject para stream ao vivo
      if (media.tagName === "VIDEO" && media.srcObject) {
        clone.srcObject = media.srcObject;
        clone.autoplay = true;
        clone.muted = true;
        clone.play().catch(() => {});
      }

      body.appendChild(clone);

      // Atualiza clone quando o stream original mudar
      if (media.tagName === "VIDEO") {
        const observer = new MutationObserver(() => {
          if (media.srcObject && clone.srcObject !== media.srcObject) {
            clone.srcObject = media.srcObject;
            clone.play().catch(() => {});
          }
        });
        observer.observe(media, { attributes: true, attributeFilter: ["src"] });
      }
    } else {
      // Fallback: avatar de texto
      const fallback = document.createElement("div");
      fallback.style.cssText =
        "display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:12px;";
      fallback.textContent = name[0].toUpperCase();
      body.appendChild(fallback);
    }

    // Alça de redimensionamento
    const resizeHandle = document.createElement("div");
    resizeHandle.classList.add("cam-resize");

    win.appendChild(titlebar);
    win.appendChild(body);
    win.appendChild(resizeHandle);
    document.body.appendChild(win);

    // Drag
    this._makeDraggable(win, titlebar);
    // Resize
    this._makeResizable(win, resizeHandle);

    this._windows.set(userId, win);
    return win;
  }

  // ── Arrastar ─────────────────────────────────────────────
  static _makeDraggable(win, handle) {
    let startX, startY, startLeft, startTop;

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startX    = e.clientX;
      startY    = e.clientY;
      startLeft = parseInt(win.style.left) || 0;
      startTop  = parseInt(win.style.top)  || 0;
      win.classList.add("dragging");

      const onMove = (ev) => {
        win.style.left = `${startLeft + ev.clientX - startX}px`;
        win.style.top  = `${startTop  + ev.clientY - startY}px`;
      };
      const onUp = () => {
        win.classList.remove("dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });
  }

  // ── Redimensionar ─────────────────────────────────────────
  static _makeResizable(win, handle) {
    let startX, startY, startW, startH;

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startY = e.clientY;
      startW = win.offsetWidth;
      startH = win.offsetHeight;

      const onMove = (ev) => {
        const w = Math.max(120, startW + ev.clientX - startX);
        const h = Math.max(90,  startH + ev.clientY - startY);
        win.style.width  = `${w}px`;
        win.style.height = `${h}px`;
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup",   onUp);
    });
  }

  // ── Capturar layout atual ─────────────────────────────────
  static captureLayout() {
    const layout = {};
    this._windows.forEach((win, userId) => {
      layout[userId] = {
        left:   parseInt(win.style.left)   || 0,
        top:    parseInt(win.style.top)    || 0,
        width:  win.offsetWidth,
        height: win.offsetHeight,
      };
    });
    return layout;
  }

  // ── Aplicar layout ────────────────────────────────────────
  static applyLayout(layout, emit = true) {
    // Garante que estamos no modo destacado
    if (!this._detached) this.detachAll();

    Object.entries(layout).forEach(([userId, pos]) => {
      const win = this._windows.get(userId);
      if (win) {
        win.style.left   = `${pos.left}px`;
        win.style.top    = `${pos.top}px`;
        win.style.width  = `${pos.width}px`;
        win.style.height = `${pos.height}px`;
      }
    });

    // Emite para outros clientes
    if (emit && game.user.isGM) {
      game.socket.emit(SOCKET_EVENT, { action: "applyLayout", layout });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Diálogo de gerenciamento de layouts
// ─────────────────────────────────────────────────────────────
class LayoutManagerDialog extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "camera-layout-manager",
      title: localize("Title"),
      template: null,    // usaremos conteúdo dinâmico
      width: 380,
      height: "auto",
      resizable: false,
    });
  }

  /** Substitui o template padrão por HTML gerado dinamicamente */
  async _renderInner(data) {
    const layouts = getSavedLayouts();
    const keys    = Object.keys(layouts);

    const html = document.createElement("div");
    html.id = "camera-layout-manager";

    // ── Lista de layouts salvos ──
    const list = document.createElement("ul");
    list.classList.add("layout-list");

    if (keys.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-msg";
      empty.textContent = localize("NoLayouts");
      list.appendChild(empty);
    } else {
      keys.forEach((name) => {
        const li = document.createElement("li");

        const nameEl = document.createElement("span");
        nameEl.classList.add("layout-name");
        nameEl.textContent = name;

        const btnLoad = document.createElement("button");
        btnLoad.textContent = localize("LoadLayout");
        btnLoad.addEventListener("click", async () => {
          const saved = getSavedLayouts();
          CameraLayoutManager.applyLayout(saved[name]);
          ui.notifications.info(
            game.i18n.format("CAMERA_LAYOUT.LoadedSuccess", { name })
          );
        });

        const btnSync = document.createElement("button");
        btnSync.textContent = localize("SyncLayout");
        btnSync.classList.add("btn-sync");
        btnSync.title = localize("SyncLayout");
        btnSync.disabled = !game.user.isGM;
        btnSync.addEventListener("click", async () => {
          const saved = getSavedLayouts();
          CameraLayoutManager.applyLayout(saved[name], true);
          ui.notifications.info(localize("SyncedSuccess"));
        });

        const btnDel = document.createElement("button");
        btnDel.textContent = "✕";
        btnDel.classList.add("btn-delete");
        btnDel.title = localize("DeleteLayout");
        btnDel.addEventListener("click", async () => {
          const confirmed = await Dialog.confirm({
            title: localize("DeleteLayout"),
            content: `<p>${game.i18n.format("CAMERA_LAYOUT.ConfirmDelete", { name })}</p>`,
          });
          if (!confirmed) return;
          const saved = getSavedLayouts();
          delete saved[name];
          await saveLayouts(saved);
          this.render(true);
        });

        li.appendChild(nameEl);
        li.appendChild(btnLoad);
        li.appendChild(btnSync);
        li.appendChild(btnDel);
        list.appendChild(li);
      });
    }

    // ── Campo para novo layout ──
    const newRow = document.createElement("div");
    newRow.classList.add("new-layout-row");

    const input = document.createElement("input");
    input.type        = "text";
    input.placeholder = localize("LayoutNamePlaceholder");
    input.maxLength   = 40;

    const btnSave = document.createElement("button");
    btnSave.textContent = localize("SaveLayout");
    btnSave.addEventListener("click", async () => {
      const name = input.value.trim();
      if (!name) {
        ui.notifications.warn(localize("ErrorNoName"));
        return;
      }
      const layout = CameraLayoutManager.captureLayout();
      const saved  = getSavedLayouts();
      saved[name]  = layout;
      await saveLayouts(saved);
      ui.notifications.info(
        game.i18n.format("CAMERA_LAYOUT.SavedSuccess", { name })
      );
      input.value = "";
      this.render(true);
    });

    // Salvar com Enter
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btnSave.click();
    });

    newRow.appendChild(input);
    newRow.appendChild(btnSave);

    html.appendChild(list);
    html.appendChild(newRow);

    // Envolve em jQuery para compatibilidade com o Application base
    return $(html);
  }
}

// Torna disponível globalmente para debug / macros
globalThis.CameraLayoutManager = CameraLayoutManager;
