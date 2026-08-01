(() => {
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
    },
  };

  window.STORY = {
    version: 1,
    cast: {
      alex: { id: "alex", kind: "human", side: "provider", name: "Alex", title: "Delivery lead, Juniper Studio", portrait: "assets/img/cast/alex.jpg" },
      rowan: { id: "rowan", kind: "human", side: "client", name: "Rowan", title: "Project sponsor, Seaside Health", portrait: "assets/img/cast/rowan.jpg" },
      sam: { id: "sam", kind: "human", name: "Sam", title: "Safety reviewer, Juniper Studio", portrait: "assets/img/cast/sam.jpg" },
      priya: { id: "priya", kind: "human", name: "Priya", title: "Producer, Juniper Studio", portrait: "assets/img/cast/priya.jpg" },
      casey: { id: "casey", kind: "human", name: "Casey", title: "Operations, Seaside Health", portrait: "assets/img/cast/casey.jpg" },
      prep: { id: "prep", kind: "agent", name: "Prep", does: "Gathers facts, sources shown", limit: "Can't decide anything", portrait: "assets/img/cast/agent-prep.jpg" },
      fair: { id: "fair", kind: "agent", name: "Fairness", does: "Checks the right people are included", limit: "Can't approve anything", portrait: "assets/img/cast/agent-fairness.jpg" },
      record: { id: "record", kind: "agent", name: "Record", does: "Keeps one shared version", limit: "Can't edit the content", portrait: "assets/img/cast/agent-record.jpg" },
      promise: { id: "promise", kind: "agent", name: "Promise", does: "Checks the outcome later", limit: "Read-only", portrait: "assets/img/cast/agent-promise.jpg" },
    },
    optionData,
    scenes: [
      {
        id: "a1s1-friday",
        label: "Act 1 · Friday, 4:52 pm",
        skipOnReplay: true,
        art: { src: "assets/img/scenes/old-way-chaos.jpg", alt: "A busy desk at the end of a Friday", kb: { origin: "30% 40%", pan: "8% -4%" } },
        steps: [
          { type: "note", text: { alex: "Friday, 4:52 pm. You're clearing your inbox before the weekend.", rowan: "Friday, 4:52 pm. You've meant to send this all week. You finally do." } },
          { type: "msg", from: "rowan", time: "4:52 pm", text: "Hey — quick one before the weekend. Can we get secure sign-in into the 14 August launch? The board asked about it this morning." },
          { type: "msg", from: "alex", if: { role: "alex" }, player: true, text: "'Quick one.' You read it twice. No cost mentioned. No owner. No plan change." },
          { type: "note", if: { role: "rowan" }, text: "It feels small from your side. You genuinely don't know it isn't." },
          { type: "note", text: "Nobody said who can say yes to a new date, a new cost, or a safety check. This is how it always starts." },
          { type: "continue", text: "See what happens →" },
        ],
      },
      {
        id: "a1s2-spiral",
        heading: "Act 1",
        continues: true,
        skipOnReplay: true,
        steps: [
          {
            type: "choice",
            key: "act1_c1",
            log: "story_act1_choice1",
            prompt: { alex: "It's 4:53 pm. What do you do?", rowan: "Monday, 9 am. No reply yet. What do you do?" },
            byRole: {
              alex: [
                { id: "meeting", label: "Book a meeting with everyone", reply: "Safest move. By Monday the invite has eight names on it — nobody wants to be the one who wasn't there." },
                { id: "build", label: "Tell the devs to just start", reply: "Work begins on a guess. The guess is wrong in one important way — but nobody knows that yet." },
                { id: "fine", label: "Reply 'should be fine!' and log off", reply: "It's the weekend. 'Should be fine' will be quoted back at you in three weeks." },
              ],
              rowan: [
                { id: "chase", label: "Chase Alex again", reply: "Alex replies: 'Looping in the team — let's get everyone on a call.' The invite grows." },
                { id: "escalate", label: "CC your manager", reply: "Now it's visible. Which means now it needs a meeting." },
                { id: "assume", label: "Assume it's happening", reply: "Silence reads as yes. On both sides. About different things." },
              ],
            },
          },
          { type: "note", text: "Whatever you chose — it converges on the same place. It always does." },
        ],
      },
      {
        id: "a1s3-tuesday",
        label: "Act 1 · Tuesday, 10:00 am",
        skipOnReplay: true,
        art: { src: "assets/img/scenes/calendar-wall.jpg", alt: "A calendar filled with overlapping meetings", kb: { origin: "58% 35%", pan: "-6% 4%" } },
        steps: [
          { type: "calendar", title: "Login scope alignment", people: 8, minutes: 60 },
          { type: "note", text: "Eight people, one hour. Four don't know why they're invited. Two are double-booked. The decision needs exactly three of them — nobody is sure which three." },
          { type: "continue", text: "Sit through it →" },
        ],
      },
      {
        id: "a1s4-differently",
        heading: "The meeting happens.",
        skipOnReplay: true,
        steps: [
          { type: "note", text: "The meeting happens. It runs eleven minutes over. Everyone leaves feeling aligned." },
          { type: "quotes", items: [
            { side: "alex", text: "\"We agreed sign-in ships after launch. The date holds.\"" },
            { side: "rowan", text: "\"We agreed sign-in is in the launch. That's the whole reason we asked.\"" },
          ] },
          { type: "choice", key: "act1_c2", log: "story_act1_choice2", prompt: "Three days later, the difference surfaces in a status call. What now?", options: [
            { id: "recording", label: "Dig through the meeting recording", reply: "The recording is 62 minutes long. The sentence you need isn't in it — because it was never actually said." },
            { id: "meeting2", label: "Book another meeting", reply: "Thursday. Six people this time. It mostly relitigates Tuesday." },
            { id: "split", label: "Quietly split the difference", reply: "The team builds part of it unpaid, hoping goodwill covers the rest. It half-works. It usually half-works." },
          ] },
          { type: "ticker", label: "Unbilled work while this stays unsettled", from: 0, to: 3800, prefix: "NZ$" },
        ],
      },
      {
        id: "a1s5-receipt",
        heading: "Three weeks later",
        skipOnReplay: true,
        art: { src: "assets/img/scenes/calendar-wall.jpg", alt: "A calendar filled with overlapping meetings", kb: { origin: "52% 52%", pan: "-4% 2%" }, dimmed: true },
        steps: [
          { type: "receipt", variant: "pain", title: "Three weeks later", rows: [
            ["Decision", "Still disputed"],
            ["Launch", "Slipped 2 weeks"],
            ["Unbilled work", "NZ$3,800"],
            ["Relationship", "One tense phone call"],
            ["Shared record", "None. Three versions in three inboxes."],
          ] },
          { type: "note", text: "Nobody was careless. Nobody lied. The process just has no floor." },
          { type: "continue", text: "There's another way this Friday could have gone →" },
        ],
      },
      {
        id: "x1-rewind",
        heading: "Friday, 4:52 pm",
        art: { src: "assets/img/scenes/rewind.jpg", alt: "A rewind symbol over a Friday desk", kb: { origin: "50% 50%", pan: "0% 0%" } },
        steps: [
          { type: "rewind", to: "Friday, 4:52 pm", caption: "Same request. Same people. One new button." },
        ],
      },
      {
        id: "a2s1-button",
        label: "Act 2 · Friday, 4:52 pm",
        art: { src: "assets/img/scenes/old-way-chaos.jpg", alt: "A busy desk at the end of a Friday", kb: { origin: "30% 40%", pan: "8% -4%" }, className: "is-lime" },
        steps: [
          { type: "msg", from: "rowan", time: "4:52 pm", text: "Hey — quick one before the weekend. Can we get secure sign-in into the 14 August launch? The board asked about it this morning." },
          { type: "note", text: { alex: "This time, your team's assistant is attached to the project. The button lives right on the request — not in another app.", rowan: "Juniper's assistant is on this project. You can see the same button they can." } },
          { type: "continue", text: "Press: Sort this out", primary: true },
        ],
      },
      {
        id: "a2s2-agents",
        heading: "Four helpers, four hard limits.",
        steps: [
          { type: "agents", full: true, items: [
            { id: "prep", text: "Read the signed agreement, the delivery plan, and the build notes. Found four facts and one open question — sources attached." },
            { id: "fair", text: "Checked who's affected. This decision needs exactly three people: Alex, Rowan, and Sam. Nobody extra gets pulled in." },
            { id: "record", text: "Opened one shared record. Everything that follows lands in it — nothing lives in chat memory." },
            { id: "promise", text: "Nothing to do yet. Will check the outcome against the record after the new date." },
          ] },
          { type: "note", full: true, text: "Four helpers, four hard limits. None of them can say yes to anything. Saying yes is yours." },
          { type: "continue", full: true, text: "Next: your side of the table →" },
        ],
      },
      {
        id: "a2s3-limits",
        heading: "Set your side's limits.",
        steps: [
          {
            type: "limits",
            log: "story_limits_set",
            prompt: { alex: "Before options appear, set your side's limits. Only you see these.", rowan: "Set what matters to your side. Juniper never sees these." },
            byRole: {
              alex: [
                { id: "budget", label: "Extra spend you could live with", options: [["none", "None"], ["b2k", "Up to NZ$2,000"], ["b5k", "Up to NZ$5,000"]] },
                { id: "hard", label: "Your hard line", options: [["weekend", "No weekend work for the team"], ["security", "No shortcut past the security review"], ["scope", "No new scope without sign-off"]] },
                { id: "flex", label: "Where you can bend", options: [["date", "The launch date"], ["order", "Which features ship first"], ["alloc", "Who's on the team"]] },
              ],
              rowan: [
                { id: "budget", label: "Extra budget you could unlock", options: [["board", "None without the board"], ["b5k", "Up to NZ$5,000"], ["any", "Whatever it takes"]] },
                { id: "hard", label: "Non-negotiable", options: [["review", "The security review must pass"], ["demo", "A board demo on the 14th"], ["price", "No price surprises later"]] },
                { id: "flex", label: "Where you can bend", options: [["date", "The exact launch date"], ["first", "Which features ship first"], ["phase", "Phasing it in"]] },
              ],
            },
            lockNote: "🔒 Locked to your side. The assistant uses these to shape the options — it never shows them to anyone.",
          },
          { type: "note", text: "The other side is doing the same thing right now. You'll never see theirs either." },
        ],
      },
      {
        id: "a2s4-options",
        heading: "Three options.",
        steps: [
          { type: "note", text: "Monday, 9:04 am. Three options, built from both sides' limits and the facts — trade-offs stated, sources attached." },
          { type: "options", key: "option", log: "story_option", items: [
            { id: "A", title: "Keep the 14 August launch", body: "Launch without secure sign-in. Add it on 2 September. No extra cost." },
            { id: "B", title: "Keep secure sign-in", body: "Move the launch to 28 August. No extra cost." },
            { id: "C", title: "Keep both together", body: "Add a small delivery team for NZ$4,000. Both companies need to agree." },
          ] },
          { type: "note", text: "Notice what's missing: a meeting. If one is still needed, it'll be nine minutes with three people — not an hour with eight." },
        ],
      },
      {
        id: "a2s5-approval",
        heading: "Version 1",
        steps: [
          { type: "receipt", id: "approval-receipt", version: "Version 1", optionRows: true },
          { type: "note", text: "Your card. Your name. You can only approve for yourself — nobody can press this for you." },
          { type: "approval", receipt: "approval-receipt" },
          { type: "continue", text: "See exactly what gets sent →" },
        ],
      },
      {
        id: "a2s6-preview",
        heading: "Preview the exact wording.",
        steps: [
          { type: "note", text: "Before anything updates, everyone previews the exact wording their own systems receive." },
          { type: "preview", rows: [
            ["Build notes", "build"],
            ["Safety check", "safetyUpdate"],
            ["Delivery plan", "delivery"],
            ["Customer update", "customer"],
          ] },
          { type: "note", text: "Every system got exactly the approved words. Nothing more, nothing summarized." },
          { type: "continue", text: "One week later →" },
        ],
      },
      {
        id: "a2s7-week",
        heading: "One week later",
        art: { src: "assets/img/scenes/payoff.jpg", alt: "A calm team at the end of a successful week", kb: { origin: "45% 45%", pan: "4% -3%" } },
        steps: [
          { type: "agents", items: [
            { id: "promise", text: "Checked the record against what happened: the date held, the security review passed, the cost matched. Marked: promise kept.", complete: true },
          ] },
          { type: "meter", log: "story_completed", stats: [
            ["Your live meeting time", "9 minutes", "60 min + a redo + a status call"],
            ["People pulled in", "3", "8"],
            ["Unbilled work", "NZ$0", "NZ$3,800"],
            ["The record", "1 shared version", "3 recollections in 3 inboxes"],
          ] },
          { type: "note", text: "Same people. Same request. The difference is a floor under the process." },
          { type: "continue", text: "The end — almost →" },
        ],
      },
      {
        id: "ep-epilogue",
        heading: "That's the idea.",
        steps: [
          { type: "cta", text: { alex: "You played the provider. Rowan saw every version, every option, every approval — and never your private limits.", rowan: "You played the client. Alex saw every version and approval — and never your private limits." }, buttons: [
            { id: "replay", label: "Play the other side →" },
            { id: "study", label: "Back to the study →" },
            { id: "walkthrough", label: "Prefer plain steps? See the 8-step walkthrough" },
          ] },
        ],
      },
    ],
  };
})();
