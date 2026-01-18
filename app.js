import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("app.js loaded ✅");

let projects = [];
let currentUser = null;

const STATUSES = ["Idea", "Planning", "In Progress", "Paused", "Completed"];

/* -----------------------------
   Helpers
----------------------------- */
function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/* -----------------------------
   UI
----------------------------- */
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

  const statusApp = $("authStatusApp");
  if (statusApp) statusApp.textContent = "";
}

function updateStatusGraph() {
  const graph = $("status-graph");
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

/* -----------------------------
   DB
----------------------------- */
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

/* -----------------------------
   Render
----------------------------- */
function render() {
  const cols = {
    "Idea": $("col-idea"),
    "Planning": $("col-planning"),
    "In Progress": $("col-inprogress"),
    "Paused": $("col-paused"),
    "Completed": $("col-completed")
  };

  // If columns aren't on the page yet, don't crash—just bail.
  for (const k of Object.keys(cols)) {
    if (!cols[k]) return;
    cols[k].innerHTML = "";
  }

  for (const p of projects) {
    const status = STATUSES.includes(p.status) ? p.status : "Idea";

    const bubble = document.createElement("div");
    bubble.className = "project-bubble";
    bubble.dataset.projectId = String(p.id);

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
        <textarea class="notes-box" placeholder="Notes...">${escapeHtml(p.notes || "")}</textarea>
      </details>

      <button class="delete-btn" type="button">Delete</button>
    `;

    cols[status].appendChild(bubble);
  }

  updateStatusGraph();
}

/* -----------------------------
   Event Delegation
   (prevents “buttons dead” issues)
----------------------------- */
document.addEventListener("click", async (e) => {
  // Logout
  const logoutBtn = e.target.closest("#logoutBtnTop");
  if (logoutBtn) {
    e.preventDefault();
    console.log("Logout clicked");
    await supabase.auth.signOut();
    return;
  }

  // Delete project
  const del = e.target.closest(".delete-btn");
  if (del) {
    const bubble = e.target.closest(".project-bubble");
    const id = bubble?.dataset?.projectId;
    if (!id) return;

    try {
      await deleteProject(Number(id));
      projects = projects.filter(p => String(p.id) !== String(id));
      render();
    } catch (err) {
      console.error(err);
      alert(err.message || "Delete failed.");
    }
  }
});

document.addEventListener("change", async (e) => {
  // Status change
  const sel = e.target.closest(".status-select");
  if (!sel) return;

  const bubble = e.target.closest(".project-bubble");
  const id = bubble?.dataset?.projectId;
  if (!id) return;

  const p = projects.find(x => String(x.id) === String(id));
  if (!p) return;

  p.status = sel.value.trim();

  try {
    await updateProject(p);
    render();
  } catch (err) {
    console.error(err);
    alert(err.message || "Update failed.");
  }
});

document.addEventListener("input", async (e) => {
  // Notes typing (simple version: saves on every input)
  const notes = e.target.closest(".notes-box");
  if (!notes) return;

  const bubble = e.target.closest(".project-bubble");
  const id = bubble?.dataset?.projectId;
  if (!id) return;

  const p = projects.find(x => String(x.id) === String(id));
  if (!p) return;

  p.notes = notes.value;

  try {
    await updateProject(p);
  } catch (err) {
    console.error(err);
    // don’t alert on every keystroke
  }
}, { passive: true });

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("#project-form");
  if (!form) return;

  e.preventDefault();
  e.stopPropagation();
  console.log("Project form submitted");

  if (!currentUser) {
    alert("Please log in first.");
    return;
  }

  const project = {
    id: Date.now(),
    user_id: currentUser.id,
    title: ($("title")?.value || "").trim(),
    type: ($("type")?.value || "").trim(),
    medium: ($("medium")?.value || "").trim(),
    status: ($("status")?.value || "Idea").trim(),
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
    form.reset();
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to add project.");
  }
}, true); // capture=true makes this extra reliable

/* -----------------------------
   Init (runs even if DOM is already ready)
----------------------------- */
async function init() {
  console.log("init() running ✅");

  // Auth buttons (if present)
  const loginBtn = $("loginBtn");
  const registerBtn = $("registerBtn");

  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      const email = ($("email")?.value || "").trim();
      const password = $("password")?.value || "";
      console.log("Login clicked");

      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    });
  }

  if (registerBtn) {
    registerBtn.addEventListener("click", async () => {
      const email = ($("email")?.value || "").trim();
      const password = $("password")?.value || "";
      console.log("Register clicked");

      const { error } = await supabase.auth.signUp({ email, password });
      if (error) alert(error.message);
      else alert("Registered! You can now log in.");
    });
  }

  // Auth state
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

  // Initial session restore
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    currentUser = data.session.user;
    setLoggedInUI(currentUser.email || "user");
    projects = await fetchProjects();
    render();
  } else {
    setLoggedOutUI();
  }
}

// Run init whether DOMContentLoaded already fired or not
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

























