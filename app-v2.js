import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =============================
   SUPABASE
============================= */
const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";
const BUCKET = "project-images";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

/* =============================
   STATE
============================= */
let currentUser = null;
let projects = [];
let searchQuery = "";

const STATUSES = ["Idea", "Planning", "In Progress", "Paused", "Completed"];
const STATUS_TO_COL = {
  "Idea": "col-idea",
  "Planning": "col-planning",
  "In Progress": "col-inprogress",
  "Paused": "col-paused",
  "Completed": "col-completed"
};

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

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

function matchesSearch(p) {
  const qRaw = (searchQuery || "").trim().toLowerCase();
  if (!qRaw) return true;
  const q = qRaw.startsWith("#") ? qRaw.slice(1) : qRaw;

  const title = String(p.title || "").toLowerCase();
  const medium = String(p.medium || "").toLowerCase();
  const type = String(p.type || "").toLowerCase();
  const tags = Array.isArray(p.tags) ? p.tags.join(" ").toLowerCase() : "";

  return title.includes(q) || medium.includes(q) || type.includes(q) || tags.includes(q);
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
   STATUS BAR
============================= */
function updateStatusGraph() {
  const graph = $("status-graph");
  if (!graph) return;

  graph.innerHTML = "";

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
    if (c === 0) continue; // ✅ hide colors with no projects
    const seg = document.createElement("div");
    seg.className = "status-bar";
    seg.style.width = `${(c / total) * 100}%`;
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
  return (data || []).map(p => ({ ...p, tags: Array.isArray(p.tags) ? p.tags : [] }));
}

async function insertProject(project) {
  const { error } = await supabase.from("projects").insert(project);
  if (error) throw error;
}

async function updateProject(projectId, updates) {
  const { error } = await supabase
    .from("projects")
    .update(updates)
    .eq("id", projectId)
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
function imagePath(projectId, filename) {
  return `${currentUser.id}/${projectId}/${filename}`;
}

function safeExt(filename) {
  const m = String(filename || "").toLowerCase().match(/\.(png|jpg|jpeg|webp|gif)$/);
  return m ? m[0] : ".jpg";
}

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
      created_at: row.created_at,
      url: signed.signedUrl
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
   RENDER
============================= */
function clearColumns() {
  Object.values(STATUS_TO_COL).forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = "";
  });
}

async function render() {
  clearColumns();

  const list = projects.filter(matchesSearch);

  for (const p of list) {
    const status = STATUSES.includes(p.status) ? p.status : "Idea";
    const col = $(STATUS_TO_COL[status]);
    if (!col) continue;

    const bubble = document.createElement("div");
    bubble.className = "project-bubble";
    bubble.dataset.projectId = String(p.id);

    const tagChips = (p.tags || []).map(t => `<span class="tag-chip">#${escapeHtml(t)}</span>`).join(" ");

    bubble.innerHTML = `
      <div class="project-header">
        <input class="edit-title" value="${escapeHtml(p.title || "")}" />
        <button class="delete-btn" type="button">Delete</button>
      </div>

      <div class="edit-row">
        <input class="edit-type" value="${escapeHtml(p.type || "")}" placeholder="Type (optional)" />
        <input class="edit-medium" value="${escapeHtml(p.medium || "")}" placeholder="Medium / tools" />
      </div>

      <div class="tag-row">
        ${tagChips || `<span style="opacity:.7;">No tags</span>`}
        <input class="tag-input" type="text" placeholder="+ add tags (ex: #art #webdev)" />
      </div>

      <label>
        Status
        <select class="status-select">
          ${STATUSES.map(s => `<option value="${s}" ${s === status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </label>

      <details class="notes-details">
        <summary>Notes</summary>
        <textarea class="notes-box" placeholder="Write notes here…">${escapeHtml(p.notes || "")}</textarea>
      </details>

      <details class="images-details">
        <summary>Images</summary>

        <div class="image-uploader">
          <input class="image-file" type="file" accept="image/*" />
          <input class="image-caption" type="text" placeholder="Caption (optional)" />
          <button class="image-upload-btn" type="button">Upload</button>
        </div>

        <div class="image-grid"><div class="image-empty">Loading…</div></div>
      </details>
    `;

    col.appendChild(bubble);

    // Load images for this project
    const grid = bubble.querySelector(".image-grid");
    try {
      const imgs = await listProjectImages(p.id);
      if (imgs.length === 0) {
        grid.innerHTML = `<div class="image-empty">No images yet.</div>`;
      } else {
        grid.innerHTML = "";
        for (const img of imgs) {
          const card = document.createElement("div");
          card.className = "image-card";

          const date = img.created_at ? new Date(img.created_at).toLocaleDateString() : "";

          card.innerHTML = `
            <img class="image-thumb" src="${img.url}" alt="Project image" loading="lazy" />
            <div class="image-meta">
              <div class="image-caption-text">${escapeHtml(img.caption || "")}</div>
              <div class="image-date">${escapeHtml(date)}</div>
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
              await refreshAndRender();
            } catch (err) {
              showError(err.message || String(err));
            }
          });

          grid.appendChild(card);
        }
      }
    } catch (err) {
      grid.innerHTML = `<div class="image-empty">Couldn’t load images.</div>`;
    }
  }

  updateStatusGraph();
}

