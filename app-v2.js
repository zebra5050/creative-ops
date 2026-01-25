import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =============================
   SUPABASE CONFIG
============================= */
const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

/* =============================
   STATE
============================= */
let projects = [];
let currentUser = null;
let searchQuery = "";

const STATUSES = ["Idea", "Planning", "In Progress", "Paused", "Completed"];

/* =============================
   BOOT + UI DEBUG
============================= */
console.log("✅ app-v2.js loaded", new Date().toISOString());

function $(id) { return document.getElementById(id); }

function setBoot(msg) {
  const el = $("bootStatus");
  if (el) el.textContent = msg;
  console.log("[BOOT]", msg);
}

function ensureErrorBanner() {
  if ($("errorBanner")) return;

  const app = $("app");
  if (!app) return;

  const div = document.createElement("div");
  div.id = "errorBanner";
  div.style.display = "none";
  div.style.padding = "10px 20px";
  div.style.margin = "10px 20px";
  div.style.border = "1px solid #ff4d4d";
  div.style.borderRadius = "10px";
  div.innerHTML = `<strong>Something broke:</strong><div id="errorBannerMsg" style="margin-top:6px;"></div>`;

  // Insert near top of app
  app.insertBefore(div, app.children[1] || null);
}

function showError(msg) {
  ensureErrorBanner();
  const wrap = $("errorBanner");
  const text = $("errorBannerMsg");
  if (!wrap || !text) return;
  text.textContent = msg || "Unknown error";
  wrap.style.display = "block";
  console.error("[ERROR BANNER]", msg);
}

function clearError() {
  const wrap = $("errorBanner");
  if (wrap) wrap.style.display = "none";
}

window.addEventListener("error", (e) => {
  showError(String(e.error?.message || e.message || e));
});

window.addEventListener("unhandledrejection", (e) => {
  showError(String(e.reason?.message || e.reason || "Unhandled promise rejection"));
});

/* =============================
   BASIC UI SHOW/HIDE
============================= */
function setLoggedInUI(email) {
  const auth = $("auth");
  const app = $("app");
  if (auth) auth.style.display = "none";
  if (app) app.style.display = "block";
  const statusApp = $("authStatusApp");
  if (statusApp) statusApp.textContent = `Logged in as ${email}`;
}

function setLoggedOutUI() {
  const auth = $("auth");
  const app = $("app");
  if (auth) auth.style.display = "block";
  if (app) app.style.display = "none";
  const statusAuth = $("authStatusAuth");
  if (statusAuth) statusAuth.textContent = "Not logged in";
}

/* =============================
   SUPABASE: PROJECTS
============================= */
async function fetchProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

async function insertProject(project) {
  const { error } = await supabase.from("projects").insert(project);
  if (error) throw error;
}

/* =============================
   RENDER (simple + reliable)
============================= */
function colEl(status) {
  const map = {
    "Idea": "col-idea",
    "Planning": "col-planning",
    "In Progress": "col-inprogress",
    "Paused": "col-paused",
    "Completed": "col-completed"
  };
  return $(map[status]);
}

function clearColumns() {
  for (const s of STATUSES) {
    const c = colEl(s);
    if (c) c.innerHTML = "";
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function matchesSearch(p) {
  const qRaw = (searchQuery || "").trim().toLowerCase();
  if (!qRaw) return true;
  const q = qRaw.startsWith("#") ? qRaw.slice(1) : qRaw;

  const title = String(p.title || "").toLowerCase();
  const medium = String(p.medium || "").toLowerCase();
  const type = String(p.type || "").toLowerCase();
  const tags = Array.isArray(p.tags) ? p.tags.join(" ").toLowerCase() : String(p.tags || "").toLowerCase();

  return title.includes(q) || medium.includes(q) || type.includes(q) || tags.includes(q);
}

function render() {
  clearColumns();

  const list = projects.filter(matchesSearch);

  for (const p of list) {
    const status = STATUSES.includes(p.status) ? p.status : "Idea";
    const col = colEl(status);
    if (!col) continue;

    const bubble = document.createElement("div");
    bubble.className = "project-bubble";
    bubble.innerHTML = `
      <h4>${escapeHtml(p.title || "Untitled")}</h4>
      <p><strong>Type:</strong> ${escapeHtml(p.type || "")}</p>
      <p><strong>Medium:</strong> ${escapeHtml(p.medium || "")}</p>
      <p><strong>Status:</strong> ${escapeHtml(p.status || "")}</p>
    `;

    col.appendChild(bubble);
  }
}

/* =============================
   WIRE BUTTONS DIRECTLY
============================= */
function wireButtons() {
  // Logout
  const logout = $("logoutBtnTop");
  if (logout && !logout.dataset.wired) {
    logout.dataset.wired = "1";
    logout.addEventListener("click", async () => {
      try {
        setBoot("Logging out…");
        await supabase.auth.signOut();
        setBoot("Logged out.");
      } catch (err) {
        showError(err.message || String(err));
      }
    });
  }

  // Add Project (form submit)
  const form = $("project-form");
  if (form && !form.dataset.wired) {
    form.dataset.wired = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try {
        clearError();

        if (!currentUser) {
          showError("No user session found. Try refreshing and logging in again.");
          return;
        }

        const title = ($("title")?.value || "").trim();
        if (!title) return alert("Project title is required.");

        const project = {
          id: Date.now(),
          user_id: currentUser.id,
          title,
          type: ($("type")?.value || "").trim(),
          medium: ($("medium")?.value || "").trim(),
          tags: ($("tags")?.value || "").trim(), // keep simple for now
          status: ($("status")?.value || "Idea").trim(),
          notes: ""
        };

        setBoot("Saving project…");
        await insertProject(project);

        setBoot("Reloading projects…");
        projects = await fetchProjects();

        render();
        form.reset();

        setBoot(`✅ Projects loaded: ${projects.length}`);
      } catch (err) {
        // This is where RLS errors will show clearly
        showError(err.message || String(err));
        setBoot("❌ Save failed (see banner).");
      }
    }, true);
  }

  // Search
  const search = $("searchInput");
  if (search && !search.dataset.wired) {
    search.dataset.wired = "1";
    search.addEventListener("input", () => {
      searchQuery = search.value || "";
      render();
    });
  }
}

/* =============================
   INIT FLOW (tell us exactly what fails)
============================= */
async function bootApp() {
  try {
    ensureErrorBanner();
    clearError();

    setBoot("Checking session…");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    const user = data?.session?.user;
    if (!user) {
      setBoot("No session — showing login.");
      currentUser = null;
      projects = [];
      setLoggedOutUI();
      return;
    }

    currentUser = user;
    setLoggedInUI(user.email || "user");
    wireButtons();

    setBoot(`Session: ✅ ${user.email || user.id}`);

    setBoot("Loading projects…");
    projects = await fetchProjects();

    render();
    setBoot(`✅ Projects loaded: ${projects.length}`);
  } catch (err) {
    showError(err.message || String(err));
    setBoot("❌ Boot failed (see banner).");
  }
}

/* =============================
   PAGE READY
============================= */
function init() {
  setBoot("✅ JS loaded — init()");
  wireButtons();
  bootApp();

  // If mobile suspends/resumes, refresh data
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      bootApp();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}































