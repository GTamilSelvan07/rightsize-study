(() => {
  "use strict";

  const root = document.querySelector("#compact-demo");
  if (!root) {
    return;
  }

  const saved = window.Store.getState().answers;
  const wasCompleted = saved.e_demo_completed === true;
  const state = {
    approvals: { provider: wasCompleted, otherParty: wasCompleted },
    completed: wasCompleted,
    current: wasCompleted ? 4 : 1,
    elapsedMilliseconds: Math.max(0, Number(saved.e_demo_seconds) || 0) * 1000,
    fullDemoClicked: saved.e_full_demo_clicked === true,
    option: typeof saved.e_demo_option === "string" ? saved.e_demo_option : "",
    startedAt: null,
    stepsDone: wasCompleted ? 4 : Math.min(4, Math.max(1, Number(saved.e_demo_steps_done) || 1)),
  };
  let scenario = window.Store.getDemoScenario();

  const scenarioState = () => window.Store.getState().scenario || { status: "idle", payload: null, gen: false };

  const records = () => ({
    e_demo_option: state.option,
    e_demo_seconds: Math.max(0, Math.round((state.elapsedMilliseconds + (state.startedAt ? Date.now() - state.startedAt : 0)) / 1000)),
    e_demo_steps_done: state.stepsDone,
    e_demo_completed: state.completed,
    e_full_demo_clicked: state.fullDemoClicked,
    e_scenario_generated: scenarioState().gen === true,
    e_scenario_route: "smallest_conversation",
  });

  const save = () => {
    window.Store.setAnswers(records());
  };

  const setText = (selector, value, scope = document) => {
    const element = scope.querySelector(selector);
    if (element) {
      element.textContent = value;
    }
  };

  const attentionMath = (people, minutes, includeUnit = true) => {
    const total = people * minutes;
    return `${people} × ${minutes} = ${total}${includeUnit ? " attention-minutes" : ""}`;
  };

  const applyScenario = () => {
    const storedScenario = scenarioState();
    scenario = window.Store.getDemoScenario();

    setText("[data-scenario-summary]", scenario.summary);
    setText("[data-scenario-request]", scenario.request);
    setText("[data-scenario-evidence]", `${scenario.evidence[0]} The assistant shows the source for every fact.`);
    setText("[data-scenario-route]", scenario.smallConversation);
    setText("[data-scenario-decision]", scenario.decision);
    setText("[data-scenario-outcome]", scenario.outcome);
    setText("[data-scenario-before-math]", `${scenario.beforePeople} people × ${scenario.beforeMinutes} minutes = ${scenario.beforePeople * scenario.beforeMinutes} minutes of attention`);
    setText("[data-scenario-after-math]", `${scenario.afterPeople} people × ${scenario.afterMinutes} minutes = ${scenario.afterPeople * scenario.afterMinutes} minutes of attention`);
    const beforeAttention = scenario.beforePeople * scenario.beforeMinutes;
    const afterAttention = scenario.afterPeople * scenario.afterMinutes;
    const comparison = document.querySelector("[data-comparison]");
    if (comparison) {
      comparison.style.setProperty("--attention-after-width", `${Math.min(100, (afterAttention / beforeAttention) * 100)}%`);
    }

    const status = document.querySelector("[data-scenario-status]");
    if (status) {
      if (storedScenario.status === "ready") {
        status.textContent = "This fictional example was tailored from earlier multiple-choice answers. It does not use your email or anything you typed.";
      } else if (storedScenario.status === "fallback") {
        status.textContent = "Using a fixed fictional example—the study still works without AI.";
      } else {
        status.textContent = "Preparing a fictional example from your earlier multiple-choice answers…";
      }
    }

    setText("[data-demo-request]", `${scenario.request} ${scenario.meetingPressure}`, root);
    root.querySelectorAll("[data-demo-fact]").forEach((element) => {
      const index = Number(element.dataset.demoFact);
      element.textContent = scenario.evidence[index];
    });
    setText("[data-demo-human-question]", scenario.humanQuestion, root);
    setText("[data-demo-route-none]", scenario.noMeeting, root);
    setText("[data-demo-route-async]", scenario.asyncApproval, root);
    setText("[data-demo-route-small]", scenario.smallConversation, root);
    setText("[data-demo-recommendation-reason]", scenario.recommendationReason, root);
    root.querySelectorAll("[data-demo-option]").forEach((button, index) => {
      const option = scenario.options[index];
      setText("[data-demo-option-title]", option.title, button);
      setText("[data-demo-option-summary]", option.summary, button);
    });
    setText("[data-demo-outcome]", scenario.outcome, root);
    setText("[data-demo-before-math]", attentionMath(scenario.beforePeople, scenario.beforeMinutes), root);
    setText("[data-demo-after-math]", attentionMath(scenario.afterPeople, scenario.afterMinutes), root);
    updateReceipt();
  };

  const start = () => {
    if (state.startedAt === null) {
      state.startedAt = Date.now();
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

  const selectedOption = () => scenario.options.find((option) => option.id === state.option);

  function updateReceipt() {
    const selected = selectedOption();
    setText("[data-receipt-change]", selected ? selected.change : "Choose an option to see the record.", root);
    setText("[data-receipt-date]", selected ? selected.date : "—", root);
    setText("[data-receipt-price]", selected ? selected.price : "—", root);
    setText("[data-receipt-owner]", selected ? selected.owner : "—", root);
  }

  const updateDots = () => {
    root.querySelectorAll("[data-demo-dot]").forEach((dot) => {
      const number = Number(dot.dataset.demoDot);
      dot.classList.toggle("is-current", number === state.current);
      dot.classList.toggle("is-done", number < state.current || (state.completed && number === 4));
    });
  };

  const updateStatus = () => {
    setText("[data-demo-live]", `Example step ${state.current} of 4.`, root);
    const optionStatus = root.querySelector('[data-demo-screen="3"] [data-demo-status]');
    if (optionStatus) {
      optionStatus.textContent = state.option ? `Option ${state.option} selected.` : "Choose one option to continue.";
    }
    const approvalStatus = root.querySelector("[data-demo-approval-status]");
    if (approvalStatus) {
      if (!state.option) {
        approvalStatus.textContent = "Choose an option first.";
      } else if (!state.approvals.provider) {
        approvalStatus.textContent = "Your side has not approved yet.";
      } else if (!state.approvals.otherParty) {
        approvalStatus.textContent = "Your side approved. The fictional client has not responded yet.";
      } else {
        approvalStatus.textContent = "Both sides approved the same words separately ✓";
      }
    }
  };

  const updateControls = () => {
    root.querySelectorAll("[data-demo-option]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.demoOption === state.option));
    });
    const provider = root.querySelector('[data-demo-approval="provider"]');
    provider.disabled = !state.option || state.approvals.provider;
    provider.setAttribute("aria-pressed", String(state.approvals.provider));
    provider.textContent = state.approvals.provider ? "My side approved ✓" : "Approve my side";

    const otherParty = root.querySelector("[data-demo-other-party]");
    otherParty.disabled = !state.approvals.provider || state.approvals.otherParty;
    otherParty.textContent = state.approvals.otherParty ? "Client approved separately ✓" : "Reveal the client's separate response";

    root.querySelector('[data-demo-screen="3"] [data-demo-next]').disabled = !(state.approvals.provider && state.approvals.otherParty);
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
    state.current = Math.min(4, Math.max(1, step));
    state.stepsDone = Math.max(state.stepsDone, state.current);
    if (state.current === 4) {
      state.completed = true;
    }
    render();
    save();
  };

  const restart = () => {
    state.approvals = { provider: false, otherParty: false };
    state.completed = false;
    state.current = 1;
    state.elapsedMilliseconds = 0;
    state.fullDemoClicked = false;
    state.option = "";
    state.startedAt = Date.now();
    state.stepsDone = 1;
    render();
    save();
    setText("[data-demo-live]", "Example restarted at step 1 of 4.", root);
  };

  const fullLink = root.querySelector("[data-full-demo-link]");
  fullLink.href = `demo.html?r=${encodeURIComponent(window.Store.getState().rid)}`;

  root.addEventListener("click", (event) => {
    const option = event.target.closest("[data-demo-option]");
    if (option) {
      state.option = option.dataset.demoOption;
      state.approvals = { provider: false, otherParty: false };
      render();
      save();
      return;
    }

    const approval = event.target.closest('[data-demo-approval="provider"]');
    if (approval && !approval.disabled) {
      state.approvals.provider = true;
      render();
      save();
      return;
    }

    const otherParty = event.target.closest("[data-demo-other-party]");
    if (otherParty && !otherParty.disabled) {
      state.approvals.otherParty = true;
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

    if (event.target.closest("[data-demo-complete]")) {
      state.completed = true;
      save();
      const clarity = document.querySelector('[name="e_clarity"]');
      if (clarity) {
        clarity.focus();
      }
      return;
    }

    if (event.target.closest("[data-full-demo-link]")) {
      state.fullDemoClicked = true;
      save();
      return;
    }

    if (event.target.closest("[data-demo-restart]")) {
      restart();
    }
  });

  window.addEventListener("study:scenario", () => {
    applyScenario();
    render();
  });

  applyScenario();
  render();
  if (window.Survey && window.Survey.getCurrentStep() === "E") {
    start();
  }

  window.CompactDemo = {
    applyScenario,
    getData: records,
    pause,
    restart,
    start,
  };
})();
