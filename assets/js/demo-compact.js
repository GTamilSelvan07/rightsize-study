(() => {
  "use strict";

  const root = document.querySelector("#compact-demo");
  if (!root) {
    return;
  }

  const saved = window.Store.getState().answers;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = {
    approvals: { provider: false, client: false },
    completed: saved.e_demo_completed === true,
    current: 1,
    elapsedMilliseconds: Math.max(0, Number(saved.e_demo_seconds) || 0) * 1000,
    fullDemoClicked: saved.e_full_demo_clicked === true,
    option: typeof saved.e_demo_option === "string" ? saved.e_demo_option : "",
    startedAt: null,
    stepsDone: Math.min(5, Math.max(1, Number(saved.e_demo_steps_done) || 1)),
    timestamps: {},
  };
  let preparationTimer;

  const records = () => ({
    e_demo_option: state.option,
    e_demo_seconds: Math.max(0, Math.round((state.elapsedMilliseconds + (state.startedAt ? Date.now() - state.startedAt : 0)) / 1000)),
    e_demo_steps_done: state.stepsDone,
    e_demo_completed: state.completed,
    e_full_demo_clicked: state.fullDemoClicked,
  });

  const save = () => {
    window.Store.setAnswers(records());
  };

  const start = () => {
    if (state.startedAt === null) {
      state.startedAt = Date.now();
      state.timestamps[state.current] = state.startedAt;
      save();
    }
  };

  const pause = () => {
    if (state.startedAt !== null) {
      state.elapsedMilliseconds += Date.now() - state.startedAt;
      state.startedAt = null;
      save();
    }
  };

  const receipt = {
    A: {
      change: "Secure sign-in arrives 2 September",
      date: "Launch stays on 14 August",
      owner: "Provider product team",
      price: "Unchanged",
    },
    B: {
      change: "Secure sign-in stays in the launch",
      date: "Launch moves to 28 August",
      owner: "Provider and client project leads",
      price: "Unchanged",
    },
    C: {
      change: "Extra people join for 3 weeks",
      date: "Launch stays on 14 August",
      owner: "Provider delivery lead and client approver",
      price: "Extra budget sign-off needed",
    },
  };

  const updateReceipt = () => {
    const selected = receipt[state.option];
    root.querySelector("[data-receipt-change]").textContent = selected ? selected.change : "Choose an option to see the record.";
    root.querySelector("[data-receipt-date]").textContent = selected ? selected.date : "—";
    root.querySelector("[data-receipt-price]").textContent = selected ? selected.price : "—";
    root.querySelector("[data-receipt-owner]").textContent = selected ? selected.owner : "—";
  };

  const updateDots = () => {
    root.querySelectorAll("[data-demo-dot]").forEach((dot) => {
      const number = Number(dot.dataset.demoDot);
      dot.classList.toggle("is-current", number === state.current);
      dot.classList.toggle("is-done", number < state.current || (state.completed && number === 5));
    });
  };

  const updateStatus = () => {
    const live = root.querySelector("[data-demo-live]");
    live.textContent = `Example step ${state.current} of 5.`;
    const optionStatus = root.querySelector('[data-demo-screen="3"] [data-demo-status]');
    optionStatus.textContent = state.option ? `Option ${state.option} selected.` : "Choose one option to continue.";
    const approvalStatus = root.querySelector('[data-demo-screen="4"] [data-demo-status]');
    const count = Number(state.approvals.provider) + Number(state.approvals.client);
    approvalStatus.textContent = `${count} of 2 approved…`;
  };

  const updateControls = () => {
    root.querySelectorAll("[data-demo-option]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.demoOption === state.option));
    });
    root.querySelectorAll("[data-demo-approval]").forEach((button) => {
      button.setAttribute("aria-pressed", String(state.approvals[button.dataset.demoApproval]));
    });
    const optionNext = root.querySelector('[data-demo-screen="3"] [data-demo-next]');
    optionNext.disabled = !state.option;
    const approvalsDone = state.approvals.provider && state.approvals.client;
    root.querySelector('[data-demo-screen="4"] [data-demo-next]').disabled = !approvalsDone;
  };

  const startPreparation = () => {
    const screen = root.querySelector('[data-demo-screen="2"]');
    const button = screen.querySelector("[data-demo-next]");
    clearTimeout(preparationTimer);
    screen.classList.remove("is-preparing");
    void screen.offsetWidth;
    screen.classList.add("is-preparing");
    button.disabled = true;
    preparationTimer = window.setTimeout(() => {
      button.disabled = false;
      root.querySelector("[data-demo-live]").textContent = "The facts are ready. Nothing has been decided.";
    }, reducedMotion ? 0 : 3000);
  };

  const render = () => {
    root.querySelectorAll("[data-demo-screen]").forEach((screen) => {
      screen.classList.toggle("active", Number(screen.dataset.demoScreen) === state.current);
    });
    updateDots();
    updateStatus();
    updateControls();
    updateReceipt();
  };

  const goTo = (step) => {
    state.current = Math.min(5, Math.max(1, step));
    state.stepsDone = Math.max(state.stepsDone, state.current);
    state.timestamps[state.current] = Date.now();
    if (state.current === 5) {
      state.completed = true;
    }
    render();
    if (state.current === 2) {
      startPreparation();
    }
    save();
  };

  const restart = () => {
    clearTimeout(preparationTimer);
    state.approvals = { provider: false, client: false };
    state.completed = false;
    state.current = 1;
    state.elapsedMilliseconds = 0;
    state.fullDemoClicked = false;
    state.option = "";
    state.startedAt = Date.now();
    state.stepsDone = 1;
    state.timestamps = { 1: Date.now() };
    render();
    save();
    root.querySelector("[data-demo-live]").textContent = "Example restarted at step 1 of 5.";
  };

  const fullLink = root.querySelector("[data-full-demo-link]");
  fullLink.href = `demo.html?r=${encodeURIComponent(window.Store.getState().rid)}`;

  root.addEventListener("click", (event) => {
    const option = event.target.closest("[data-demo-option]");
    if (option) {
      state.option = option.dataset.demoOption;
      render();
      save();
      return;
    }

    const approval = event.target.closest("[data-demo-approval]");
    if (approval) {
      state.approvals[approval.dataset.demoApproval] = true;
      render();
      save();
      return;
    }

    const back = event.target.closest("[data-demo-back]");
    if (back) {
      goTo(state.current - 1);
      return;
    }

    const next = event.target.closest("[data-demo-next]");
    if (next && !next.disabled) {
      goTo(state.current + 1);
      return;
    }

    const complete = event.target.closest("[data-demo-complete]");
    if (complete) {
      state.completed = true;
      save();
      const clarity = document.querySelector('[name="e_clarity"]');
      if (clarity) {
        clarity.focus();
      }
      return;
    }

    const full = event.target.closest("[data-full-demo-link]");
    if (full) {
      state.fullDemoClicked = true;
      save();
      return;
    }

    if (event.target.closest("[data-demo-restart]")) {
      restart();
    }
  });

  render();
  window.CompactDemo = {
    getData: records,
    pause,
    restart,
    start,
  };
})();
