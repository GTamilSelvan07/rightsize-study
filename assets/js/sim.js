(() => {
  const config = window.STUDY_CONFIG || {};
  const params = new URLSearchParams(window.location.search);

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
    const payload = {
      token: config.FORM_TOKEN,
      rid,
      section: "demo_full",
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

  const screens = Array.from(document.querySelectorAll(".sim-screen"));
  const progress = Array.from(document.querySelectorAll("#sim-progress li"));
  const simStatus = document.getElementById("sim-status");
  const globalLive = document.getElementById("global-live");
  const factsInputs = Array.from(document.querySelectorAll('input[name="fact"]'));
  const factsButton = document.getElementById("facts-button");
  const factsStatus = document.getElementById("facts-status");
  const routeButtons = Array.from(document.querySelectorAll("[data-route]"));
  const routeButton = document.getElementById("route-button");
  const routeStatus = document.getElementById("route-status");
  const optionButtons = Array.from(document.querySelectorAll("[data-option]"));
  const optionButton = document.getElementById("option-button");
  const optionStatus = document.getElementById("option-status");
  const approvalButtons = Array.from(document.querySelectorAll("[data-approve]"));
  const approvalButton = document.getElementById("approval-button");
  const approvalStatus = document.getElementById("approval-status");
  const updatesApprove = document.getElementById("updates-approve");
  const updatesButton = document.getElementById("updates-button");
  const updateStatus = document.getElementById("update-status");
  const updateStates = Array.from(document.querySelectorAll("[data-update-state]"));
  const runOutcome = document.getElementById("run-outcome");
  const outcomeResult = document.getElementById("outcome-result");
  const outcomeWait = document.getElementById("outcome-wait");
  const outcomeStatus = document.getElementById("outcome-status");
  const restartButton = document.getElementById("restart-simulation");

  let current = 0;
  let selectedRoute = "";
  let selectedOption = "";
  let hasCompleted = false;
  const approvals = new Set();

  const optionData = {
    A: {
      decision: "Keep the 14 August launch and add secure sign-in on 2 September.",
      date: "Launch: 14 August · sign-in: 2 September",
      safety: "Provider review by 20 August",
      cost: "No extra cost",
      build: "Keep secure sign-in behind a switch. Move unfinished work to the 2 September work list; do not turn it on for the 14 August launch.",
      safetyUpdate: "Open the provider checklist, link the facts already found, and ask Sam only about the questions still open by 20 August.",
      delivery: "Keep the 14 August launch date. Move secure sign-in work and linked tasks to the 2 September plan.",
      customer: "Prepare a message saying the main launch stays on 14 August and secure sign-in follows on 2 September. Rowan reads it before it is sent.",
      outcome: "In this fictional example, the 14 August launch goes ahead without secure sign-in, which remains planned for 2 September.",
    },
    B: {
      decision: "Keep secure sign-in and move the launch to 28 August.",
      date: "Launch with secure sign-in: 28 August",
      safety: "Safety check must be complete before launch",
      cost: "No extra cost",
      build: "Continue secure sign-in work for the release. Keep the launch blocked until Sam says the safety check is complete.",
      safetyUpdate: "Complete the provider review and write down either approval to launch or the reason it cannot go ahead before 28 August.",
      delivery: "Move the launch and linked work from 14 August to 28 August. Tell each person whose work is affected.",
      customer: "Prepare a message explaining the new launch date and that secure sign-in stays included. Rowan reads it before it is sent.",
      outcome: "In this fictional example, the launch and secure sign-in happen on 28 August after the safety check is complete.",
    },
    C: {
      decision: "Keep the 14 August launch and secure sign-in by adding a small delivery team.",
      date: "Launch with secure sign-in: 14 August",
      safety: "Safety check runs alongside the work; no checks are skipped",
      cost: "NZ$4,000 extra cost",
      build: "Share the agreed secure sign-in tasks with the added delivery team. Keep the launch blocked until Sam says the safety check is complete.",
      safetyUpdate: "Run the full provider review alongside the build work. Say clearly if any safety check is still not answered.",
      delivery: "Add the agreed delivery team, keep the 14 August date, and show new linked-work or safety questions each day.",
      customer: "Prepare the NZ$4,000 change and customer message. Jules and Rowan read both before they are sent.",
      outcome: "In this fictional example, the 14 August launch includes secure sign-in after the safety check and both-company cost approval.",
    },
  };

  function showScreen(index) {
    current = Math.max(0, Math.min(index, screens.length - 1));
    screens.forEach((screen, screenIndex) => {
      const active = screenIndex === current;
      screen.classList.toggle("is-active", active);
      screen.hidden = !active;
    });
    progress.forEach((item, itemIndex) => {
      item.classList.toggle("is-current", itemIndex === current);
      item.classList.toggle("is-done", itemIndex < current);
    });
    simStatus.textContent = `Step ${current + 1} of ${screens.length}`;

    const heading = screens[current].querySelector("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
    globalLive.textContent = `Opened step ${current + 1} of ${screens.length}.`;

    if (current === screens.length - 1 && !hasCompleted) {
      hasCompleted = true;
      logEvent({ demo_full_completed: true });
    }
  }

  function updateFacts() {
    const selected = factsInputs.filter((input) => input.checked);
    const privateIncluded = selected.some((input) => input.value === "private");
    const stillNeeded = 3 - selected.length;
    factsButton.disabled = selected.length < 3;

    if (stillNeeded > 0) {
      factsStatus.textContent = `${selected.length} selected. Choose ${stillNeeded} more useful item${stillNeeded === 1 ? "" : "s"}.`;
      return;
    }

    factsStatus.textContent = privateIncluded
      ? `${selected.length} selected. Your private limits are included; remove them unless there is a clear reason to keep them.`
      : `${selected.length} selected. Personal history stays outside this example.`;
  }

  function renderOption() {
    const data = optionData[selectedOption];
    if (!data) return;

    document.getElementById("record-decision").textContent = data.decision;
    document.getElementById("record-date").textContent = data.date;
    document.getElementById("record-safety").textContent = data.safety;
    document.getElementById("record-cost").textContent = data.cost;
    document.getElementById("update-build").textContent = data.build;
    document.getElementById("update-safety").textContent = data.safetyUpdate;
    document.getElementById("update-delivery").textContent = data.delivery;
    document.getElementById("update-customer").textContent = data.customer;
    document.getElementById("result-decision").textContent = `${data.decision} Jules, Rowan, and Sam approved this version in the example.`;
    document.getElementById("result-outcome").textContent = data.outcome;
    document.getElementById("outcome-plan").textContent = `${data.decision} This fictional example has prepared updates, but the result has not been checked yet.`;
  }

  function resetApprovals() {
    approvals.clear();
    approvalButtons.forEach((button) => button.setAttribute("aria-pressed", "false"));
    approvalButton.disabled = true;
    approvalStatus.textContent = "0 of 3 people have approved this shared record.";
  }

  function resetUpdates() {
    updatesButton.disabled = true;
    updatesApprove.disabled = false;
    updateStates.forEach((state) => {
      state.textContent = "Not sent";
      state.classList.remove("done");
    });
    updateStatus.textContent = "Nothing has been sent.";
    outcomeWait.hidden = false;
    outcomeResult.hidden = true;
    runOutcome.disabled = false;
    outcomeStatus.textContent = "Fictional example. It does not show a real customer outcome.";
  }

  function resetWalkthrough() {
    factsInputs.forEach((input) => {
      input.checked = false;
    });
    routeButtons.forEach((button) => button.setAttribute("aria-pressed", "false"));
    optionButtons.forEach((button) => button.setAttribute("aria-pressed", "false"));
    selectedRoute = "";
    selectedOption = "";
    hasCompleted = false;
    factsButton.disabled = true;
    routeButton.disabled = true;
    optionButton.disabled = true;
    resetApprovals();
    resetUpdates();
    document.getElementById("record-decision").textContent = "Choose an option";
    document.getElementById("record-date").textContent = "—";
    document.getElementById("record-safety").textContent = "—";
    document.getElementById("record-cost").textContent = "—";
    document.getElementById("update-build").textContent = "Choose an option first.";
    document.getElementById("update-safety").textContent = "Choose an option first.";
    document.getElementById("update-delivery").textContent = "Choose an option first.";
    document.getElementById("update-customer").textContent = "Choose an option first.";
    document.getElementById("result-decision").textContent = "The example has one shared record.";
    document.getElementById("result-outcome").textContent = "The fictional outcome will appear here.";
    document.getElementById("outcome-plan").textContent = "This made-up example has not been moved forward yet.";
    factsStatus.textContent = "Nothing is selected yet.";
    routeStatus.textContent = "Pick a conversation to continue.";
    optionStatus.textContent = "Choose an option to make the shared record.";
    showScreen(0);
  }

  document.querySelectorAll("[data-next]").forEach((button) => {
    button.addEventListener("click", () => showScreen(current + 1));
  });

  document.querySelectorAll("[data-back]").forEach((button) => {
    button.addEventListener("click", () => showScreen(current - 1));
  });

  factsInputs.forEach((input) => input.addEventListener("change", updateFacts));

  routeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedRoute = button.dataset.route;
      routeButtons.forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      routeButton.disabled = false;
      logEvent({ demo_full_route: selectedRoute });

      const messages = {
        written: "You chose written messages. The people in this example will still need to answer the open questions together.",
        focused: "You chose the 9-minute decision with Jules, Rowan, and Sam.",
        planning: "You chose a longer planning meeting. The same open questions remain visible to everyone.",
      };
      routeStatus.textContent = messages[selectedRoute];
    });
  });

  optionButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedOption = button.dataset.option;
      optionButtons.forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
      optionButton.disabled = false;
      logEvent({ demo_full_option: selectedOption });
      resetApprovals();
      resetUpdates();
      optionStatus.textContent = selectedOption === "C"
        ? "Option C includes an extra cost. The people below will approve the same written record."
        : `Option ${selectedOption} is selected. The next step makes a shared record for everyone to read.`;
      renderOption();
    });
  });

  approvalButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const person = button.dataset.approve;
      if (approvals.has(person)) {
        approvals.delete(person);
        button.setAttribute("aria-pressed", "false");
      } else {
        approvals.add(person);
        button.setAttribute("aria-pressed", "true");
      }
      approvalButton.disabled = approvals.size !== approvalButtons.length;
      approvalStatus.textContent = approvals.size === approvalButtons.length
        ? "3 of 3 people approved this shared record. You can now preview the updates."
        : `${approvals.size} of 3 people have approved this shared record.`;
    });
  });

  updatesApprove.addEventListener("click", () => {
    updateStates.forEach((state) => {
      state.textContent = "Approved";
      state.classList.add("done");
    });
    updatesButton.disabled = false;
    updatesApprove.disabled = true;
    updateStatus.textContent = "All four updates are approved for this fictional example. Each stays connected to the shared record.";
  });

  runOutcome.addEventListener("click", () => {
    outcomeWait.hidden = true;
    outcomeResult.hidden = false;
    runOutcome.disabled = true;
    outcomeStatus.textContent = "The fictional result is now compared with the shared record. A real product would need people to review any difference.";
  });

  restartButton.addEventListener("click", resetWalkthrough);
  window.addEventListener("load", () => logEvent({ demo_full_opened: true }), { once: true });
})();
