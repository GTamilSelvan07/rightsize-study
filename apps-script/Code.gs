/**
 * Right-Size Meetings Study — response collector.
 *
 * One-time setup:
 *   1. Create a Google Sheet (any name). Extensions -> Apps Script. Paste this file.
 *   2. In the editor, run initSheets() once (grant permissions when asked).
 *   3. Deploy -> New deployment -> Web app -> Execute as: Me -> Who has access: Anyone.
 *   4. Copy the /exec URL into assets/js/config.js on the site.
 *   5. For AI-tailored questions: Project Settings (gear icon) -> Script Properties ->
 *      Add property: GEMINI_API_KEY = <your Gemini API key>. Without it the survey
 *      quietly falls back to fixed questions.
 *   6. After ANY later edit to this file: Deploy -> Manage deployments -> Edit -> New version.
 *      (Saving alone does NOT update the live URL.)
 */

var TOKEN = "rs-2026-08"; // must match FORM_TOKEN in config.js (anti-spam, not a secret)

var HEADERS = [
  "rid", "created_at", "updated_at", "last_section", "src", "lang", "referrer", "viewport", "ua",
  "a_consent", "a_country", "a_role", "a_company_size", "a_industry", "a_client_facing", "a_meetings_week",
  "a_experience_years", "a_work_mode",
  "a_team_size", "a_decision_authority", "a2_pm_tools", "a2_meeting_platform", "a2_who_runs_meetings",
  "b_tools", "b_freq", "b_uses", "b_notes_followup",
  "c_email_meetings", "c_decision_misremember", "c_lost_actions", "c_worst_meeting",
  "c2_incident_when", "c2_arrived_where", "c2_resolve_time", "c2_costs", "c2_cost_money", "c2_workaround", "c2_freq",
  "d_looks_like_you", "calc_meetings", "calc_attendees", "calc_length", "calc_cost_band", "calc_share",
  "calc_hours_month", "calc_money_month",
  "e_demo_option", "e_demo_seconds", "e_demo_steps_done", "e_demo_completed", "e_full_demo_clicked", "e_clarity",
  "ai_q1", "ai_a1", "ai_q2", "ai_a2", "ai_gen_ok",
  "f_value", "f_most_valuable", "f_least_valuable", "f_concern", "f_solves_problem", "f_blocker",
  "g_vw_too_cheap", "g_vw_bargain", "g_vw_expensive", "g_vw_too_expensive", "g_vw_order_ok",
  "g_pilot_500", "g_pilot_approver",
  "h_email", "h_interview", "h_pilot", "h_referral",
  "demo_full_opened", "demo_full_route", "demo_full_option", "demo_full_completed",
  "story_opened", "story_role", "story_act1_choice1", "story_act1_choice2",
  "story_limits_set", "story_option", "story_edit_loop_seen", "story_notmine_seen",
  "story_completed", "story_replay_clicked", "story_replay_role",
  "story_walkthrough_clicked", "story_seconds",
  "t_seconds_total", "t_sections_json"
];
// demo_full_* now refers to the step-by-step walkthrough page; story_* is the
// playable-episode demo; ai_* holds the AI-tailored follow-up questions and answers.

/** Run once from the editor to create/repair the two tabs with header rows. */
function initSheets() {
  var ss = SpreadsheetApp.getActive();
  var events = ss.getSheetByName("events") || ss.insertSheet("events");
  var responses = ss.getSheetByName("responses") || ss.insertSheet("responses");
  events.getRange(1, 1, 1, 6).setValues([["ts", "rid", "section", "seq", "payload_json", "ua"]]);
  responses.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  events.setFrozenRows(1);
  responses.setFrozenRows(1);
}

