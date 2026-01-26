import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =============================
   SUPABASE
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
let currentUser = null;
let projects = [];

const STATUSES = ["Idea", "Planning", "In Progress", "Paused", "Completed"];

/* =============================
   HELPERS
============================= */
const $ = (id) => document.getElementById(id);

function setAuthBoot(msg) {
  if ($("bootStatusAuth")) $("bootStatusAuth").textContent = msg;
  console.log("[AUTH]", msg);
}

function setAppBoot(msg) {
  if ($("bootStatus")) $("bootStatus").textContent = msg;
  console.log("[APP]", msg);
}

function showError(msg) {
  const wrap = $("errorBanner");
  const text = $("errorBannerMsg");
  if (!wrap || !text) return;
  text.textContent = msg;
  wrap.style.display = "block";
  console.error(msg);
}

function clearError() {
  if ($("errorBanner")) $("errorBanner").style.display = "none";
}

function parseTags(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return [];

  const parts = txt
    .replaceAll(",", " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => t.startsWith("#") ? t.slice(1) : t)
    .map(t => t.toLowerCase())
    .filter(Boolean);

  return [...new Set(parts)];
}

/* =============================
   UI STATE
============================= */
function setLoggedInUI(email) {
  $("auth").style.display = "none";
  $("app").style.display = "block";
  $("authStatusApp").textContent = `Logged in as ${email}`;
}

function setLoggedOutUI() {
  $("auth").style.display = "block";
  $("app").style.display = "none";
  $("authStatusAuth").textContent = "Not logged in";
}

/* =============================
   SUPABASE QUERIES
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
   RENDER
============================= */
function clearColumns() {
  const map = {
    "Idea": "col-idea",
    "Planning": "col-planning",
    "In Progress": "col-inprogress",
    "Paused": "col-paused",
    "Completed": "col-completed"
  };
  STATUSES.forEach((s) => {
    const id = map[s];
    if ($(id)) $(id).innerHTML = "";
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function render() {
  clearColumns();

  const map = {
    "Idea": "col-idea",
    "Planning": "col-planning",
    "In Progress": "col-inprogress",
    "Paused": "col-paused",
    "Completed": "col-completed"
  };

  projects.forEach((p) => {
    const colId = map[p.status] || "col-idea";
    const col = $(colId);
    if (!col) return;

    const tagList = Array.isArray(p.tags) ? p.tags : [];

    const bubble = document.createElement("div");
    bubble.className = "project-bubble";
    bubble.innerHTML = `
      <h4>${escapeHtml(p.title || "Untitled")}</h4>
      ${p.type ? `<p><strong>Type:</strong> ${escapeHtml(p.type)}</p>` : ""}
      ${p.medium ? `<p><strong>Medium:</strong> ${escapeHtml(p.medium)}</p>` : ""}
      <p><strong>Status:</strong> ${escapeHtml(p.status || "")}</p>
      ${tagList.length ? `<p><strong>Tags:</strong> ${tagList.map(t => `#${escapeHtml(t)}`).join(" ")}</p>` : ""}
    `;
    col.appendChild(bubble);
  });
}

/* =============================
   ADD PROJECT (FIXED ID)
============================= */
async function handleAddProject() {
  clearError();

  if (!currentUser) {
    alert("You must be logged in.");
    return;
  }

  const title = $("title").value.trim();
  if (!title) {
    alert("Project title is required.");
    return;
  }

  // ✅ If your projects.id column is UUID NOT NULL, we must provide one:
  const project = {
    id: crypto.randomUUID(),        // 👈 FIX
    user_id: currentUser.id,
    title,
    type: $("type").value.trim(),
    medium: $("medium").value.trim(),
    tags: parseTags($("tags").value),
    status: $("status").value,
    notes: ""
  };

  try {
    setAppBoot("Saving project…");
    await insertProject(project);

    projects = await fetchProjects();
    render();

    $("project-form").reset();
    setAppBoot(`✅ Projects loaded: ${projects.length}`);
  } catch (err) {
    showError(err.message);
    setAppBoot("❌ Save failed");
  }
}

/* =============================
   EVENT WIRING
============================= */
function wireProjectForm() {
  const form = $("project-form");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();   // ✅ prevents refresh
    e.stopPropagation();
    await handleAddProject();
  }, true);
}

function wireLogout() {
  const btn = $("logoutBtnTop");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";

  btn.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
}

function wireLogin() {
  const btn = $("loginBtn");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";

  btn.addEventListener("click", async () => {
    clearError();
    const email = $("email").value.trim();
    const password = $("password").value;

    if (!email || !password) {
      alert("Enter email and password");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) showError(error.message);
  });
}

/* =============================
   INIT
============================= */
async function init() {
  setAuthBoot("JS loaded");
  wireLogin();
  wireLogout();
  wireProjectForm();

  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    currentUser = data.session.user;
    setLoggedInUI(currentUser.email);
    projects = await fetchProjects();
    render();
    setAppBoot(`Session restored (${projects.length})`);
  } else {
    setLoggedOutUI();
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = session.user;
      setLoggedInUI(currentUser.email);
      projects = await fetchProjects();
      render();
      setAppBoot(`Session restored (${projects.length})`);
    } else {
      currentUser = null;
      projects = [];
      setLoggedOutUI();
    }
  });
}

document.addEventListener("DOMContentLoaded", init);





























