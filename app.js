import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =============================
   SUPABASE CONFIG
============================= */
const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = "project-images";

let projects = [];
let currentUser = null;
let searchQuery = "";

const STATUSES = ["Idea", "Planning", "In Progress", "Paused", "Completed"];

/* =============================
   HELPERS
============================= */
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

function debounce(fn, wait = 500) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* =============================
   IMAGE MODAL
============================= */
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

/* =============================
   UI
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

  const statusApp = $("authStatusApp");
  if (statusApp) statusApp.textContent = "";
}

/* =============================
   STATUS BAR
============================= */
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

/* =============================
   DB: PROJECTS
============================= */
async function fetchProjects() {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
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
      title: project.title,
      type: project.type,
      medium: project.medium,
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

/* =============================
   DB: IMAGES
============================= */
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
    .upload(path, file, {
      upsert: false,
      contentType: file.type || "image/jpeg"
    });

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

/* =============================
   SEARCH FILTER
============================= */
function getFilteredProjects() {
  const qRaw = searchQuery.trim().toLowerCase();
  if (!qRaw) return projects;

  const q = qRaw.startsWith("#") ? qRaw.slice(1) : qRaw;

  return projects.filter(p => {
    const title = String(p.title || "").toLowerCase();
    const medium = String(p.medium || "").toLowerCase();
    const type = String(p.type || "").toLowerCase();
    const tags = Array.isArray(p.tags) ? p.tags.join(" ").toLowerCase() : "";

    return (
      title.includes(q) ||
      medium.includes(q) ||
      type.includes(q) ||
      tags.includes(q)
    );
  });
}

/* =============================
   RENDER
============================= */
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

    const bubble = document.createElement("div");
    bubble.className = "project-bubble";
    bubble.dataset.projectId = String(p.id);

    const tagsHtml = `
      <div class="tag-row editable-tags">
        ${tags.map(t => `
          <span class="tag-chip editable" data-tag="${escapeHtml(t)}">
            #${escapeHtml(t)}
            <button class="tag-remove" type="button" title="Remove tag">×</button>
          </span>
        `).join("")}
        <input class="tag-input" type="text" placeholder="+ tag" spellcheck="false" />
      </div>
    `;

    bubble.innerHTML = `
      <input class="edit-title" value="${escapeHtml(p.title)}" />

      <div class="edit-row">
        <input class="edit-type" value="${escapeHtml(p.type || "")}" placeholder="Type (optional)" />
        <input class="edit-medium" value="${escapeHtml(p.medium || "")}" placeholder="Medium / tools" />
      </div>

      ${tagsHtml}

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

/* =============================
   MUTATION HELPERS
============================= */
function findProjectFromEventTarget(target) {
  const bubble = target.closest(".project-bubble");
  const id = bubble?.dataset?.projectId;
  if (!id) return null;
  return projects.find(x => String(x.id) === String(id)) || null;
}

const saveProjectDebounced = debounce(async (project) => {
  try {
    await updateProject(project);
  } catch (err) {
    console.error(err);
  }
}, 600);

/* =============================
   EVENTS
============================= */
document.addEventListener("click", async (e) => {
  // Logout
  if (e.target.closest("#logoutBtnTop")) {
    e.preventDefault();
    await supabase.auth.signOut();
    return;
  }

  // Remove tag
  const removeBtn = e.target.closest(".tag-remove");
  if (removeBtn) {
    e.preventDefault();
    e.stopPropagation();

    const tagSpan = removeBtn.closest(".tag-chip");
    const tag = tagSpan?.getAttribute("data-tag");
    const p = findProjectFromEventTarget(removeBtn);
    if (!p || !tag) return;

    p.tags = normalizeTags(p.tags).filter(t => t !== tag);

    try {
      await updateProject(p);
      await render();
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not remove tag.");
    }
    return;
  }

  // Delete project
  const del = e.target.closest(".delete-btn");
  if (del) {
    const p = findProjectFromEventTarget(del);
    if (!p) return;

    try {
      await deleteProject(Number(p.id));
      projects = projects.filter(x => String(x.id) !== String(p.id));
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
    const p = findProjectFromEventTarget(uploadBtn);
    if (!p) return;

    const bubble = uploadBtn.closest(".project-bubble");
    const fileInput = bubble.querySelector(".image-file");
    const capInput = bubble.querySelector(".image-caption");
    const grid = bubble.querySelector(".image-grid");

    const file = fileInput?.files?.[0];
    if (!file) return alert("Pick an image first.");

    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading...";

    try {
      await uploadProjectImage(Number(p.id), file, capInput?.value?.trim() || "");
      if (fileInput) fileInput.value = "";
      if (capInput) capInput.value = "";
      await refreshImageGrid(Number(p.id), grid);
    } catch (err) {
      console.error(err);
      alert(err.message || "Upload failed.");
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Upload";
    }
  }
});

document.addEventListener("keydown", async (e) => {
  // Add tags with Enter
  const tagInput = e.target.closest(".tag-input");
  if (tagInput && e.key === "Enter") {
    e.preventDefault();

    const p = findProjectFromEventTarget(tagInput);
    if (!p) return;

    const newTags = parseTags(tagInput.value);
    if (newTags.length === 0) return;

    p.tags = [...new Set([...normalizeTags(p.tags), ...newTags])];
    tagInput.value = "";

    try {
      await updateProject(p);
      await render();
    } catch (err) {
      console.error(err);
      alert(err.message || "Could not add tag.");
    }
  }

  // Nice mobile UX: Enter on edit fields = blur (save) instead of newline
  if (e.key === "Enter") {
    const isEditField = e.target.closest(".edit-title, .edit-type, .edit-medium");
    if (isEditField) {
      e.preventDefault();
      e.target.blur();
    }
  }
});

document.addEventListener("change", async (e) => {
  // Status change
  const sel = e.target.closest(".status-select");
  if (sel) {
    const p = findProjectFromEventTarget(sel);
    if (!p) return;

    p.status = sel.value.trim();
    try {
      await updateProject(p);
      await render();
    } catch (err) {
      console.error(err);
      alert(err.message || "Update failed.");
    }
  }
});

document.addEventListener("input", async (e) => {
  // Notes autosave
  const notes = e.target.closest(".notes-box");
  if (notes) {
    const p = findProjectFromEventTarget(notes);
    if (!p) return;
    p.notes = notes.value;
    saveProjectDebounced(p);
    return;
  }

  // Inline edit autosave
  const titleInput = e.target.closest(".edit-title");
  const typeInput = e.target.closest(".edit-type");
  const mediumInput = e.target.closest(".edit-medium");
  if (titleInput || typeInput || mediumInput) {
    const p = findProjectFromEventTarget(e.target);
    if (!p) return;

    if (titleInput) p.title = titleInput.value;
    if (typeInput) p.type = typeInput.value;
    if (mediumInput) p.medium = mediumInput.value;

    saveProjectDebounced(p);
    return;
  }

  // Search input
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

/* =============================
   MOBILE UX
============================= */
function setupMobileUX() {
  const jumpToFormBtn = $("jumpToFormBtn");
  const jumpToSearchBtn = $("jumpToSearchBtn");
  const collapseAllBtn = $("collapseAllBtn");

  const form = $("project-form");
  const search = $("searchInput");

  if (jumpToFormBtn && form) {
    jumpToFormBtn.addEventListener("click", () => {
      form.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => $("title")?.focus(), 300);
    });
  }

  if (jumpToSearchBtn && search) {
    jumpToSearchBtn.addEventListener("click", () => {
      search.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => search.focus(), 250);
    });
  }

  if (collapseAllBtn) {
    collapseAllBtn.addEventListener("click", () => {
      document.querySelectorAll("#app details[open]").forEach(d => d.removeAttribute("open"));
    });
  }

  // Optional: within a project bubble, only one details open at a time
  document.addEventListener("toggle", (e) => {
    const details = e.target;
    if (!(details instanceof HTMLDetailsElement)) return;
    if (!details.open) return;

    const bubble = details.closest(".project-bubble");
    if (!bubble) return;

    bubble.querySelectorAll("details").forEach(d => {
      if (d !== details) d.removeAttribute("open");
    });
  }, true);
}

/* =============================
   INIT
============================= */
async function init() {
  setupImageModal();

  // Mobile UX hooks
  setupMobileUX();

  // Login
  const loginBtn = $("loginBtn");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      const email = ($("email")?.value || "").trim();
      const password = $("password")?.value || "";
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    });
  }

  // Auth state
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

  // Restore session
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






























