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
    const rail = railPane("rail-limits");
    if (!rail) return;
    const fields = mount.byRole && mount.byRole[state.role];
    if (!Array.isArray(fields) || fields.length === 0) {
      warn("limits had no fields for the selected role");
      return;
    }
    const staticHeading = query("h2", rail);
    rail.replaceChildren();
    if (staticHeading) rail.append(staticHeading);
    const form = element("form", "rail-limit-group");
    form.append(element("p", "", resolveText(mount.prompt)));
    const selected = {};
    const confirm = element("button", "", "See the options →");
    confirm.type = "button";
    confirm.dataset.limitsConfirm = "";
    confirm.disabled = true;
    const updateConfirm = () => {
      confirm.disabled = fields.some((field) => !selected[field.id]);
    };
    fields.forEach((field) => {
      const group = element("fieldset", "");
      group.append(element("legend", "", field.label));
      field.options.forEach(([id, label]) => {
        const optionId = `shell-${field.id}-${id}`;
        const line = element("label", "");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = field.id;
        input.value = id;
        input.id = optionId;
        input.addEventListener("change", () => {
          selected[field.id] = id;
          updateConfirm();
        });
        line.htmlFor = optionId;
        line.append(input, document.createTextNode(label));
        group.append(line);
      });
      form.append(group);
    });
    confirm.__tourValues = () => fields.map((field) => selected[field.id]).join("|");
    form.append(element("p", "rail-lock", mount.lockNote), confirm);
    rail.append(form);
    const followUp = element("p", "rail-limit-note", mount.followUp);
    followUp.hidden = true;
    followUp.dataset.limitsFollowUp = "";
    rail.append(followUp);
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
    append(main, element("p", "pane-note", resolveText(mount.text)));
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
    if (clearMain.has(step.id)) {
      const main = mainPane();
      if (main) main.replaceChildren();
    }
    if (step.id === "a1-inbox") setInboxBadge(1);
    if (step.tourStep === 5 || step.tourStep === 6) setRailOpen(true);
  }

  function updateTourBar(step) {
    if (Number.isInteger(step.tourStep)) state.tourStep = step.tourStep;
    const counter = query("[data-tour-step]");
    const text = query("[data-tour-text]");
    if (!counter) warn("[data-tour-step] is missing; skipped step counter update");
    else counter.textContent = `STEP ${state.tourStep || 1} OF 9`;
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
    const confirm = query("#rail-limits [data-limits-confirm]");
    if (!confirm) {
      warn("limits gate had no confirmation button; skipped it");
      return;
    }
    highlightTarget(confirm);
    const firstRadio = query("#rail-limits input[type=radio]");
    if (confirm.disabled && firstRadio) focusSoon(firstRadio);
    await new Promise((resolve) => confirm.addEventListener("click", () => {
      const value = typeof confirm.__tourValues === "function" ? confirm.__tourValues() : "";
      state.flags.limits = value;
      logStepValue(step, value);
      const note = query("#rail-limits [data-limits-follow-up]");
      if (note) note.hidden = false;
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
      await wait(step.id === "rewind" ? 0 : 350);
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
