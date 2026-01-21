import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("app.js loaded ✅");

const BUCKET = "project-images";

let projects = [];
let currentUser = null;

const STATUSES = ["Idea", "Planning", "In Progress", "Paused", "Completed"];

/* -----------------------------
   Helpers
----------------------------- */
function $(id) { return document.getElementById(id); }

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeExt(filename) {
  const m = filename.toLowerCase().match(/\.(png|jpg|jpeg|webp|gif)$/);
  return m ? m[0] : ".jpg";
}

function imagePath(projectId, filename) {
  return `${currentUser.id}/${projectId}/${filename}`;
}

/* -----------------------------
   Modal
----------------------------- */
function setupImageModal() {
  const modal = $("imgModal");
  const img = $("imgModalImage");
  const cap = $("imgModalCaption");
  const close = $("imgModalClose");

  if (!modal || !img || !cap || !close) return;

  function hide() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    img.src = "";
    cap.textContent = "";
  }

  close.addEventListener("click", hide);
  modal.addEventListener("click", (e) => {
    // click outside inner closes
    if (e.target === modal) hide();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });

  window.__openImageModal = (url, caption = "") => {
    img.src = url;
    cap.textContent = caption || "";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  };
}

/* -----------------------------
   UI
----------------------------- */
function setLoggedInUI(email) {
  $("auth").style.display = "none";
  $("app").style.display = "block";
  $("authStatusApp").textContent = `Logged in as ${email}`;
}

function setLoggedOutUI() {
  $("auth").style.display = "block";
  $("app").style.display = "none";
  $("authStatusAuth").textContent = "Not logged in";
  $("authStatusApp").textContent = "";
}

/* -----------------------------
   Status Bar
----------------------------- */
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
  STATUSES.forEach(s => counts[s] = 0);
  projects.forEach(p => { if (counts[p.status] !== undefined) counts[p.status]++; });

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
   DB: Projects
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

async function deleteProject(projectId) {
  const { error } = await supabase
    .from("projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", currentUser.id);

  if (error) throw error;
}

/* -----------------------------
   DB: Images
   Requires table: project_images(id, user_id, project_id, path, caption, created_at)
----------------------------- */
async function listProjectImages(projectId) {
  const { data, error } = await supabase
    .from("project_images")
    .select("id, path, caption, created_at")
    .eq("user_id", currentUser.id)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Signed URLs so they load even with private bucket
  const rows = data || [];
  const images = [];
  for (const row of rows) {
    const { data: signed, error: sErr } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUrl(row.path, 60 * 60);

    if (sErr) throw sErr;

    images.push({
      id: row.id,
      path: row.path,
      caption: row.caption || "",
      url: signed.signedUrl,
      created_at: row.created_at
    });
  }

  return images;
}

async function uploadProjectImage(projectId, file, caption) {
  const ext = safeExt(file.name);
  const filename = `${Date.now()}_${crypto.randomUUID()}${ext}`;
  const path = imagePath(projectId, filename);

  // Upload to storage
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });

  if (upErr) throw upErr;

  // Insert metadata row
  const { error: dbErr } = await supabase.from("project_images").insert({
    user_id: currentUser.id,
    project_id: projectId,
    path,
    caption: caption || ""
  });

  if (dbErr) throw dbErr;
}

async function deleteProjectImage(imageId, path) {
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
  if (rmErr) throw rmErr;

  const { error: dbErr } = await supabase
    .from("project_images")
    .delete()
    .eq("id", imageId)
    .eq("user_id", currentUser.id);

  if (dbErr) throw dbErr;
}

