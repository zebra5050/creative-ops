import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = "project-images";

console.log("app.js loaded ✅");

let projects = [];
let currentUser = null;
let searchQuery = "";

const STATUSES = ["Idea", "Planning", "In Progress", "Paused", "Completed"];

/* ---------- helpers ---------- */
function $(id) { return document.getElementById(id); }

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeExt(filename) {
  const m = String(filename || "").toLowerCase().match(/\.(png|jpg|jpeg|webp|gif)$/);
  return m ? m[0] : ".jpg";
}

function imagePath(projectId, filename) {
  return `${currentUser.id}/${projectId}/${filename}`;
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

function normalizeTags(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") return parseTags(value);
  return [];
}

/* ---------- modal ---------- */
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
  modal.addEventListener("click", (e) => { if (e.target === modal) hide(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });

  window.__openImageModal = (url, caption = "") => {
    img.src = url;
    cap.textContent = caption || "";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  };
}

/* ---------- ui ---------- */
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

/* ---------- status graph ---------- */
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

/* ---------- db projects ---------- */
async function fetchProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  // normalize tags so render always shows them
  return (data || []).map(p => ({ ...p, tags: normalizeTags(p.tags) }));
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
      notes: project.notes,
      tags: project.tags || []
    })
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

/* ---------- db images ---------- */
async function listProjectImages(projectId) {
  const { data, error } = await supabase
    .from("project_images")
    .select("id, path, caption, created_at")
    .eq("user_id", currentUser.id)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw error;

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

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || "image/jpeg" });

  if (upErr) throw upErr;

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

/* ---------- search ---------- */
function getFilteredProjects() {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return projects;

  const needle = q.startsWith("#") ? q.slice(1) : q;

  return projects.filter(p => {
    const title = String(p.title || "").toLowerCase();
    const medium = String(p.medium || "").toLowerCase();
    const type = String(p.type || "").toLowerCase();
    const tags = Array.isArray(p.tags) ? p.tags.join(" ").toLowerCase() : "";

    return (
      title.includes(needle) ||
      medium.includes(needle) ||
      type.includes(needle) ||
      tags.includes(needle)
    );
  });
}

/* ---------- render ---------- */
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

      card.querySelector(".image-thumb").addEventListener("click", (e) => {
        e.stopPropagation();
        window.__openImageModal?.(img.url, img.caption || "");
      });

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

  const list = getFilteredProjects();

  for (const p of list) {
    const status = STATUSES.includes(p.status) ? p.status : "Idea";
    const tags = normalizeTags(p.tags);

    const tagHtml = tags.length
      ? `<div class="tag-row">
          ${tags.map(t => `<span class="tag-chip" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</span>`).join("")}
         </div>`
      : "";

    const bubble = document.createElement("div");
    bubble.className = "project-bubble";
    bubble.dataset.projectId = String(p.id);

    bubble.innerHTML = `
      <h4>${escapeHtml(p.title)}</h4>
      ${p.medium ? `<p><strong>Medium:</strong> ${escapeHtml(p.medium)}</p>` : ""}
      ${tagHtml}

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

    const grid = bubble.querySelector(".image-grid");
    await refreshImageGrid(p.id, grid);
  }

  updateStatusGraph();
}

/* ---------- events ---------- */
document.addEventListener("click", async (e) => {
  // logout
  if (e.target.closest("#logoutBtnTop")) {
    e.preventDefault();
    await supabase.auth.signOut();
    return;
  }

  // clicking a tag chip => search it
  const chip = e.target.closest(".tag-chip");
  if (chip) {
    const t = chip.getAttribute("data-tag");
    const search = $("searchInput");
    if (search) {
      search.value = `#${t}`;
      searchQuery = `#${t}`;
      await render();
    }
    return;
  }

  // delete project
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

  // upload image
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
  if (notes) {
    const bubble = e.target.closest(".project-bubble");
    const id = bubble?.dataset?.projectId;
    if (!id) return;

    const p = projects.find(x => String(x.id) === String(id));
    if (!p) return;

    p.notes = notes.value;
    try { await updateProject(p); } catch {}
    return;
  }

  if (e.target?.id === "searchInput") {
    searchQuery = e.target.value || "";
    await render();
  }
}, { passive: true });

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("#project-form");
  if (!form) return;

  e.preventDefault();
  e.stopPropagation();

  if (!currentUser) return alert("Please log in first.");

  const project = {
    id: Date.now(),
    user_id: currentUser.id,
    title: ($("title")?.value || "").trim(),
    type: ($("type")?.value || "").trim(),
    medium: ($("medium")?.value || "").trim(),
    tags: parseTags(($("tags")?.value || "")),
    status: ($("status")?.value || "Idea").trim(),
    notes: ""
  };

  if (!project.title) return alert("Project title is required.");

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

/* ---------- init ---------- */
async function init() {
  setupImageModal();

  const search = $("searchInput");
  if (search) {
    search.addEventListener("input", async () => {
      searchQuery = search.value || "";
      await render();
    });
  }

  const loginBtn = $("loginBtn");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      const email = ($("email")?.value || "").trim();
      const password = $("password")?.value || "";
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    });
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = session.user;
      if ($("project-form")) {
        setLoggedInUI(session.user.email || "user");
        projects = await fetchProjects();
        await render();
      }
    } else {
      currentUser = null;
      projects = [];
      if ($("project-form")) setLoggedOutUI();
    }
  });

  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    currentUser = data.session.user;
    if ($("project-form")) {
      setLoggedInUI(currentUser.email || "user");
      projects = await fetchProjects();
      await render();
    }
  } else {
    if ($("project-form")) setLoggedOutUI();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}





























