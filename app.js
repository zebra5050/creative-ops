import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* =============================
   SUPABASE CONFIG
============================= */
const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BUCKET = "project-images";

console.log("app.js loaded ✅");

/* =============================
   STATE
============================= */
let projects = [];
let currentUser = null;

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

function showCard(el, type, title, bodyHtml) {
  if (!el) return;
  el.style.display = "block";
  el.classList.remove("notice-success", "notice-error", "notice-info");
  el.classList.add(type);

  el.innerHTML = `
    <div class="notice-title">${escapeHtml(title)}</div>
    <div class="notice-body">${bodyHtml || ""}</div>
  `;
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

  // If we’re on register.html, these columns don’t exist.
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

    const grid = bubble.querySelector(".image-grid");
    await refreshImageGrid(p.id, grid);
  }

  updateStatusGraph();
}

/* =============================
   EVENTS (delegation)
============================= */
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

/* =============================
   INIT
============================= */
async function init() {
  console.log("init() running ✅");

  setupImageModal();

  /* -------- Login page (index.html) -------- */
  const loginBtn = $("loginBtn");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
      const email = ($("email")?.value || "").trim();
      const password = $("password")?.value || "";
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    });
  }

  /* -------- Register page (register.html) -------- */
  const registerPageBtn = $("registerPageBtn");
  const resendConfirmBtn = $("resendConfirmBtn");
  const forgotPasswordBtn = $("forgotPasswordBtn");
  const registerCard = $("registerCard");

  if (registerPageBtn) {
    registerPageBtn.addEventListener("click", async () => {
      const email = ($("regEmail")?.value || "").trim();
      const password = $("regPassword")?.value || "";

      if (!email || !password) {
        showCard(registerCard, "notice-error", "Missing info", "Please enter an email and password.");
        return;
      }

      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) {
        showCard(registerCard, "notice-error", "Couldn’t create account", escapeHtml(error.message));
        return;
      }

      // If email confirmations are enabled, user may not have a session yet.
      showCard(
        registerCard,
        "notice-success",
        "Account created!",
        `
          <p>✅ We sent a confirmation email to <strong>${escapeHtml(email)}</strong>.</p>
          <p>Please click the link in that email to verify your account, then return to <a href="index.html">Login</a>.</p>
        `
      );

      // Nice UX: disable create button to prevent spam clicks
      registerPageBtn.disabled = true;
      registerPageBtn.textContent = "Check your email ✉️";
    });
  }

  if (resendConfirmBtn) {
    resendConfirmBtn.addEventListener("click", async () => {
      const email = ($("regEmail")?.value || "").trim();

      if (!email) {
        showCard(registerCard, "notice-error", "Enter your email", "Type your email above so we know where to resend.");
        return;
      }

      const { error } = await supabase.auth.resend({
        type: "signup",
        email
      });

      if (error) {
        showCard(registerCard, "notice-error", "Couldn’t resend", escapeHtml(error.message));
        return;
      }

      showCard(
        registerCard,
        "notice-info",
        "Confirmation resent",
        `<p>📩 We resent the confirmation email to <strong>${escapeHtml(email)}</strong>.</p>`
      );
    });
  }

  if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener("click", async () => {
      const email = ($("regEmail")?.value || "").trim();

      if (!email) {
        showCard(registerCard, "notice-error", "Enter your email", "Type your email above and we’ll send a reset link.");
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        // Change if you later add a dedicated reset page:
        redirectTo: `${window.location.origin}/index.html`
      });

      if (error) {
        showCard(registerCard, "notice-error", "Couldn’t send reset link", escapeHtml(error.message));
        return;
      }

      showCard(
        registerCard,
        "notice-info",
        "Password reset sent",
        `<p>🔐 We sent a password reset email to <strong>${escapeHtml(email)}</strong>.</p>`
      );
    });
  }

  /* -------- Auth state (dashboard only on index.html) -------- */
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

  /* -------- Restore session -------- */
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

/* Run init no matter when script loads */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}



