function doGet() {
  return out({ ok: true, ping: true });
}

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    // Honeypot: bots fill the hidden "website" field. Answer ok so they move on.
    if (p.data && p.data.website) return out({ ok: true });
    if (p.token !== TOKEN) return out({ ok: false, err: "bad token" });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(p.rid || ""))) {
      return out({ ok: false, err: "bad rid" });
    }
    if (p.action === "aiq") return handleAiq(p);
    if (typeof p.section !== "string" || typeof p.data !== "object" || p.data === null) {
      return out({ ok: false, err: "bad payload" });
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var ss = SpreadsheetApp.getActive();
      ss.getSheetByName("events").appendRow([
        new Date(), p.rid, p.section, p.seq || 0,
        JSON.stringify(p.data).slice(0, 30000), String(p.ua || "").slice(0, 300)
      ]);
      upsert(ss.getSheetByName("responses"), p);
    } finally {
      lock.releaseLock();
    }
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, err: String(err) });
  }
}

function upsert(sheet, p) {
  var found = sheet.getRange("A:A").createTextFinder(p.rid).matchEntireCell(true).findNext();
  var row;
  if (found) {
    row = found.getRow();
  } else {
    row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1).setValue(p.rid);
    sheet.getRange(row, HEADERS.indexOf("created_at") + 1).setValue(new Date());
  }
  sheet.getRange(row, HEADERS.indexOf("updated_at") + 1).setValue(new Date());
  sheet.getRange(row, HEADERS.indexOf("last_section") + 1).setValue(p.section);
  for (var key in p.data) {
    var col = HEADERS.indexOf(key);
    if (col < 1) continue; // unknown keys ignored; col 0 (rid) never overwritten
    var val = p.data[key];
    if (Array.isArray(val)) val = val.join(";");
    sheet.getRange(row, col + 1).setValue(typeof val === "string" ? val.slice(0, 5000) : val);
  }
}

/**
 * AI-tailored follow-up questions. Requires a Gemini API key stored in
 * Project Settings -> Script Properties -> GEMINI_API_KEY (never in client JS).
 * The client falls back to fixed questions when this returns ok:false.
 */
function handleAiq(p) {
  var key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) return out({ ok: false, err: "no key configured" });
  var ctx = p.context && typeof p.context === "object" ? p.context : {};
  var brief = JSON.stringify(ctx).slice(0, 2000);

  var prompt =
    "You help run an anonymous workplace research survey about meetings and " +
    "decisions. Based on this respondent's earlier answers (JSON below), write " +
    "exactly 2 follow-up questions personalised to their situation.\n" +
    "Rules: warm and conversational; each question under 160 characters; open-ended " +
    "(not yes/no); reference their role, industry, tools or the incident they " +
    "described when relevant; NEVER ask about health, protected characteristics, " +
    "named people, employers' identities, salaries, or anything sensitive; no " +
    "preamble.\nRespond ONLY with a JSON array of 2 strings.\n\nRespondent context:\n" + brief;

  try {
    var res = UrlFetchApp.fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "post",
        contentType: "application/json",
        headers: { "x-goog-api-key": key },
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
        }),
        muteHttpExceptions: true,
      }
    );
    if (res.getResponseCode() !== 200) return out({ ok: false, err: "llm http " + res.getResponseCode() });
    var body = JSON.parse(res.getContentText());
    var text = ((body.candidates || [])[0] || {}).content;
    text = ((text || {}).parts || [])[0];
    text = (text || {}).text || "";
    var m = text.match(/\[[\s\S]*\]/);
    var questions = m ? JSON.parse(m[0]) : null;
    if (!Array.isArray(questions) || questions.length < 2) return out({ ok: false, err: "bad llm output" });
    questions = questions.slice(0, 2).map(function (q) { return String(q).slice(0, 200); });

    // Cache into the response row so the sheet shows what was asked.
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var ss = SpreadsheetApp.getActive();
      ss.getSheetByName("events").appendRow([new Date(), p.rid, "aiq", 0,
        JSON.stringify({ questions: questions }).slice(0, 30000), String(p.ua || "").slice(0, 300)]);
      upsert(ss.getSheetByName("responses"),
        { rid: p.rid, section: "aiq", data: { ai_q1: questions[0], ai_q2: questions[1], ai_gen_ok: true } });
    } finally {
      lock.releaseLock();
    }
    return out({ ok: true, questions: questions });
  } catch (err) {
    return out({ ok: false, err: String(err) });
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
