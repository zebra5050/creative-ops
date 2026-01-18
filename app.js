// ✅ More reliable ESM CDN than esm.sh for production
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =============================
   SUPABASE CONFIG
============================= */
const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("app.js loaded ✅");

/* =============================
   STATE
============================= */
let projects = [];
let currentUser = null;

const STATUSES = ["Idea", "Planning", "In Progress", "Paused", "Completed"];

/* =============================
   UI HELPERS
============================= */
function setLoggedInUI(email) {
  document.getElementById("auth").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("authStatusApp").textContent = `Logged in as ${email}`;
}

function setLoggedOutUI() {
  document.getElementById("auth").style.display = "block";
  document.getElementById("app").style.display = "none";
  document.getElementById("authStatusAuth").textContent = "Not logged in";
  document.getElementById("authStatusApp").textContent = "";
}

/* =============================
   STATUS BAR
============================= */
function updateStatusGraph() {
  const graph = document.getElementById("status-graph");
  if (!graph) return;

  graph.innerHTML = "";
  graph.style.display = "flex";

  const colors = {
    "Idea": "#9e9e9e",
    "Planning": "#ff9800",
    "In Progress": "#2196f3",
    "Paused": "#ff5722",
    "Completed": "#4caf50"
  };

  const counts = {};
  STATUSES.forEach(s => (counts[s] = 0));
  projects.forEach(p => {
    if (counts[p.status] !== undefined) counts[p.status]++;
  });

  const total = projects.length;
  if (total === 0) return;

  for (const status of STATUSES) {
    const c = counts[status];
    if (c === 0) continue;

    const seg = document.createElement("div");
    seg.style.width = `${(c / total) * 100}%`;
    seg.style.height = "100%";
    seg.style.background = colors[status];
    seg.title = `${status}: ${c}`;
    graph.appendChild(seg);
  }
}

/* =============================
   DB HELPERS
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

async function updateProject(project) {
  const { error } = await supabase
    .from("projects")
    .update({ status: project.status, notes: project.notes })
    .eq("id", project.id)
    .eq("user_id", currentUser.id);

  if (error) throw error;
}

async function deleteProject(id) {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", id)
    .eq("user_id", currentUser.id);

  if (error) throw error;
}

/* =============================
   RENDER
============================= */
function render() {
  const cols = {
    "Idea": document.getElementById("col-idea"),
    "Planning": document.getElementById("col-planning"),
    "In Progress": document.getElementById("col-inprogress"),
    "Paused": document.getElementById("col-paused"),
    "Completed": document.getElementById("col-completed")
  };

  for (const key of Object.keys(cols)) cols[key].innerHTML = "";

  for (const p of projects) {
    const status = STATUSES.includes(p.status) ? p.status : "Idea";

    const bubble = document.createElement("div");
    bubble.className = "project-bubble";
    bubble.innerHTML = `
      <h4>${escapeHtml(p.title)}</h4>
      ${p.medium ? `<p><strong>Medium:</strong> ${escapeHtml(p.medium)}</p>` : ""}

      <label>
        Status
        <select class="status-select">
          ${STATUSES.map(s => `<option value="${s}" ${s === status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </label>

      <details>
        <summary>Notes</summary>
        <textarea class="notes-box">${escapeHtml(p.notes || "")}</textarea>
      </details>

      <button class="delete-btn" type="button">Delete</button>
    `;

    bubble.querySelector(".status-select").addEventListener("change", async (e) => {
      p.status = e.target.value.trim();
      await updateProject(p);
      render();
    });

    bubble.querySelector(".notes-box").addEventListener("input", async (e) => {
      p.notes = e.target.value;
      await updateProject(p);
    });

    bubble.querySelector(".delete-btn").addEventListener("click", async () => {
      await deleteProject(p.id);
      projects = projects.filter(x => x.id !== p.id);
      render();
    });

    cols[status].appendChild(bubble);
  }

  updateStatusGraph();
}

/* =============================
   BOOT
============================= */
document.addEventListener("DOMContentLoaded", async () => {
  // --- DOM ---
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const projectForm = document.getElementById("project-form");
  const logoutBtnTop = document.getElementById("logoutBtnTop");

  // --- Auth actions ---
  loginBtn.addEventListener("click", async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value
    });
    if (error) alert(error.message);
  });

  registerBtn.addEventListener("click", async () => {
    const { error } = await supabase.auth.signUp({
      email: emailInput.value.trim(),
      password: passwordInput.value
    });
    if (error) alert(error.message);
    else alert("Registered! You can now log in.");
  });

  logoutBtnTop.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });

  // --- Add project (prevents page reload) ---
  projectForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!currentUser) {
      alert("Please log in first.");
      return;
    }

    const project = {
      id: Date.now(),
      user_id: currentUser.id,
      title: document.getElementById("title").value.trim(),
      type: document.getElementById("type").value.trim(),
      medium: document.getElementById("medium").value.trim(),
      status: document.getElementById("status").value.trim(),
      notes: ""
    };

    if (!project.title) {
      alert("Project title is required.");
      return;
    }

    try {
      await insertProject(project);
      projects = await fetchProjects();
      render();
      projectForm.reset();
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to add project.");
    }
  });

  // --- Auth state ---
  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = session.user;
      setLoggedInUI(session.user.email || "user");

      try {
        projects = await fetchProjects();
      } catch (err) {
        console.error(err);
        projects = [];
      }

      render();
    } else {
      currentUser = null;
      projects = [];
      setLoggedOutUI();
    }
  });

  // --- Restore session on first load ---
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    currentUser = data.session.user;
    setLoggedInUI(currentUser.email || "user");
    projects = await fetchProjects();
    render();
  } else {
    setLoggedOutUI();
  }
});

/* =============================
   HELPERS
============================= */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

























