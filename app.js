import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* =============================
   SUPABASE CONFIG
============================= */
const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";
const BUCKET = "project-images";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* =============================
   STATE
============================= */
let projects = [];
let currentUser = null;

const STATUSES = ["Idea", "Planning", "In Progress", "Paused", "Completed"];

/* =============================
   AUTH UI
============================= */
function setLoggedInUI(email) {
  document.getElementById("auth").style.display = "none";
  document.getElementById("app").style.display = "block";
  document.getElementById("authStatus").textContent = `Logged in as ${email}`;
}

function setLoggedOutUI() {
  document.getElementById("auth").style.display = "block";
  document.getElementById("app").style.display = "none";
  document.getElementById("authStatus").textContent = "Not logged in";
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
  STATUSES.forEach(s => counts[s] = 0);
  projects.forEach(p => {
    if (counts[p.status] !== undefined) counts[p.status]++;
  });

  const total = projects.length;
  if (total === 0) return;

  STATUSES.forEach(status => {
    if (counts[status] === 0) return;

    const seg = document.createElement("div");
    seg.style.width = `${(counts[status] / total) * 100}%`;
    seg.style.background = colors[status];
    seg.style.height = "100%";
    graph.appendChild(seg);
  });
}

/* =============================
   PROJECT DB FUNCTIONS
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
    .update({
      status: project.status,
      notes: project.notes
    })
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

  Object.values(cols).forEach(col => col.innerHTML = "");

  projects.forEach(p => {
    const normalizedStatus = STATUSES.includes(p.status)
      ? p.status
      : "Idea";

    const bubble = document.createElement("div");
    bubble.className = "project-bubble";

    bubble.innerHTML = `
      <h4>${escapeHtml(p.title)}</h4>

      ${p.medium ? `<p><strong>Medium:</strong> ${escapeHtml(p.medium)}</p>` : ""}

      <label>Status:
        <select class="status-select">
          ${STATUSES.map(s =>
            `<option ${normalizedStatus === s ? "selected" : ""}>${s}</option>`
          ).join("")}
        </select>
      </label>

      <details>
        <summary>Notes</summary>
        <textarea>${escapeHtml(p.notes || "")}</textarea>
      </details>

      <button class="delete-btn">Delete</button>
    `;

    /* Status change */
    bubble.querySelector(".status-select").onchange = async (e) => {
      p.status = e.target.value.trim();
      await updateProject(p);
      render();
    };

    /* Notes change */
    bubble.querySelector("textarea").oninput = async (e) => {
      p.notes = e.target.value;
      await updateProject(p);
    };

    /* Delete */
    bubble.querySelector(".delete-btn").onclick = async () => {
      await deleteProject(p.id);
      projects = projects.filter(x => x.id !== p.id);
      render();
    };

    cols[normalizedStatus].appendChild(bubble);
  });

  updateStatusGraph();
}

/* =============================
   BOOT
============================= */
document.addEventListener("DOMContentLoaded", async () => {
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const logoutBtn = document.getElementById("logoutBtnTop");

  loginBtn.onclick = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput.value.trim(),
      password: passwordInput.value
    });
    if (error) alert(error.message);
  };

  registerBtn.onclick = async () => {
    const { error } = await supabase.auth.signUp({
      email: emailInput.value.trim(),
      password: passwordInput.value
    });
    if (error) alert(error.message);
    else alert("Registered! You can now log in.");
  };

  logoutBtn.onclick = async () => {
    await supabase.auth.signOut();
  };

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = session.user;
      setLoggedInUI(session.user.email);
      projects = await fetchProjects();
      render();
    } else {
      currentUser = null;
      projects = [];
      setLoggedOutUI();
    }
  });

  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    currentUser = data.session.user;
    setLoggedInUI(currentUser.email);
    projects = await fetchProjects();
    render();
  }

  document.getElementById("project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser) return alert("Please log in.");

    const project = {
      id: Date.now(),
      user_id: currentUser.id,
      title: document.getElementById("title").value.trim(),
      type: document.getElementById("type").value.trim(),
      medium: document.getElementById("medium").value.trim(),
      status: document.getElementById("status").value.trim(),
      notes: ""
    };

    if (!project.title) return alert("Title required.");

    await insertProject(project);
    projects = await fetchProjects();
    e.target.reset();
    render();
  });
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


























