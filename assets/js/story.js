(() => {
  "use strict";

  const config = window.STUDY_CONFIG || {};
  const story = window.STORY;
  const stage = document.getElementById("story-stage");
  const castScreen = document.getElementById("s0-cast");
  const skipButton = document.getElementById("story-skip");
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
    mode: params.get("replay") === "1" ? "replay" : "story",
    sceneIndex: 0,
    skipToggle: false,
    abortBeat: false,
    receipts: new Map(),
    startedAt: 0,
    visibleAt: 0,
    visibleMs: 0,
    completed: false,
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

  function initialFor(person) {
    return (person && person.name ? person.name : "?").slice(0, 1).toUpperCase();
  }

  function applyImageFallback(image, person) {
    const showMat = () => {
      image.hidden = true;
      const mat = image.nextElementSibling;
      if (mat && mat.classList.contains("story-chip-mat")) mat.hidden = false;
    };
    image.onerror = showMat;
    if (person) image.dataset.initial = initialFor(person);
  }

  function connectStaticImageFallbacks() {
    document.querySelectorAll("img[data-initial]").forEach((image) => {
      const mat = image.nextElementSibling;
      image.onerror = () => {
        image.hidden = true;
        if (mat) mat.hidden = false;
      };
    });
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

  function focusSoon(target) {
    window.requestAnimationFrame(() => {
      if (target && target.isConnected) target.focus({ preventScroll: true });
    });
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

  function getChat(context) {
    const marker = context.scene.id;
    let app = context.log.querySelector(`.story-chatapp[data-scene="${marker}"]`);
    if (!app) {
      app = element("section", "story-chatapp");
      app.dataset.scene = marker;
      const bar = element("header", "story-chatapp-bar");
      const dots = element("span", "story-chatapp-dots");
      dots.append(element("i"), element("i"), element("i"));
      const name = element("strong", "", "# seaside-launch");
      const meta = element("em", "", "Shared channel · Juniper Studio + Seaside Health");
      bar.append(dots, name, meta);
      const feed = element("div", "story-chatlog");
      app.append(bar, feed);
      append(context.log, app);
    }
    return app.querySelector(".story-chatlog");
  }

  function avatarFor(person) {
    const wrap = element("span", "story-msg-avatar");
    const initial = (person.name || "?").charAt(0);
    if (person.img) {
      const img = document.createElement("img");
      img.src = person.img;
      img.alt = "";
      img.loading = "lazy";
      const fallback = element("span", "story-msg-fallback", initial);
      fallback.hidden = true;
      img.onerror = () => {
        img.hidden = true;
        fallback.hidden = false;
      };
      wrap.append(img, fallback);
    } else {
      wrap.append(element("span", "story-msg-fallback", initial));
    }
    return wrap;
  }

  function messageRow(person, { isPlayer = false, time = "" } = {}) {
    const classes = ["story-msg"];
    if (isPlayer) classes.push("is-player");
    if (person.kind === "agent") classes.push("is-agent");
    const row = element("article", classes.join(" "));
    row.append(avatarFor(person));
    const body = element("div", "story-msg-body");
    const head = element("header", "story-msg-head");
    head.append(element("b", "", person.name));
    if (isPlayer) head.append(element("span", "story-msg-tag is-you", "you"));
    if (person.kind === "agent") head.append(element("span", "story-msg-tag is-app", "APP"));
    if (time) head.append(element("time", "", time));
    body.append(head);
    row.append(body);
    return { row, body };
  }

  async function appendMessage(context, step) {
    const text = resolveText(step.text);
    if (!text) return;
    const chat = getChat(context);
    const from = resolveFrom(step.from);
    const person = story.cast[from] || { name: "You", kind: "human" };

    if (!prefersReduced()) {
      const { row, body } = messageRow(person, {});
      row.classList.add("is-typing");
      row.setAttribute("aria-hidden", "true");
      const dots = element("span", "story-typing-dots");
      dots.append(element("i"), element("i"), element("i"));
      body.append(dots);
      append(chat, row);
      await wait(Math.min(1400, 350 + text.length * 18));
      row.remove();
    } else {
      await wait(0);
    }

    const isPlayer = step.player || from === state.role;
    const { row, body } = messageRow(person, { isPlayer, time: step.time || "" });
    body.append(element("p", "", text));
    append(chat, row);
    chat.scrollTop = chat.scrollHeight;
  }

  function appendNote(log, text) {
    if (text) append(log, element("p", "story-note", text));
  }

  function makeGroup(className, label, contents) {
    const group = element("section", className);
    const labelId = `story-control-${Math.random().toString(36).slice(2)}`;
    const heading = element("h3", "", label);
    heading.id = labelId;
    group.setAttribute("role", "group");
    group.setAttribute("aria-labelledby", labelId);
    group.append(heading, contents);
    return group;
  }

  function waitForButton(button) {
    return new Promise((resolve) => {
      button.addEventListener("click", () => resolve(button), { once: true });
    });
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

  function renderArt(scene, container) {
    if (!scene.art) return;
    const art = element("div", "story-art");
    if (scene.art.className) art.classList.add(scene.art.className);
    if (scene.art.dimmed) art.classList.add("is-dimmed");
    const image = document.createElement("img");
    image.src = scene.art.src;
    image.alt = scene.art.alt;
    image.loading = "eager";
    image.style.setProperty("--kb-origin", scene.art.kb.origin);
    image.style.setProperty("--kb-pan", scene.art.kb.pan);
    const mat = element("div", "story-chip-mat", scene.art.alt.slice(0, 1).toUpperCase());
    mat.hidden = true;
    mat.setAttribute("aria-hidden", "true");
    applyImageFallback(image);
    art.append(image, mat);
    if (scene.art.video) {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.preload = "none";
      video.poster = scene.art.src;
      video.src = scene.art.video;
      video.addEventListener("error", () => video.remove(), { once: true });
      art.append(video);
      if (!prefersReduced()) void video.play().catch(() => undefined);
    }
    container.append(art);
  }

  function updateReceipt(receipt, data, version) {
    const title = receipt.querySelector("[data-receipt-title]");
    if (title) title.textContent = version || "Version 1";
    const rows = receipt.querySelector("[data-receipt-rows]");
    if (!rows) return;
    rows.replaceChildren();
    const rowData = data.optionRows
      ? [["Decision", story.optionData[state.flags.option].decision], ["Date", story.optionData[state.flags.option].date], ["Safety", story.optionData[state.flags.option].safety], ["Cost", story.optionData[state.flags.option].cost]]
      : data.rows;
    rowData.forEach(([label, value]) => {
      const row = element("div", "");
      row.append(element("span", "", label), element("strong", "", value));
      rows.append(row);
    });
  }

  const renderers = {
    async msg(context, step) {
      await appendMessage(context, step);
    },
    async note(context, step) {
      appendNote(context.log, resolveText(step.text));
    },
    async continue(context, step) {
      // "Press: X" renders as an assistant app action inside the chat window.
      if (/^Press:\s*/i.test(step.text)) {
        const chat = getChat(context);
        const assistant = { name: "Assistant", kind: "agent", img: story.cast.prep && story.cast.prep.img };
        const { row, body } = messageRow(assistant, {});
        row.classList.add("is-action");
        body.append(element("p", "", "One button appears, attached to the request."));
        const button = element("button", "story-app-btn", step.text.replace(/^Press:\s*/i, ""));
        button.type = "button";
        body.append(button);
        append(chat, row);
        focusSoon(button);
        await waitForButton(button);
        button.disabled = true;
        button.classList.add("is-done");
        button.textContent += " ✓";
        return;
      }
      const button = element("button", `story-continue${step.primary ? " is-primary" : ""}`, step.text);
      button.type = "button";
      append(context.log, button);
      focusSoon(button);
      await waitForButton(button);
    },
    async choice(context, step) {
      const cards = element("div", "story-cards");
      const options = step.byRole ? step.byRole[state.role] : step.options;
      const group = makeGroup("story-choice", resolveText(step.prompt), cards);
      const buttons = options.map((option) => {
        const button = element("button", "story-card", option.label);
        button.type = "button";
        button.setAttribute("aria-pressed", "false");
        button.dataset.choice = option.id;
        cards.append(button);
        return button;
      });
      append(context.log, group);
      focusSoon(buttons[0]);
      const chosen = await new Promise((resolve) => {
        buttons.forEach((button, index) => {
          button.addEventListener("click", () => resolve({ button, option: options[index] }), { once: true });
        });
      });
      buttons.forEach((button) => {
        const pressed = button === chosen.button;
        button.setAttribute("aria-pressed", String(pressed));
        button.classList.toggle("is-pressed", pressed);
      });
      state.flags[step.key] = chosen.option.id;
      logEvent({ [step.log]: chosen.option.id });
      appendNote(context.log, chosen.option.reply);
    },
    async calendar(context, step) {
      const invite = element("section", "story-invite");
      const badge = element("span", "story-invite-badge", "Meeting invitation");
      const title = element("h3", "", step.title);
      const when = element("p", "story-invite-when", `Tuesday · 10:00 – 11:00 am · video call`);
      const guests = element("div", "story-invite-guests");
      const faces = element("div", "story-invite-faces");
      const known = ["alex", "rowan", "sam", "priya", "casey"];
      known.forEach((id) => faces.append(avatarFor(story.cast[id] || { name: id })));
      ["T", "J", "M"].slice(0, Math.max(0, step.people - known.length)).forEach((ch) => {
        faces.append(avatarFor({ name: ch }));
      });
      const count = element("p", "story-invite-count",
        `${step.people} guests · ${step.minutes} minutes held on every calendar`);
      guests.append(faces, count);
      const actions = element("div", "story-invite-actions");
      ["Accept", "Maybe", "Decline"].forEach((label) => {
        const b = element("span", "story-invite-btn", label);
        b.setAttribute("aria-hidden", "true");
        actions.append(b);
      });
      invite.append(badge, title, when, guests, actions);
      append(context.log, invite);
      await wait(400);
    },
    async quotes(context, step) {
      const quotes = element("div", "story-quotes");
      step.items.forEach((item) => {
        const quote = element("blockquote", "story-quote", item.text);
        quote.classList.add(`is-${item.side}`);
        quotes.append(quote);
      });
      append(context.log, quotes);
    },
    async ticker(context, step) {
      const ticker = element("section", "story-ticker");
      ticker.append(element("span", "", step.label));
      const value = element("strong", "", `${step.prefix}${step.from.toLocaleString("en-NZ")}`);
      ticker.append(value);
      append(context.log, ticker);
      await animateCounter(value, step.from, step.to, step.prefix);
    },
    async receipt(context, step) {
      const receipt = element("section", `story-receipt${step.variant === "pain" ? " is-pain" : ""}`);
      const title = element("h3", "", step.version || step.title || "Version 1");
      title.dataset.receiptTitle = "";
      const rows = element("div", "");
      rows.dataset.receiptRows = "";
      receipt.append(title, rows);
      updateReceipt(receipt, step, step.version || step.title);
      if (step.id) state.receipts.set(step.id, { receipt, step });
      append(context.log, receipt);
    },
    async rewind(context, step) {
      const rewind = element("section", "story-rewind");
      rewind.append(element("strong", "", step.to));
      if (state.mode !== "replay") rewind.append(element("p", "", step.caption));
      append(context.log, rewind);
      await wait(750);
    },
    async agents(context, step) {
      const cards = element("div", "story-cards");
      step.items.forEach((item) => {
        const person = story.cast[item.id];
        const card = element("article", "story-card");
        card.append(element("strong", "", person.name), element("p", "", item.text));
        if (item.complete) card.append(element("span", "", "✓"));
        cards.append(card);
      });
      append(context.log, cards);
    },
    async limits(context, step) {
      const limits = element("form", "story-limits");
      const fields = step.byRole[state.role];
      const heading = element("h3", "", resolveText(step.prompt));
      heading.id = "story-limits-title";
      limits.setAttribute("aria-labelledby", heading.id);
      limits.append(heading);
      const selected = {};
      fields.forEach((field, fieldIndex) => {
        const group = element("fieldset", "");
        const legend = element("legend", "", field.label);
        group.append(legend);
        field.options.forEach(([id, label], optionIndex) => {
          const optionId = `story-${field.id}-${id}`;
          const line = element("label", "");
          const input = document.createElement("input");
          input.type = "radio";
          input.name = field.id;
          input.value = id;
          input.id = optionId;
          if (fieldIndex === 0 && optionIndex === 0) {
            input.checked = true;
            selected[field.id] = id;
          }
          input.addEventListener("change", () => { selected[field.id] = id; });
          line.append(input, document.createTextNode(label));
          group.append(line);
        });
        limits.append(group);
      });
      limits.append(element("p", "story-lock", step.lockNote));
      const submit = element("button", "story-continue", "See the options →");
      submit.type = "submit";
      limits.append(submit);
      append(context.log, limits);
      focusSoon(limits.querySelector("input"));
      await new Promise((resolve) => limits.addEventListener("submit", (event) => {
        event.preventDefault();
        resolve();
      }, { once: true }));
      const value = fields.map((field) => selected[field.id] || limits.querySelector(`input[name="${field.id}"]:checked`).value).join("|");
      state.flags.limits = value;
      logEvent({ [step.log]: value });
    },
    async options(context, step) {
      const cards = element("div", "story-cards");
      const group = makeGroup("story-choice", "Choose one option", cards);
      const buttons = step.items.map((item) => {
        const button = element("button", "story-card");
        button.type = "button";
        button.setAttribute("aria-pressed", "false");
        button.append(element("strong", "", `${item.id} · ${item.title}`), element("span", "", item.body));
        cards.append(button);
        return button;
      });
      append(context.log, group);
      focusSoon(buttons[0]);
      const selected = await new Promise((resolve) => {
        buttons.forEach((button, index) => button.addEventListener("click", () => resolve({ button, item: step.items[index] }), { once: true }));
      });
      buttons.forEach((button) => {
        const pressed = button === selected.button;
        button.setAttribute("aria-pressed", String(pressed));
        button.classList.toggle("is-pressed", pressed);
      });
      state.flags[step.key] = selected.item.id;
      logEvent({ [step.log]: selected.item.id });
    },
    async approval(context, step) {
      const approval = element("section", "story-approval");
      const status = element("p", "", "");
      const actions = element("div", "story-action-row");
      approval.append(status, actions);
      append(context.log, approval);
      const receiptRef = state.receipts.get(step.receipt);

      const makeActions = (labels) => {
        actions.replaceChildren();
        return labels.map((label) => {
          const button = element("button", "story-card", label);
          button.type = "button";
          actions.append(button);
          return button;
        });
      };

      const firstActions = makeActions(["Approve", "Suggest an edit", "Reject", "Not mine", "Hand to a person"]);
      status.textContent = "Your card. Your name.";
      focusSoon(firstActions[0]);
      let action = await new Promise((resolve) => firstActions.forEach((button) => button.addEventListener("click", () => resolve(button.textContent), { once: true })));
      if (action !== "Approve") {
        if (action === "Not mine") {
          appendNote(context.log, "This card is yours in the story — but that button matters: nothing can be silently assigned to anyone. You'll see it in action in a moment.");
        } else {
          appendNote(context.log, "In the real thing, this pauses everything until a person resolves it. Nothing proceeds on silence. (For this story, let's say you approve.)");
        }
        const retry = makeActions(["Approve"])[0];
        focusSoon(retry);
        await waitForButton(retry);
      }

      await appendMessage(context.log, { from: "sam", text: "Approved the safety path — the review completes before sign-in goes live." });
      await appendMessage(context.log, { from: "priya", text: "One thing — the record says 'client team notified' as our task. That's Seaside's side, not ours. Suggesting an edit." });
      receiptRef.receipt.classList.add("is-v2");
      updateReceipt(receiptRef.receipt, {
        optionRows: false,
        rows: [["Decision", story.optionData[state.flags.option].decision], ["Date", story.optionData[state.flags.option].date], ["Safety", story.optionData[state.flags.option].safety], ["Cost", story.optionData[state.flags.option].cost], ["Customer update", "Rowan prepares the board update."]],
      }, "Version 2 — every approval resets");
      logEvent({ story_edit_loop_seen: true });
      appendNote(context.log, "An edit never disappears into chat. It makes a new version, and everyone approves again. Nobody discovers a changed deal later.");
      const secondApprove = makeActions(["Approve"])[0];
      focusSoon(secondApprove);
      await waitForButton(secondApprove);
      await appendMessage(context.log, { from: "casey", text: "I've been assigned 'prepare the board update'. That's not mine — that's Rowan's. Tapping 'Not mine'." });
      logEvent({ story_notmine_seen: true });
      if (state.role === "alex") {
        await appendMessage(context.log, { from: "counterpart", text: "Reassigned to me. Accepted — the board update is mine." });
      } else {
        await appendMessage(context.log, { from: "player", text: "Reassigned to me. Accepted — the board update is mine." });
      }
      status.textContent = "3 of 3 approved · Version 2 · Nothing was assumed.";
      actions.replaceChildren();
    },
    async preview(context, step) {
      const preview = element("section", "story-preview");
      const data = story.optionData[state.flags.option];
      const rows = [];
      step.rows.forEach(([label, key]) => {
        const row = element("div", "");
        const stateLabel = element("span", "", "Not sent");
        row.append(element("strong", "", label), element("p", "", data[key]), stateLabel);
        preview.append(row);
        rows.push(stateLabel);
      });
      const button = element("button", "story-continue", "Approve updates");
      button.type = "button";
      preview.append(button);
      append(context.log, preview);
      focusSoon(button);
      await waitForButton(button);
      rows.forEach((row) => { row.textContent = "Sent ✓"; });
      button.remove();
    },
    async meter(context, step) {
      const meter = element("section", "story-meter");
      step.stats.forEach(([label, storyValue, oldValue]) => {
        const row = element("div", "story-meter-row");
        row.append(element("strong", "", label), element("span", "", storyValue), element("span", "", oldValue));
        meter.append(row);
      });
      append(context.log, meter);
      if (step.log === "story_completed" && !state.completed) {
        state.completed = true;
        logEvent({ story_completed: true, story_seconds: visibleSeconds() });
      }
    },
    async cta(context, step) {
      const cta = element("section", "story-cta");
      cta.append(element("p", "", resolveText(step.text)));
      const buttons = step.buttons.map((item) => {
        const button = element("button", "story-card", item.label);
        button.type = "button";
        cta.append(button);
        return { item, button };
      });
      cta.append(element("p", "story-disclaimer", "A fictional story with AI-illustrated characters. An idea we're researching — not a finished product. No measured results are claimed."));
      append(context.log, cta);
      focusSoon(buttons[0].button);
      buttons.forEach(({ item, button }) => button.addEventListener("click", () => {
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
      }));
    },
  };

  async function renderScene() {
    while (state.sceneIndex < story.scenes.length && state.mode === "replay" && story.scenes[state.sceneIndex].skipOnReplay) {
      state.sceneIndex += 1;
    }
    if (state.sceneIndex >= story.scenes.length) return;
    const scene = story.scenes[state.sceneIndex];
    const continuing = scene.continues && stage.querySelector(".story-log");
    let progress;
    let heading;
    let log;
    if (continuing) {
      stage.querySelector(".story-art")?.remove();
      progress = stage.querySelector(".story-progress");
      heading = stage.querySelector("h2");
      log = stage.querySelector(".story-log");
      progress.textContent = scene.label || scene.heading || "One Friday";
      heading.textContent = scene.heading || scene.label || "One Friday";
    } else {
      stage.replaceChildren();
      progress = element("p", "story-progress", scene.label || scene.heading || "One Friday");
      progress.setAttribute("aria-live", "polite");
      heading = element("h2", "", scene.heading || scene.label || "One Friday");
      heading.tabIndex = -1;
      log = element("section", "story-log");
      log.setAttribute("role", "log");
      log.setAttribute("aria-live", "polite");
      log.addEventListener("click", (event) => {
        if (!event.target.closest("button, a, input, label")) fastForward();
      });
      renderArt(scene, stage);
      stage.append(progress, heading, log);
    }
    focusSoon(heading);

    const visibleSteps = scene.steps.filter((step) => matches(step.if) && !(state.mode === "replay" && step.full));
    for (const step of visibleSteps) {
      resetBeat();
      await renderers[step.type]({ scene, log }, step);
    }
    if (scene.id === "x1-rewind" || (state.mode === "replay" && visibleSteps.length === 0)) {
      state.sceneIndex += 1;
      await renderScene();
      return;
    }
    state.sceneIndex += 1;
    if (state.sceneIndex < story.scenes.length) await renderScene();
  }

  function start(role, mode) {
    state.role = role;
    state.mode = mode || "story";
    state.flags = {};
    state.sceneIndex = 0;
    state.receipts.clear();
    state.completed = false;
    state.startedAt = performance.now();
    state.visibleAt = document.visibilityState === "visible" ? state.startedAt : 0;
    state.visibleMs = 0;
    castScreen.hidden = true;
    stage.hidden = false;
    void renderScene();
  }

  if (!story || !stage || !castScreen) return;
  connectStaticImageFallbacks();
  document.addEventListener("visibilitychange", trackVisibility);
  skipButton.addEventListener("click", fastForward);
  document.querySelectorAll("[data-role]").forEach((button) => button.addEventListener("click", () => {
    const role = button.dataset.role;
    logEvent({ story_role: role });
    start(role, state.mode);
  }));
  logEvent({ story_opened: "load" });
})();
