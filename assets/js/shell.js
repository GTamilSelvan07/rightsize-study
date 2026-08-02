(() => {
  "use strict";

  const config = window.STUDY_CONFIG || {};
  const tour = window.TOUR;
  const params = new URLSearchParams(window.location.search);
  const pendingWaits = new Set();
  const logKeys = new Set([
    "story_opened",
    "story_role",
    "story_act1_choice1",
    "story_act1_choice2",
    "story_limits_set",
    "story_option",
    "story_meeting_reply1",
    "story_meeting_reply2",
    "story_meeting_completed",
    "story_edit_loop_seen",
    "story_notmine_seen",
    "story_completed",
    "story_seconds",
    "story_replay_clicked",
    "story_replay_role",
    "story_walkthrough_clicked",
  ]);

  const state = {
    role: "",
    flags: {},
    mode: "story",
    skipToggle: false,
    abortBeat: false,
    receipts: new Map(),
    startedAt: 0,
    visibleAt: 0,
    visibleMs: 0,
    completed: false,
    running: false,
    runId: 0,
    tourStep: 0,
    chapter: "BEFORE THE ROOM",
    call: null,
  };

  function readSavedId() {
    try {
      const saved = JSON.parse(window.localStorage.getItem("study.v1") || "{}");
      return typeof saved.rid === "string" && saved.rid ? saved.rid : "";
    } catch {
      return "";
    }
  }

  const rid = params.has("r") ? params.get("r") : readSavedId() || crypto.randomUUID();

  function logEvent(data) {
    Object.keys(data).forEach((key) => {
      if (!logKeys.has(key)) console.warn("Unknown story log key", key);
    });
    const payload = {
      token: config.FORM_TOKEN,
      rid,
      section: "story",
      seq: Date.now() % 100000,
      ua: navigator.userAgent,
      data,
    };

    if (config.SCRIPT_URL) {
      void fetch(config.SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify(payload),
      }).catch(() => undefined);
      return;
    }

    console.log(payload);
  }

  function prefersReduced() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches || state.skipToggle;
  }

  function wait(ms) {
    const delay = prefersReduced() || state.abortBeat ? 0 : Math.min(6000, Math.max(0, Number(ms) || 0));
    return new Promise((resolve) => {
      if (delay === 0) {
        resolve();
        return;
      }
      const entry = { timer: 0, resolve };
      entry.timer = window.setTimeout(() => {
        pendingWaits.delete(entry);
        resolve();
      }, delay);
      pendingWaits.add(entry);
    });
  }

  function fastForward() {
    state.skipToggle = true;
    state.abortBeat = true;
    pendingWaits.forEach((entry) => {
      window.clearTimeout(entry.timer);
      entry.resolve();
    });
    pendingWaits.clear();
    window.requestAnimationFrame(() => {
      state.skipToggle = false;
    });
  }

  function resetBeat() {
    state.abortBeat = false;
    state.skipToggle = false;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function enter(node) {
    node.classList.add("is-entering");
    window.requestAnimationFrame(() => node.classList.add("is-visible"));
    return node;
  }

  function append(container, node) {
    container.append(node);
    return enter(node);
  }

  function resolveText(value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
      const match = value.find((item) => matches(item.when));
      return match ? resolveText(match.text) : "";
    }
    if (value && typeof value === "object") return value[state.role] || "";
    return "";
  }

  function matches(condition) {
    if (!condition) return true;
    let result = true;
    if (condition.role) result = state.role === condition.role;
    if (condition.mode) result = result && state.mode === condition.mode;
    if (condition.flag) result = result && state.flags[condition.flag] === condition.is;
    return condition.not ? !result : result;
  }

  function resolveFrom(from) {
    if (from === "player") return state.role;
    if (from === "counterpart") return state.role === "alex" ? "rowan" : "alex";
    return from;
  }

  function visibleSeconds() {
    const now = performance.now();
    const running = document.visibilityState === "visible" ? now - state.visibleAt : 0;
    return Math.max(0, Math.round((state.visibleMs + running) / 1000));
  }

  function trackVisibility() {
    if (!state.startedAt) return;
    const now = performance.now();
    if (document.visibilityState === "hidden") {
      state.visibleMs += now - state.visibleAt;
      state.visibleAt = 0;
      return;
    }
    state.visibleAt = now;
  }

  async function animateCounter(target, from, to, prefix) {
    if (prefersReduced()) {
      target.textContent = `${prefix || ""}${to.toLocaleString("en-NZ")}`;
      return;
    }
    await new Promise((resolve) => {
      const start = performance.now();
      const duration = 900;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        target.textContent = `${prefix || ""}${to.toLocaleString("en-NZ")}`;
        resolve();
      };
      const frame = (now) => {
        if (done) return;
        if (prefersReduced() || state.abortBeat) {
          finish();
          return;
        }
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - ((1 - progress) ** 3);
        const current = Math.round(from + (to - from) * eased);
        target.textContent = `${prefix || ""}${current.toLocaleString("en-NZ")}`;
        if (progress < 1) {
          window.requestAnimationFrame(frame);
        } else {
          finish();
        }
      };
      window.requestAnimationFrame(frame);
      // rAF never fires in unfocused or occluded windows — guarantee resolution
      // so the story cannot hang for tab-switchers.
      setTimeout(finish, duration + 400);
    });
  }

  function callTimeSeconds(value) {
    if (typeof value === "string" && /^\d{2}:\d{2}$/.test(value)) {
      const [minutes, seconds] = value.split(":").map(Number);
      return (minutes * 60) + seconds;
    }
    return Math.max(0, Math.round(Number(value) || 0));
  }

  function formatCallTime(seconds) {
    const safeSeconds = callTimeSeconds(seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  async function animateCallTimer(target, from, to) {
    if (!target) return;
    const startValue = callTimeSeconds(from);
    const endValue = callTimeSeconds(to);
    if (startValue === endValue) {
      target.textContent = formatCallTime(endValue);
      return;
    }
    if (prefersReduced()) {
      target.textContent = formatCallTime(endValue);
      return;
    }
    await new Promise((resolve) => {
      const start = performance.now();
      const duration = 700;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        target.textContent = formatCallTime(endValue);
        resolve();
      };
      const frame = (now) => {
        if (done) return;
        if (prefersReduced() || state.abortBeat) {
          finish();
          return;
        }
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - ((1 - progress) ** 3);
        target.textContent = formatCallTime(startValue + ((endValue - startValue) * eased));
        if (progress < 1) window.requestAnimationFrame(frame);
        else finish();
      };
      window.requestAnimationFrame(frame);
      // Match animateCounter's guarantee: a hidden tab cannot strand the tour.
      setTimeout(finish, duration + 400);
    });
  }

  function warn(message) {
    console.warn(`Shell tour: ${message}`);
  }

  function query(selector, scope = document) {
    if (!selector || !scope || typeof scope.querySelector !== "function") return null;
    try {
      return scope.querySelector(selector);
    } catch {
      warn(`could not resolve selector ${selector}`);
      return null;
    }
  }

  function queryAll(selector, scope = document) {
    if (!selector || !scope || typeof scope.querySelectorAll !== "function") return [];
    try {
      return Array.from(scope.querySelectorAll(selector));
    } catch {
      warn(`could not resolve selector ${selector}`);
      return [];
    }
  }

  function focusSoon(target) {
    window.requestAnimationFrame(() => {
      if (target && target.isConnected && typeof target.focus === "function") target.focus({ preventScroll: true });
    });
  }

  function mainPane() {
    const main = document.getElementById("shell-main");
    if (!main) warn("#shell-main is missing; skipped main-pane content");
    return main;
  }

  function railPane(id) {
    const pane = document.getElementById(id);
    if (!pane) warn(`#${id} is missing; skipped rail content`);
    return pane;
  }

  function scrollMain() {
    const main = mainPane();
    if (main) main.scrollTop = main.scrollHeight;
  }

  function personFor(id) {
    return (tour && tour.cast && tour.cast[id]) || { name: "You", kind: "human" };
  }

  function avatarFor(person) {
    const avatar = element("span", "pane-msg-avatar");
    const img = document.createElement("img");
    img.src = person.portrait || "";
    img.alt = "";
    img.loading = "lazy";
    const fallback = element("span", "pane-msg-fallback", (person.name || "?").slice(0, 1));
    fallback.hidden = true;
    img.addEventListener("error", () => {
      img.hidden = true;
      fallback.hidden = false;
    }, { once: true });
    avatar.append(img, fallback);
    return avatar;
  }

  function appendMessage(container, message) {
    if (!container || !message || !matches(message.if)) return null;
    const from = resolveFrom(message.from);
    const person = personFor(from);
    const isPlayer = Boolean(message.player) || from === state.role;
    const row = element("article", `pane-msg${isPlayer ? " is-player" : ""}`);
    row.append(avatarFor(person));
    const body = element("div", "pane-msg-body");
    const head = element("header", "pane-msg-head");
    head.append(element("b", "", person.name));
    if (isPlayer) head.append(element("span", "pane-msg-you", "you"));
    if (message.time) head.append(element("time", "", message.time));
    body.append(head, element("p", "", resolveText(message.text)));
    row.append(body);
    append(container, row);
    return row;
  }

  function appendThreadMessage(message) {
    const main = mainPane();
    if (!main) return null;
    let thread = query(".pane-thread:last-of-type", main);
    if (!thread) {
      thread = element("section", "pane-thread");
      append(main, thread);
    }
    const row = appendMessage(thread, message);
    scrollMain();
    return row;
  }

  function makeReceipt(data) {
    const receipt = element("section", `pane-artifact pane-receipt${data.variant === "pain" ? " is-pain" : ""}`);
    const heading = element("h2", "", data.version || data.title || "Version 1");
    heading.dataset.receiptTitle = "";
    const rows = element("dl", "pane-receipt-rows");
    rows.dataset.receiptRows = "";
    receipt.append(heading, rows);
    updateReceipt(receipt, data, data.version || data.title);
    return receipt;
  }

  function optionData() {
    const preview = (tour.steps || [])
      .flatMap((step) => step.mounts || [])
      .find((mount) => mount.kind === "preview" && mount.data);
    return preview ? preview.data : {};
  }

  function updateReceipt(receipt, data, version) {
    if (!receipt) return;
    const title = query("[data-receipt-title]", receipt);
    if (title) title.textContent = version || "Version 1";
    const rows = query("[data-receipt-rows]", receipt);
    if (!rows) return;
    rows.replaceChildren();
    const selected = optionData()[state.flags.option];
    const rowData = data.optionRows && selected
      ? [["Decision", selected.decision], ["Date", selected.date], ["Safety", selected.safety], ["Cost", selected.cost]]
      : data.rows || [];
    rowData.forEach(([label, value]) => {
      const row = element("div", "");
      row.append(element("dt", "", label), element("dd", "", value));
      rows.append(row);
    });
  }

  function renderThread(mount) {
    const main = mainPane();
    if (!main) return;
    const thread = element("section", "pane-thread");
    (mount.messages || []).forEach((message) => appendMessage(thread, message));
    if (mount.action) {
      const action = element("button", "pane-app-action", mount.action);
      action.type = "button";
      action.dataset.sortRequest = "";
      thread.append(action);
    }
    append(main, thread);
    scrollMain();
  }

  function renderReplyRow(mount) {
    const main = mainPane();
    if (!main) return;
    const options = mount.byRole ? mount.byRole[state.role] : mount.options;
    if (!Array.isArray(options) || options.length === 0) {
      warn("reply row had no options for the selected role");
      return;
    }
    const row = element("section", "pane-reply-row");
    row.dataset.choiceKey = mount.key || "";
    row.append(element("p", "", resolveText(mount.prompt)));
    const optionsWrap = element("div", "pane-reply-options");
    options.forEach((option) => {
      const button = element("button", "pane-reply", option.label);
      button.type = "button";
      button.dataset.choice = option.id;
      button.setAttribute("aria-pressed", "false");
      button.__tourOption = option;
      button.__tourKey = mount.key;
      optionsWrap.append(button);
    });
    row.append(optionsWrap);
    append(main, row);
    scrollMain();
  }

  function renderInvite(mount) {
    const main = mainPane();
    if (!main) return;
    const invite = element("section", "pane-artifact pane-invite");
    invite.append(element("span", "pane-invite-badge invite-label", "Meeting invitation"));
    invite.append(element("h2", "", mount.title));
    invite.append(element("p", "", "Tuesday · 10:00 – 11:00 am · video call"));
    const guests = element("div", "pane-invite-guests");
    const faces = element("div", "pane-invite-faces guest-stack");
    ["alex", "rowan", "sam", "priya", "casey"].forEach((id) => faces.append(avatarFor(personFor(id))));
    guests.append(faces, element("p", "", `${mount.people} guests · ${mount.minutes} minutes held on every calendar`));
    const actions = element("div", "pane-invite-actions invite-actions");
    ["Accept", "Maybe", "Decline"].forEach((label) => actions.append(element("span", "", label)));
    invite.append(guests, actions);
    append(main, invite);
    scrollMain();
  }

  function renderQuotes(mount) {
    const main = mainPane();
    if (!main) return;
    const quotes = element("section", "pane-artifact pane-quotes");
    (mount.items || []).forEach((item) => {
      const quote = element("blockquote", `is-${item.side}`, item.text);
      quotes.append(quote);
    });
    append(main, quotes);
    scrollMain();
  }

  async function renderTicker(mount) {
    const main = mainPane();
    if (!main) return;
    const ticker = element("section", "pane-artifact pane-ticker");
    const value = element("strong", "", `${mount.prefix || ""}${Number(mount.from || 0).toLocaleString("en-NZ")}`);
    ticker.append(element("span", "", mount.label), value);
    append(main, ticker);
    scrollMain();
    await animateCounter(value, mount.from, mount.to, mount.prefix);
  }

  async function renderAgents(mount) {
    const rail = railPane("rail-agents");
    if (!rail) return;
    rail.replaceChildren();
    for (const item of mount.items || []) {
      const person = personFor(item.id);
      const card = element("article", `rail-agent${item.complete ? " is-done" : ""}`);
      card.append(avatarFor(person));
      const body = element("div", "");
      body.append(element("strong", "", person.name), element("p", "", item.text), element("small", "", person.limit || ""));
      if (item.complete) body.append(element("span", "", "✓"));
      card.append(body);
      append(rail, card);
      await wait(260);
    }
  }

  function renderLimits(mount) {
    // The form lives front and center in the work pane; on confirm it docks
    // into the assistant rail as a compact locked summary (so the player is
    // never hunting for controls below the rail's fold).
    const main = mainPane();
    if (!main) return;
    const fields = mount.byRole && mount.byRole[state.role];
    if (!Array.isArray(fields) || fields.length === 0) {
      warn("limits had no fields for the selected role");
      return;
    }
    const card = element("section", "pane-artifact pane-limits");
    card.dataset.limitsCard = "";
    const head = element("header", "pane-limits-head");
    head.append(element("span", "pane-limits-lock", "🔒"), element("h3", "", "Your limits"));
    card.append(head, element("p", "pane-limits-prompt", resolveText(mount.prompt)));
    const selected = {};
    const selectedLabels = {};
    const confirm = element("button", "pane-limits-confirm", "Lock these in →");
    confirm.type = "button";
    confirm.dataset.limitsConfirm = "";
    confirm.disabled = true;
    const updateConfirm = () => {
      confirm.disabled = fields.some((field) => !selected[field.id]);
    };
    fields.forEach((field) => {
      const group = element("fieldset", "pane-limits-group");
      group.append(element("legend", "", field.label));
      const row = element("div", "pane-limits-row");
      field.options.forEach(([id, label]) => {
        const optionId = `shell-${field.id}-${id}`;
        const line = element("label", "pane-limits-pill");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = field.id;
        input.value = id;
        input.id = optionId;
        input.addEventListener("change", () => {
          selected[field.id] = id;
          selectedLabels[field.id] = label;
          updateConfirm();
        });
        line.htmlFor = optionId;
        line.append(input, document.createTextNode(label));
        row.append(line);
      });
      group.append(row);
      card.append(group);
    });
    confirm.__tourValues = () => fields.map((field) => selected[field.id]).join("|");
    confirm.__tourSummary = () =>
      fields.map((field) => ({ id: field.id, label: field.label, value: selectedLabels[field.id] || "" }));
    confirm.__tourFollowUp = mount.followUp || "";
    card.append(element("p", "rail-lock", mount.lockNote), confirm);
    append(main, card);
    main.scrollTop = main.scrollHeight;
  }

  function dockLimitsSummary(confirm) {
    const rail = railPane("rail-limits");
    const card = query("#shell-main [data-limits-card]");
    const summary = typeof confirm.__tourSummary === "function" ? confirm.__tourSummary() : [];
    if (rail) {
      const staticHeading = query("h2", rail);
      rail.replaceChildren();
      if (staticHeading) rail.append(staticHeading);
      const box = element("div", "rail-limits-chips");
      summary.forEach((item) => {
        const chip = element("p", "rail-chip");
        chip.dataset.limitChip = item.id;
        chip.append(element("small", "", item.label), element("b", "", item.value));
        box.append(chip);
      });
      box.append(element("p", "rail-lock", "🔒 Locked to your side. Only you can see these."));
      if (confirm.__tourFollowUp) {
        const followUp = element("p", "rail-limit-note", confirm.__tourFollowUp);
        followUp.dataset.limitsFollowUp = "";
        box.append(followUp);
      }
      append(rail, box);
      const railHost = document.getElementById("shell-rail");
      if (railHost) railHost.scrollTop = 0;
    }
    if (card) {
      if (prefersReduced()) {
        card.remove();
      } else {
        card.classList.add("is-docking");
        window.setTimeout(() => card.remove(), 420);
      }
    }
  }

  function flashLimitChip(id) {
    const chip = query(`#rail-limits [data-limit-chip="${id}"]`);
    if (!chip) return;
    chip.classList.remove("is-flash");
    void chip.offsetWidth;
    chip.classList.add("is-flash");
  }

  function renderOptions(mount) {
    const main = mainPane();
    if (!main) return;
    const panel = element("section", "pane-artifact pane-options");
    (mount.items || []).forEach((item) => {
      const button = element("button", "pane-option");
      button.type = "button";
      button.dataset.option = item.id;
      button.setAttribute("aria-pressed", "false");
      button.__tourOption = item;
      button.__tourKey = mount.key;
      button.append(element("b", "", `${item.id} · ${item.title}`), element("span", "", item.body));
      panel.append(button);
    });
    if (mount.followUp) panel.append(element("p", "", mount.followUp));
    append(main, panel);
    scrollMain();
  }

  function renderCallBridge(mount) {
    const main = mainPane();
    if (!main) return;
    const bridge = element("section", "pane-artifact pane-call-bridge");
    bridge.append(element("p", "", mount.text));
    const button = element("button", "is-primary", mount.button);
    button.type = "button";
    button.dataset.callJoin = "";
    bridge.append(button);
    append(main, bridge);
    scrollMain();
  }

  function callPortrait(person) {
    const portrait = element("span", "call-portrait");
    const img = document.createElement("img");
    img.src = person.portrait || "";
    img.alt = "";
    img.loading = "eager";
    const fallback = element("span", "call-portrait-fallback", (person.name || "?").slice(0, 1));
    fallback.hidden = true;
    img.addEventListener("error", () => {
      img.hidden = true;
      fallback.hidden = false;
    }, { once: true });
    portrait.append(img, fallback);
    return portrait;
  }

  function copilotHeading(variant, source) {
    if (variant === "pinned") return "■ THE ONE QUESTION";
    if (variant === "fact") return `📄 FACT${source ? ` · ${source}` : ""}`;
    if (variant === "fair") return "⚖ fairness note";
    if (variant === "draft") return "✍ DRAFTING…";
    if (variant === "private") return "🔒 PRIVATE";
    return "TIME";
  }

  function mountCopilotCard(variant, options = {}) {
    const rail = railPane("rail-agents");
    if (!rail) return null;
    const card = element("article", `copilot-card is-${variant}`);
    card.dataset.copilotCard = variant;
    card.append(element("strong", "copilot-card-title", copilotHeading(variant, options.source)));
    const bodyText = String(options.text || "");
    const sourceSuffix = " · source →";
    const hasSourceTag = variant === "fact" && bodyText.endsWith(sourceSuffix);
    const body = element("p", "copilot-card-body", hasSourceTag ? bodyText.slice(0, -sourceSuffix.length) : bodyText);
    body.dataset.copilotBody = "";
    card.append(body);
    if (variant === "fact" && (hasSourceTag || options.source)) {
      card.append(element("span", "copilot-source", "source →"));
    }
    if (variant === "pinned") {
      rail.prepend(card);
      enter(card);
    } else {
      append(rail, card);
    }
    if (variant === "pinned" || variant === "private" || variant === "draft") setRailOpen(true);
    return card;
  }

  async function typeCallDraft(target, text) {
    if (!target) return;
    if (prefersReduced() || state.abortBeat) {
      target.textContent = text;
      return;
    }
    target.textContent = "";
    for (const character of text) {
      target.textContent += character;
      await wait(18);
      if (state.abortBeat) {
        target.textContent = text;
        return;
      }
    }
  }

  function createCallStage() {
    const main = mainPane();
    if (!main) return null;
    main.replaceChildren();
    const stage = element("section", "call-stage");
    stage.setAttribute("aria-label", "The 9-minute decision video call");

    const head = element("header", "call-head");
    const dot = element("span", "call-live-dot", "●");
    dot.setAttribute("aria-hidden", "true");
    const timer = element("span", "call-timer", formatCallTime(540));
    timer.dataset.callTimer = "";
    head.append(dot, document.createTextNode(" "), timer, document.createTextNode(" · The 9-minute decision"));

    const tiles = element("div", "call-tiles");
    ["alex", "rowan", "sam"].forEach((id) => {
      const person = personFor(id);
      const tile = element("article", "call-tile");
      tile.dataset.callPerson = id;
      const name = element("span", "call-name", id === "alex" ? "Alex · you" : person.name);
      const mic = element("span", "call-mic", "🎙");
      mic.setAttribute("aria-hidden", "true");
      tile.append(callPortrait(person), name, mic);
      tiles.append(tile);
    });

    const captions = element("div", "call-captions");
    const cc = element("span", "call-cc", "CC");
    const caption = element("span", "call-caption-line", "");
    caption.dataset.callCaption = "";
    caption.setAttribute("aria-live", "polite");
    captions.append(cc, caption);

    const controls = element("div", "call-controls", "🎙 mute · 📷 video · 💬 chat · CC captions · ⏻ leave");
    controls.setAttribute("aria-hidden", "true");
    stage.append(head, tiles, captions, controls);
    append(main, stage);
    state.call = { stage, timer, caption, controls, seconds: 540 };
    return stage;
  }

  async function moveCallTimer(seconds) {
    const call = state.call;
    if (!call || !call.timer) return;
    const from = call.seconds;
    call.seconds = seconds;
    await animateCallTimer(call.timer, from, seconds);
  }

  async function speakInCall(personId, text) {
    const call = state.call;
    if (!call || !call.stage || !call.caption) return;
    queryAll(".call-tile", call.stage).forEach((tile) => tile.classList.remove("is-speaking"));
    const tile = query(`[data-call-person="${personId}"]`, call.stage);
    if (tile) tile.classList.add("is-speaking");
    call.caption.textContent = `${personFor(personId).name}: ${text}`;
    await wait(720);
    if (tile) tile.classList.remove("is-speaking");
  }

  function renderCallMove(labels, ids, gate) {
    const call = state.call;
    if (!call || !call.stage || !call.controls) return { panel: null, buttons: [] };
    const existing = query(".call-move", call.stage);
    if (existing) existing.remove();
    const panel = element("section", "call-move");
    const heading = element("h2", "", "YOUR MOVE");
    panel.append(heading);
    const buttons = (labels || []).map((label, index) => {
      const button = element("button", "", label);
      button.type = "button";
      button.dataset.callMove = gate;
      button.dataset.callChoice = ids[index];
      panel.append(button);
      return button;
    });
    call.stage.insertBefore(panel, call.controls);
    enter(panel);
    setRailOpen(false);
    if (buttons[0]) highlightTarget(buttons[0]);
    return { panel, buttons };
  }

  async function playFirstCallResponse(choice, script, fairnessCard) {
    if (choice === "honest") {
      await speakInCall("alex", script.honest.alex);
      mountCopilotCard("fact", { source: script.honest.source, text: script.honest.fact });
      await speakInCall("rowan", script.honest.rowan);
      return;
    }
    if (fairnessCard) {
      fairnessCard.classList.add("is-resolved");
      const body = query("[data-copilot-body]", fairnessCard);
      if (body) body.textContent = script.sam.resolved;
    }
    await speakInCall("sam", script.sam.answer);
    await speakInCall("rowan", script.sam.rowan);
  }

  async function waitForFirstCallMove(script, fairnessCard) {
    const { panel, buttons } = renderCallMove(script.move, ["honest", "promise", "sam"], "one");
    if (!panel || buttons.length !== 3) {
      warn("first call move was incomplete; skipped it");
      return;
    }
    let promiseCaught = false;
    await new Promise((resolve) => {
      buttons.forEach((button) => button.addEventListener("click", async () => {
        const choice = button.dataset.callChoice;
        if (choice === "promise") {
          promiseCaught = true;
          mountCopilotCard("private", { text: script.promise });
          flashLimitChip("hard");
          button.disabled = true;
          button.classList.add("is-blocked");
          const lock = element("small", "call-blocked-lock", "🔒");
          lock.setAttribute("aria-hidden", "true");
          button.append(lock);
          const next = buttons.find((candidate) => !candidate.disabled);
          if (next) highlightTarget(next);
          return;
        }
        buttons.forEach((candidate) => { candidate.disabled = true; });
        clearTargets();
        panel.remove();
        await playFirstCallResponse(choice, script, fairnessCard);
        const reply = promiseCaught ? "promise_caught" : choice;
        logEvent({ story_meeting_reply1: reply });
        resolve();
      }));
    });
  }

  async function renderCallOpen(mount) {
    setRailActive(true);
    const rail = railPane("rail-agents");
    if (rail) rail.replaceChildren();
    // rail-limits is deliberately preserved: the player's locked limits stay
    // visible through the call — they are the anchor for the boundary catch.
    ["rail-record", "rail-meter"].forEach((id) => {
      const pane = document.getElementById(id);
      if (pane) pane.replaceChildren();
    });
    const stage = createCallStage();
    if (!stage) return;
    const anchors = mount.anchors || {};
    const script = mount.script || {};
    await moveCallTimer(anchors.open);
    await speakInCall("rowan", script.open);
    await moveCallTimer(anchors.question);
    const question = mount.questions && mount.questions[state.flags.option];
    mountCopilotCard("pinned", { text: question || "" });
    await speakInCall("alex", script.build);
    await moveCallTimer(anchors.review);
    await speakInCall("sam", script.review);
    await moveCallTimer(anchors.shortcut);
    await speakInCall("rowan", script.shortcut);
    const fairnessCard = mountCopilotCard("fair", { text: script.fairness });
    await waitForFirstCallMove(script, fairnessCard);
    await moveCallTimer(anchors.reply);
  }

  async function waitForSecondCallMove(script) {
    const { panel, buttons } = renderCallMove(script.move, ["confirm", "week"], "two");
    if (!panel || buttons.length !== 2) {
      warn("second call move was incomplete; skipped it");
      return;
    }
    const choice = await new Promise((resolve) => {
      buttons.forEach((button) => button.addEventListener("click", () => {
        buttons.forEach((candidate) => { candidate.disabled = true; });
        clearTargets();
        panel.remove();
        resolve(button.dataset.callChoice);
      }, { once: true }));
    });
    if (choice === "confirm") {
      const tiles = queryAll(".call-tile", state.call && state.call.stage);
      tiles.forEach((tile) => tile.classList.add("is-speaking"));
      await wait(420);
      tiles.forEach((tile) => tile.classList.remove("is-speaking"));
      await speakInCall("rowan", script.confirm);
    } else {
      mountCopilotCard("fact", { source: script.weekSource, text: script.weekFact });
      await speakInCall("rowan", script.week);
    }
    logEvent({ story_meeting_reply2: choice });
  }

  async function renderCallDecision(mount) {
    const call = state.call;
    if (!call || !call.stage || !call.stage.isConnected) {
      warn("call decision step could not find the active call");
      return;
    }
    const anchors = mount.anchors || {};
    const script = mount.script || {};
    await moveCallTimer(anchors.draft);
    const selected = mount.draftData && mount.draftData[state.flags.option];
    const draftCard = mountCopilotCard("draft", { text: "" });
    const draftBody = query("[data-copilot-body]", draftCard);
    await typeCallDraft(draftBody, selected ? selected.decision : "");
    await waitForSecondCallMove(script);
    await moveCallTimer(anchors.closing);
    mountCopilotCard("time", { text: script.closing });
    await wait(360);
    const ended = element("p", "call-ended", script.ended);
    call.stage.insertBefore(ended, call.controls);
    enter(ended);
    logEvent({ story_meeting_completed: true });
    await wait(520);
    const main = mainPane();
    if (main && call.stage.isConnected) main.replaceChildren();
    state.call = null;
  }

  function renderRailRecord(mount) {
    const rail = railPane("rail-record");
    if (!rail) return;
    rail.replaceChildren();
    const record = element("section", "rail-record");
    record.dataset.recordVersion = mount.version || "Version 1";
    record.append(element("strong", "", mount.version || "Version 1"));
    record.append(element("p", "", mount.approvals || "0 of 3 approved · Version 1"));
    rail.append(record);
  }

  function renderApproval(mount) {
    const main = mainPane();
    if (!main) return;
    const approval = element("section", "pane-artifact pane-approval");
    const status = element("p", "", "Your card. Your name.");
    status.dataset.approvalStatus = "";
    const actions = element("div", "action-row");
    actions.dataset.approvalActions = "";
    (mount.actions || []).forEach((label) => {
      const button = element("button", label === "Approve" ? "is-primary" : "", label);
      button.type = "button";
      button.dataset.approvalAction = label;
      actions.append(button);
    });
    approval.append(status, actions);
    append(main, approval);
    scrollMain();
  }

  function renderPreview(mount) {
    const main = mainPane();
    if (!main) return;
    const selected = mount.data && mount.data[state.flags.option];
    if (!selected) {
      warn("preview could not find the selected option");
      return;
    }
    const preview = element("section", "pane-artifact pane-preview");
    const states = [];
    (mount.rows || []).forEach(([label, key]) => {
      const row = element("div", "");
      const status = element("span", "", "Not sent");
      status.dataset.state = "not-sent";
      status.classList.add("preview-state");
      const copy = element("div", "");
      copy.append(element("strong", "", label), element("p", "", selected[key]));
      row.append(copy, status);
      preview.append(row);
      states.push(status);
    });
    const button = element("button", "is-primary", mount.button || "Approve updates");
    button.type = "button";
    button.dataset.previewSend = "";
    button.__tourPreviewStates = states;
    preview.append(button);
    append(main, preview);
    scrollMain();
  }

  async function renderOutcome(mount) {
    const main = mainPane();
    if (main) {
      const outcome = element("section", "pane-artifact pane-outcome");
      outcome.append(element("p", "pane-outcome-timeline", "record → one week later → promise kept ✓"));
      outcome.append(element("p", "", mount.promise));
      const meter = element("div", "pane-outcome-meter");
      let counter = null;
      (mount.stats || []).forEach(([label, storyValue, oldValue]) => {
        const row = element("div", "");
        const value = element("strong", "", storyValue);
        if (label === "Unbilled work") {
          counter = value;
          value.textContent = "NZ$3,800";
        }
        row.append(element("span", "", label), value, element("span", "", oldValue));
        meter.append(row);
      });
      outcome.append(meter, element("p", "", mount.note));
      append(main, outcome);
      scrollMain();
      if (counter) await animateCounter(counter, 3800, 0, "NZ$");
    }

    const rail = railPane("rail-meter");
    if (!rail) return;
    rail.replaceChildren();
    const meter = element("section", "rail-meter");
    meter.append(element("strong", "", "One week later"));
    const value = element("span", "", "NZ$3,800");
    meter.append(value, element("small", "", "Unbilled work"));
    rail.append(meter);
    await animateCounter(value, 3800, 0, "NZ$");
  }

  async function renderRewind(mount) {
    const main = mainPane();
    if (main) {
      main.replaceChildren();
      const rewind = element("section", "pane-artifact pane-rewind");
      rewind.append(element("strong", "", "Friday, 4:52 pm"), element("p", "", mount.caption));
      append(main, rewind);
    }
    setRailActive(true);
    await wait(750);
  }

  function renderNote(mount) {
    const main = mainPane();
    if (!main) return;
    const className = mount.variant === "card" ? "pane-artifact pane-note is-card" : "pane-note";
    append(main, element("p", className, resolveText(mount.text)));
    scrollMain();
  }

  function renderContinue(mount) {
    const main = mainPane();
    if (!main) return;
    const button = element("button", "pane-continue", mount.text);
    button.type = "button";
    button.dataset.tourNext = "";
    append(main, button);
    scrollMain();
  }

  async function renderMount(mount) {
    if (!mount || !mount.kind) return;
    if (mount.kind === "thread") renderThread(mount);
    else if (mount.kind === "reply-row") renderReplyRow(mount);
    else if (mount.kind === "invite") renderInvite(mount);
    else if (mount.kind === "quotes") renderQuotes(mount);
    else if (mount.kind === "ticker") await renderTicker(mount);
    else if (mount.kind === "receipt") {
      const main = mainPane();
      if (!main) return;
      const receipt = makeReceipt(mount);
      if (mount.id) state.receipts.set(mount.id, { receipt, mount });
      append(main, receipt);
      scrollMain();
    } else if (mount.kind === "rail-agents") await renderAgents(mount);
    else if (mount.kind === "rail-limits") renderLimits(mount);
    else if (mount.kind === "options") renderOptions(mount);
    else if (mount.kind === "call-bridge") renderCallBridge(mount);
    else if (mount.kind === "call-open") await renderCallOpen(mount);
    else if (mount.kind === "call-decision") await renderCallDecision(mount);
    else if (mount.kind === "rail-record") renderRailRecord(mount);
    else if (mount.kind === "approval") renderApproval(mount);
    else if (mount.kind === "preview") renderPreview(mount);
    else if (mount.kind === "outcome") await renderOutcome(mount);
    else if (mount.kind === "rewind") await renderRewind(mount);
    else if (mount.kind === "note") renderNote(mount);
    else if (mount.kind === "continue") renderContinue(mount);
    else if (mount.kind === "overlay-epilogue") renderEpilogue(mount);
    else warn(`unknown mount kind ${mount.kind}`);
  }

  async function renderMounts(step, afterGate) {
    for (const mount of step.mounts || []) {
      if (Boolean(mount.afterGate) === Boolean(afterGate)) await renderMount(mount);
    }
  }

  function setClock(value) {
    if (value === null || value === undefined) return;
    const clocks = queryAll("[data-clock]");
    if (clocks.length === 0) warn("[data-clock] is missing; skipped clock update");
    clocks.forEach((clock) => { clock.textContent = value; });
  }

  function setInboxBadge(value) {
    const badges = queryAll("[data-inbox-badge]");
    if (badges.length === 0) warn("[data-inbox-badge] is missing; skipped inbox update");
    badges.forEach((badge) => {
      badge.textContent = String(value);
      badge.hidden = Number(value) <= 0;
    });
  }

  function setRailActive(active) {
    const off = document.getElementById("rail-off");
    const on = document.getElementById("rail-on");
    if (!off || !on) {
      warn("#rail-off or #rail-on is missing; skipped rail state change");
      return;
    }
    off.hidden = active;
    on.hidden = !active;
    const rail = document.getElementById("shell-rail");
    if (rail) rail.classList.toggle("is-off", !active);
    if (active) enter(on);
  }

  function setRailInCall(active) {
    const head = query(".shell-rail-head");
    if (!head) {
      warn(".shell-rail-head is missing; skipped in-call header update");
      return;
    }
    const icon = element("span", "", "✦");
    icon.setAttribute("aria-hidden", "true");
    head.replaceChildren(icon, document.createTextNode(active ? " Assistant · in call" : " Assistant"));
  }

  function ensureRailToggle() {
    const rail = document.getElementById("shell-rail");
    if (!rail) return null;
    let toggle = query("[data-rail-toggle], #rail-toggle, #shell-rail-toggle");
    if (toggle) return toggle;
    toggle = element("button", "shell-rail-toggle", "✦ Assistant ▴");
    toggle.type = "button";
    toggle.dataset.railToggle = "";
    document.body.append(toggle);
    return toggle;
  }

  function setRailOpen(open) {
    const rail = document.getElementById("shell-rail");
    if (!rail || window.innerWidth > 640) return;
    rail.classList.toggle("is-open", open);
    const toggle = ensureRailToggle();
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "✦ Assistant ▾" : "✦ Assistant ▴";
    }
  }

  function prepareShellForStep(step) {
    const clearMain = new Set(["a1-inbox", "rewind", "a2-button", "a2-options", "a2-approval", "a2-preview"]);
    const inCall = step.tourStep === 8 || step.tourStep === 9;
    setRailInCall(inCall);
    if (clearMain.has(step.id)) {
      const main = mainPane();
      if (main) main.replaceChildren();
    }
    if (step.id === "a2-approval") {
      const railAgents = document.getElementById("rail-agents");
      if (railAgents) railAgents.replaceChildren();
      setRailOpen(false);
    }
    if (step.id === "a1-inbox") setInboxBadge(1);
    if (step.tourStep === 5 || step.tourStep === 6) setRailOpen(true);
  }

  function updateTourBar(step) {
    if (Number.isInteger(step.tourStep)) state.tourStep = step.tourStep;
    if (step.chapter) state.chapter = step.chapter;
    const counter = query("[data-tour-step]");
    const text = query("[data-tour-text]");
    if (!counter) warn("[data-tour-step] is missing; skipped step counter update");
    else counter.textContent = `${state.chapter} · STEP ${state.tourStep || 1} OF 11`;
    if (!text) warn("[data-tour-text] is missing; skipped tour instruction update");
    else text.textContent = resolveText(step.instruction);
  }

  function targetFor(step) {
    return query(step.target);
  }

  function clearTargets() {
    queryAll(".tour-target").forEach((node) => node.classList.remove("tour-target"));
  }

  function highlightTarget(target) {
    clearTargets();
    if (!target) return;
    target.classList.add("tour-target");
    if (!target.disabled && target.tagName === "BUTTON") focusSoon(target);
  }

  function logStepValue(step, value) {
    const keys = Object.keys(step.log || {});
    if (keys.length > 0) logEvent({ [keys[0]]: value });
  }

  function appendChoiceReply(option) {
    const main = mainPane();
    if (!main || !option) return;
    const reply = element("section", "pane-artifact pane-choice-reply", option.reply);
    append(main, reply);
    scrollMain();
  }

  async function waitForChoice(step) {
    const replyMount = (step.mounts || []).find((mount) => mount.kind === "reply-row");
    const rows = queryAll("#shell-main .pane-reply-row");
    const row = rows.find((candidate) => candidate.dataset.choiceKey === (replyMount && replyMount.key)) || rows.at(-1);
    const buttons = queryAll("[data-choice]", row);
    if (buttons.length === 0) {
      warn("choice gate had no buttons; skipped it");
      return;
    }
    highlightTarget(buttons[0]);
    await new Promise((resolve) => {
      buttons.forEach((button) => button.addEventListener("click", () => {
        const option = button.__tourOption;
        buttons.forEach((candidate) => {
          const selected = candidate === button;
          candidate.disabled = !selected;
          candidate.setAttribute("aria-pressed", String(selected));
        });
        state.flags[button.__tourKey || "choice"] = option && option.id;
        logStepValue(step, option && option.id);
        appendChoiceReply(option);
        if (step.id === "a1-spiral") setInboxBadge(5);
        resolve();
      }, { once: true }));
    });
  }

  async function waitForLimits(step) {
    const confirm = query("#shell-main [data-limits-confirm]");
    if (!confirm) {
      warn("limits gate had no confirmation button; skipped it");
      return;
    }
    highlightTarget(confirm);
    const firstRadio = query("#shell-main [data-limits-card] input[type=radio]");
    if (confirm.disabled && firstRadio) focusSoon(firstRadio);
    await new Promise((resolve) => confirm.addEventListener("click", () => {
      const value = typeof confirm.__tourValues === "function" ? confirm.__tourValues() : "";
      state.flags.limits = value;
      logStepValue(step, value);
      dockLimitsSummary(confirm);
      resolve();
    }, { once: true }));
  }

  async function waitForOption(step) {
    const buttons = queryAll("#shell-main [data-option]");
    if (buttons.length === 0) {
      warn("option gate had no buttons; skipped it");
      return;
    }
    highlightTarget(buttons[0]);
    await new Promise((resolve) => {
      buttons.forEach((button) => button.addEventListener("click", () => {
        const option = button.__tourOption;
        buttons.forEach((candidate) => {
          const selected = candidate === button;
          candidate.disabled = !selected;
          candidate.setAttribute("aria-pressed", String(selected));
        });
        state.flags[button.__tourKey || "option"] = option && option.id;
        logStepValue(step, option && option.id);
        resolve();
      }, { once: true }));
    });
  }

  function addApprovalButtons(actions, labels) {
    if (!actions) return [];
    actions.replaceChildren();
    return labels.map((label) => {
      const button = element("button", label === "Approve" ? "is-primary" : "", label);
      button.type = "button";
      button.dataset.approvalAction = label;
      actions.append(button);
      return button;
    });
  }

  async function approvalMessage(from, text) {
    await wait(380);
    appendThreadMessage({ from, text, player: from === "player" });
  }

  function updateRailRecord(version, status) {
    const record = query("#rail-record .rail-record") || query("#rail-record");
    if (!record) {
      warn("#rail-record is missing; skipped record update");
      return;
    }
    record.replaceChildren(element("strong", "", version), element("p", "", status));
    record.dataset.recordVersion = version;
  }

  async function runApprovalScript(step, mount) {
    const script = mount.script || {};
    const main = mainPane();
    const status = query("[data-approval-status]", main);
    const actions = query("[data-approval-actions]", main);
    await approvalMessage("sam", script.sam);
    await approvalMessage("priya", script.priya);

    const receiptRef = state.receipts.get("approval-receipt");
    if (receiptRef) {
      receiptRef.receipt.classList.add("is-v2");
      const selected = optionData()[state.flags.option];
      updateReceipt(receiptRef.receipt, {
        rows: selected
          ? [["Decision", selected.decision], ["Date", selected.date], ["Safety", selected.safety], ["Cost", selected.cost], ["Customer update", script.customerUpdate]]
          : [],
      }, script.version);
    } else {
      warn("approval receipt is missing; skipped version update");
    }
    updateRailRecord(script.version, "2 of 3 approved · Version 2");
    setRailOpen(true);
    logEvent({ story_edit_loop_seen: true });
    if (main) append(main, element("p", "pane-note", script.editNote));
    const secondApprove = addApprovalButtons(actions, ["Approve"])[0];
    if (!secondApprove) {
      warn("re-approval button is missing; skipped remaining approval script");
      return;
    }
    highlightTarget(secondApprove);
    await new Promise((resolve) => secondApprove.addEventListener("click", resolve, { once: true }));
    secondApprove.disabled = true;
    await approvalMessage("casey", script.casey);
    logEvent({ story_notmine_seen: true });
    await approvalMessage(state.role === "alex" ? "counterpart" : "player", script.reassigned);
    if (status) status.textContent = script.status;
    updateRailRecord("Version 2", "3 of 3 approved · Version 2");
    if (actions) actions.replaceChildren();
    scrollMain();
  }

  async function waitForApproval(step) {
    const main = mainPane();
    const actions = query("[data-approval-actions]", main);
    const approvalMount = (step.mounts || []).find((mount) => mount.kind === "approval");
    if (!actions || !approvalMount) {
      warn("approval gate was incomplete; skipped it");
      return;
    }
    let buttons = queryAll("[data-approval-action]", actions);
    if (buttons.length === 0) {
      warn("approval gate had no action buttons; skipped it");
      return;
    }
    highlightTarget(buttons[0]);
    const action = await new Promise((resolve) => {
      buttons.forEach((button) => button.addEventListener("click", () => resolve(button.dataset.approvalAction), { once: true }));
    });
    if (action !== "Approve") {
      const note = action === "Not mine" ? approvalMount.notes.notmine : approvalMount.notes.other;
      if (main) append(main, element("p", "pane-note", note));
      buttons = addApprovalButtons(actions, ["Approve"]);
      const retry = buttons[0];
      if (!retry) {
        warn("approval retry button is missing; skipped remaining approval script");
        return;
      }
      highlightTarget(retry);
      await new Promise((resolve) => retry.addEventListener("click", resolve, { once: true }));
      retry.disabled = true;
    }
    await runApprovalScript(step, approvalMount);
  }

  async function waitForClick(step) {
    const target = targetFor(step);
    if (!target || target.tagName !== "BUTTON") {
      warn(`click gate target ${step.target} is missing or is not a button; skipped it`);
      return;
    }
    highlightTarget(target);
    await new Promise((resolve) => target.addEventListener("click", () => {
      if (target.dataset.previewSend !== undefined) {
        (target.__tourPreviewStates || []).forEach((label) => {
          label.textContent = "Sent ✓";
          label.dataset.state = "sent";
          label.classList.add("is-sent");
        });
        target.disabled = true;
      }
      if (target.dataset.sortRequest !== undefined) {
        target.disabled = true;
        target.textContent += " ✓";
      }
      if (target.dataset.nav === "inbox") {
        target.classList.add("is-active");
        target.setAttribute("aria-current", "page");
      }
      resolve();
    }, { once: true }));
  }

  async function waitForGate(step) {
    if (step.gate === "auto") {
      await wait(step.id === "rewind" || step.id === "a2-call-decision" ? 0 : 350);
      return;
    }
    if (step.gate === "choice") await waitForChoice(step);
    else if (step.gate === "limits") await waitForLimits(step);
    else if (step.gate === "option") await waitForOption(step);
    else if (step.gate === "approval") await waitForApproval(step);
    else if (step.gate === "click") await waitForClick(step);
    else warn(`unknown gate ${step.gate}; skipped it`);
  }

  function seatFor(role) {
    const person = personFor(role);
    const workspace = role === "rowan" ? "Seaside Health" : "Juniper Studio";
    queryAll("[data-workspace]").forEach((node) => { node.textContent = workspace; });
    queryAll("[data-player]").forEach((node) => { node.textContent = person.name; });
    const avatar = query(".shell-user img, [data-player-avatar]");
    if (avatar) {
      avatar.src = person.portrait || "";
      avatar.alt = person.name;
    } else {
      warn("topbar player avatar is missing; skipped seat portrait update");
    }
  }

  function renderEpilogue(mount) {
    const overlay = document.getElementById("shell-overlay");
    if (!overlay) {
      warn("#shell-overlay is missing; skipped epilogue overlay");
      return;
    }
    overlay.replaceChildren();
    const card = element("section", "overlay-card");
    card.append(element("h1", "", mount.heading), element("p", "", resolveText(mount.text)));
    const actions = element("div", "overlay-actions");
    (mount.buttons || []).forEach((item) => {
      const button = element("button", item.id === "replay" ? "is-primary" : "", item.label);
      button.type = "button";
      button.dataset.epilogueAction = item.id;
      button.addEventListener("click", () => {
        if (item.id === "replay") {
          const role = state.role === "alex" ? "rowan" : "alex";
          logEvent({ story_replay_clicked: true, story_replay_role: role });
          start(role, "replay");
          return;
        }
        if (item.id === "walkthrough") {
          logEvent({ story_walkthrough_clicked: true });
          window.location.assign(`walkthrough.html?r=${encodeURIComponent(rid)}`);
          return;
        }
        window.location.assign(`index.html?r=${encodeURIComponent(rid)}`);
      });
      actions.append(button);
    });
    card.append(actions, element("p", "overlay-disclaimer", mount.disclaimer));
    overlay.append(card);
    overlay.hidden = false;
    const replay = query("[data-epilogue-action=replay]", card);
    if (replay) focusSoon(replay);
  }

  async function runStep(index, runId) {
    if (!state.running || runId !== state.runId) return;
    const steps = tour && tour.steps;
    if (!Array.isArray(steps) || index >= steps.length) {
      state.running = false;
      return;
    }
    const step = steps[index];
    if (!step || !step.instruction || !step.gate || !step.target) {
      warn(`step ${index + 1} did not meet the step contract; skipped it`);
      await runStep(index + 1, runId);
      return;
    }
    resetBeat();
    prepareShellForStep(step);
    updateTourBar(step);
    setClock(step.clock);
    await renderMounts(step, false);
    if (!state.running || runId !== state.runId) return;
    await waitForGate(step);
    clearTargets();
    if (!state.running || runId !== state.runId) return;
    await renderMounts(step, true);
    if (step.id === "a2-outcome" && !state.completed) {
      state.completed = true;
      logEvent({ story_completed: true, story_seconds: visibleSeconds() });
    }
    await runStep(index + 1, runId);
  }

  function resetShell() {
    clearTargets();
    state.receipts.clear();
    state.call = null;
    setRailInCall(false);
    const main = mainPane();
    if (main) main.replaceChildren();
    const railAgents = document.getElementById("rail-agents");
    const railLimits = document.getElementById("rail-limits");
    const railRecord = document.getElementById("rail-record");
    const railMeter = document.getElementById("rail-meter");
    [railAgents, railLimits, railRecord, railMeter].forEach((node) => {
      if (node) node.replaceChildren();
    });
    setRailActive(false);
    setRailOpen(false);
  }

  function start(role, mode) {
    if (!tour || !tour.cast || !tour.cast[role] || !Array.isArray(tour.steps)) {
      warn("tour data is missing or invalid; could not start");
      return;
    }
    state.role = role;
    state.mode = mode || "story";
    state.flags = {};
    state.completed = false;
    state.tourStep = 0;
    state.chapter = "BEFORE THE ROOM";
    state.call = null;
    state.startedAt = performance.now();
    state.visibleAt = document.visibilityState === "visible" ? state.startedAt : 0;
    state.visibleMs = 0;
    state.running = true;
    const runId = ++state.runId;
    const overlay = document.getElementById("shell-overlay");
    if (overlay) overlay.hidden = true;
    else warn("#shell-overlay is missing; role-selection overlay could not close");
    seatFor(role);
    resetShell();
    void runStep(0, runId);
  }

  function connectControls() {
    const firstStep = (tour.steps || []).find((step) => Number.isInteger(step.tourStep));
    const initialCounter = query("[data-tour-step]");
    if (firstStep && initialCounter) initialCounter.textContent = `${firstStep.chapter} · STEP ${firstStep.tourStep} OF 11`;

    const skip = document.getElementById("tour-skip");
    if (skip) skip.addEventListener("click", fastForward);
    else warn("#tour-skip is missing; skip remains unavailable");

    const roles = queryAll("#shell-overlay [data-role]");
    if (roles.length === 0) warn("role buttons are missing; the tour cannot be selected from the overlay");
    roles.forEach((button) => button.addEventListener("click", () => {
      const role = button.dataset.role;
      if (!tour || !tour.cast || !tour.cast[role]) {
        warn("role button did not name a known role");
        return;
      }
      logEvent({ story_role: role });
      start(role, "story");
    }));

    const railToggle = ensureRailToggle();
    if (railToggle) {
      railToggle.addEventListener("click", () => {
        const rail = document.getElementById("shell-rail");
        if (rail) setRailOpen(!rail.classList.contains("is-open"));
      });
      railToggle.setAttribute("aria-expanded", "false");
    }
  }

  if (!tour || !Array.isArray(tour.steps)) {
    warn("window.TOUR is missing; shell engine did not start");
    return;
  }
  document.addEventListener("visibilitychange", trackVisibility);
  connectControls();
  logEvent({ story_opened: "load" });
})();