/* =============================
   REFRESH + RENDER
============================= */
async function refreshAndRender() {
  projects = await fetchProjects();
  await render();
  setAppBoot(`✅ Projects loaded: ${projects.length}`);
}

/* =============================
   EVENTS
============================= */
function wireProjectForm() {
  const form = $("project-form");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearError();

    if (!currentUser) return alert("You must be logged in.");

    const title = $("title").value.trim();
    if (!title) return alert("Project title is required.");

    const project = {
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
      await refreshAndRender();
      form.reset();
    } catch (err) {
      showError(err.message || String(err));
    }
  }, true);
}

function wireDashboardInteractions() {
  // Click handlers for delete + upload
  document.addEventListener("click", async (e) => {
    const bubble = e.target.closest(".project-bubble");
    if (!bubble) return;

    const projectId = Number(bubble.dataset.projectId);

    // Delete project
    if (e.target.classList.contains("delete-btn")) {
      try {
        await deleteProject(projectId);
        await refreshAndRender();
      } catch (err) {
        showError(err.message || String(err));
      }
      return;
    }

    // Upload image
    if (e.target.classList.contains("image-upload-btn")) {
      const fileInput = bubble.querySelector(".image-file");
      const capInput = bubble.querySelector(".image-caption");
      const file = fileInput?.files?.[0];
      if (!file) return alert("Pick an image first.");

      e.target.disabled = true;
      e.target.textContent = "Uploading…";

      try {
        await uploadProjectImage(projectId, file, capInput?.value?.trim() || "");
        if (fileInput) fileInput.value = "";
        if (capInput) capInput.value = "";
        await refreshAndRender();
      } catch (err) {
        showError(err.message || String(err));
      } finally {
        e.target.disabled = false;
        e.target.textContent = "Upload";
      }
      return;
    }
  });

  // Input handlers for edits (title/type/medium/notes) saved on blur
  document.addEventListener("blur", async (e) => {
    const bubble = e.target.closest(".project-bubble");
    if (!bubble) return;

    const projectId = Number(bubble.dataset.projectId);

    const titleEl = bubble.querySelector(".edit-title");
    const typeEl = bubble.querySelector(".edit-type");
    const medEl = bubble.querySelector(".edit-medium");
    const notesEl = bubble.querySelector(".notes-box");

    const updates = {
      title: titleEl?.value?.trim() || "",
      type: typeEl?.value?.trim() || "",
      medium: medEl?.value?.trim() || "",
      notes: notesEl?.value || ""
    };

    try {
      await updateProject(projectId, updates);
    } catch (err) {
      showError(err.message || String(err));
    }
  }, true);

  // Status change
  document.addEventListener("change", async (e) => {
    if (!e.target.classList.contains("status-select")) return;
    const bubble = e.target.closest(".project-bubble");
    if (!bubble) return;
    const projectId = Number(bubble.dataset.projectId);

    try {
      await updateProject(projectId, { status: e.target.value });
      await refreshAndRender();
    } catch (err) {
      showError(err.message || String(err));
    }
  });

  // Add tags on Enter
  document.addEventListener("keydown", async (e) => {
    if (!e.target.classList.contains("tag-input")) return;
    if (e.key !== "Enter") return;

    e.preventDefault();

    const bubble = e.target.closest(".project-bubble");
    if (!bubble) return;
    const projectId = Number(bubble.dataset.projectId);

    const add = parseTags(e.target.value);
    if (add.length === 0) return;

    const p = projects.find(x => Number(x.id) === projectId);
    const existing = Array.isArray(p?.tags) ? p.tags : [];
    const merged = [...new Set([...existing, ...add])];

    try {
      await updateProject(projectId, { tags: merged });
      e.target.value = "";
      await refreshAndRender();
    } catch (err) {
      showError(err.message || String(err));
    }
  });
}

function wireSearch() {
  const s = $("searchInput");
  if (!s || s.dataset.wired) return;
  s.dataset.wired = "1";

  s.addEventListener("input", async () => {
    searchQuery = s.value || "";
    await render();
  });
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
    if (!email || !password) return alert("Enter email and password");

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) showError(error.message);
  });
}

/* =============================
   INIT
============================= */
async function init() {
  setAuthBoot("JS loaded");

  setupImageModal();
  wireLogin();
  wireLogout();
  wireProjectForm();
  wireDashboardInteractions();
  wireSearch();

  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    currentUser = data.session.user;
    setLoggedInUI(currentUser.email);
    await refreshAndRender();
    setAppBoot("Session restored");
  } else {
    setLoggedOutUI();
    setAuthBoot("Not logged in");
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      currentUser = session.user;
      setLoggedInUI(currentUser.email);
      await refreshAndRender();
      setAppBoot("Session restored");
    } else {
      currentUser = null;
      projects = [];
      setLoggedOutUI();
      setAuthBoot("Logged out");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);






