/* -----------------------------
   Render
----------------------------- */
async function render() {
  const cols = {
    "Idea": $("col-idea"),
    "Planning": $("col-planning"),
    "In Progress": $("col-inprogress"),
    "Paused": $("col-paused"),
    "Completed": $("col-completed")
  };

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

      <details class="notes-details">
        <summary>Notes</summary>
        <textarea class="notes-box" placeholder="Notes...">${escapeHtml(p.notes || "")}</textarea>
      </details>

      <details class="images-details">
        <summary>Images</summary>

        <div class="image-uploader">
          <input class="image-file" type="file" accept="image/*" />
          <input class="image-caption" type="text" placeholder="Caption (optional)" />
          <button class="image-upload-btn" type="button">Upload</button>
        </div>

        <div class="image-grid">
          <div class="image-empty">Loading...</div>
        </div>
      </details>

      <button class="delete-btn" type="button">Delete</button>
    `;

    cols[status].appendChild(bubble);

    // Load images for this bubble
    const grid = bubble.querySelector(".image-grid");
    await refreshImageGrid(p.id, grid);
  }

  updateStatusGraph();
}

async function refreshImageGrid(projectId, gridEl) {
  if (!gridEl) return;

  gridEl.innerHTML = `<div class="image-empty">Loading...</div>`;

  try {
    const images = await listProjectImages(projectId);

    if (images.length === 0) {
      gridEl.innerHTML = `<div class="image-empty">No images yet.</div>`;
      return;
    }

    gridEl.innerHTML = "";

    for (const img of images) {
      const card = document.createElement("div");
      card.className = "image-card";
      const date = img.created_at ? new Date(img.created_at).toLocaleDateString() : "";

      card.innerHTML = `
        <img class="image-thumb" src="${img.url}" alt="Project image" loading="lazy" />
        <div class="image-meta">
          <div class="image-caption-text">${escapeHtml(img.caption || "")}</div>
          <div class="image-date">${date}</div>
        </div>
        <button class="image-delete" type="button" title="Delete image">✕</button>
      `;

      // Click image -> modal
      card.querySelector(".image-thumb").addEventListener("click", (e) => {
        e.stopPropagation();
        window.__openImageModal?.(img.url, img.caption || "");
      });

      // Delete
      card.querySelector(".image-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await deleteProjectImage(img.id, img.path);
          await refreshImageGrid(projectId, gridEl);
        } catch (err) {
          console.error(err);
          alert(err.message || "Delete failed");
        }
      });

      gridEl.appendChild(card);
    }
  } catch (err) {
    console.error(err);
    gridEl.innerHTML = `<div class="image-empty">Couldn’t load images.</div>`;
  }
}

/* -----------------------------
   Events (delegation)
----------------------------- */
document.addEventListener("click", async (e) => {
  // Logout
  if (e.target.closest("#logoutBtnTop")) {
    e.preventDefault();
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
      await render();
    } catch (err) {
      console.error(err);
      alert(err.message || "Delete failed.");
    }
    return;
  }

  // Upload image
  const uploadBtn = e.target.closest(".image-upload-btn");
  if (uploadBtn) {
    const bubble = e.target.closest(".project-bubble");
    const projectId = Number(bubble?.dataset?.projectId);
    if (!projectId) return;

    const fileInput = bubble.querySelector(".image-file");
    const capInput = bubble.querySelector(".image-caption");
    const grid = bubble.querySelector(".image-grid");

    const file = fileInput?.files?.[0];
    if (!file) return alert("Pick an image first.");

    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading...";

    try {
      await uploadProjectImage(projectId, file, capInput?.value?.trim() || "");
      if (fileInput) fileInput.value = "";
      if (capInput) capInput.value = "";
      await refreshImageGrid(projectId, grid);
    } catch (err) {
      console.error(err);
      alert(err.message || "Upload failed.");
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Upload";
    }
  }
});

document.addEventListener("change", async (e) => {
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
    await render();
  } catch (err) {
    console.error(err);
    alert(err.message || "Update failed.");
  }
});

document.addEventListener("input", async (e) => {
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
  }
}, { passive: true });

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("#project-form");
  if (!form) return;

  e.preventDefault();
  e.stopPropagation();

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
    await render();
    form.reset();
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to add project.");
  }
}, true);

/* -----------------------------
   Init
----------------------------- */
async function init() {
  setupImageModal();

  const loginBtn = $("loginBtn");
  const registerBtn = $("registerBtn");

  loginBtn?.addEventListener("click", async () => {
    const email = ($("email")?.value || "").trim();
    const password = $("password")?.value || "";
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
  });

  registerBtn?.addEventListener("click", async () => {
    const email = ($("email")?.value || "").trim();
    const password = $("password")?.value || "";
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) alert(error.message);
    else alert("Registered! You can now log in.");
  });

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = session.user;
      setLoggedInUI(session.user.email || "user");
      projects = await fetchProjects();
      await render();
    } else {
      currentUser = null;
      projects = [];
      setLoggedOutUI();
    }
  });

  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    currentUser = data.session.user;
    setLoggedInUI(currentUser.email || "user");
    projects = await fetchProjects();
    await render();
  } else {
    setLoggedOutUI();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}


























