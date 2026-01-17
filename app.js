import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// -----------------------------
// Supabase config (YOUR VALUES)
// -----------------------------
const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";
const BUCKET = "project-images";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// -----------------------------
// State
// -----------------------------
let projects = [];
let currentUser = null;

const STATUSES = ["Idea", "Planning", "In Progress", "Paused", "Completed"];

// -----------------------------
// Local project storage (per-user)
// -----------------------------
function storageKey() {
  return currentUser ? `creativeops-${currentUser.id}` : null;
}
function saveProjects() {
  if (!currentUser) return;
  localStorage.setItem(storageKey(), JSON.stringify(projects));
}
function loadProjects() {
  if (!currentUser) return;
  const data = localStorage.getItem(storageKey());
  projects = data ? JSON.parse(data) : [];
}

// -----------------------------
// Auth UI
// -----------------------------
function setLoggedInUI(email) {
  document.getElementById("authStatus").textContent = `Logged in as ${email}`;
  document.getElementById("auth").style.display = "none";
  document.getElementById("app").style.display = "block";
}
function setLoggedOutUI() {
  document.getElementById("authStatus").textContent = "Not logged in";
  document.getElementById("auth").style.display = "block";
  document.getElementById("app").style.display = "none";
}

// -----------------------------
// Status bar
// -----------------------------
function updateStatusGraph() {
  const graph = document.getElementById("status-graph");
  if (!graph) return;

  graph.style.width = "100%";
  graph.style.height = "18px";
  graph.style.display = "flex";
  graph.style.borderRadius = "999px";
  graph.style.overflow = "hidden";
  graph.style.border = "1px solid #333";
  graph.style.background = "#1b1b1b";
  graph.innerHTML = "";

  const colors = {
    "Idea": "#9e9e9e",
    "Planning": "#ff9800",
    "In Progress": "#2196f3",
    "Paused": "#ff5722",
    "Completed": "#4caf50"
  };

  const counts = { "Idea": 0, "Planning": 0, "In Progress": 0, "Paused": 0, "Completed": 0 };
  for (const p of projects) if (counts[p.status] !== undefined) counts[p.status]++;

  const total = projects.length;
  if (total === 0) return;

  for (const status of STATUSES) {
    const count = counts[status];
    if (count === 0) continue;

    const seg = document.createElement("div");
    seg.style.width = `${(count / total) * 100}%`;
    seg.style.height = "100%";
    seg.style.background = colors[status];
    seg.style.minWidth = "3px";
    seg.title = `${status}: ${count}`;
    graph.appendChild(seg);
  }
}

// -----------------------------
// Image Modal
// -----------------------------
function setupImageModal() {
  const modal = document.getElementById("imgModal");
  const modalImg = document.getElementById("imgModalImage");
  const modalCap = document.getElementById("imgModalCaption");

  if (!modal || !modalImg || !modalCap) return;

  function close() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    modalImg.src = "";
    modalCap.textContent = "";
  }

  modal.addEventListener("click", close);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  window.__openImageModal = (url, caption = "") => {
    modalImg.src = url;
    modalCap.textContent = caption || "";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  };
}

// -----------------------------
// Supabase Storage + DB helpers
// -----------------------------
function imagePath(projectId, fileName) {
  return `${currentUser.id}/${projectId}/${fileName}`;
}

function safeExt(filename) {
  const m = filename.toLowerCase().match(/\.(png|jpg|jpeg|webp|gif)$/);
  return m ? m[0] : "";
}

async function uploadProjectImage(projectId, file, caption) {
  const ext = safeExt(file.name) || ".jpg";
  const fileName = `${Date.now()}_${crypto.randomUUID()}${ext}`;
  const path = imagePath(projectId, fileName);

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

async function listProjectImages(projectId) {
  const { data, error } = await supabase
    .from("project_images")
    .select("id, path, caption, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const images = await Promise.all((data || []).map(async (row) => {
    const { data: signed, error: sErr } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.path, 60 * 60);
    if (sErr) throw sErr;

    return {
      id: row.id,
      path: row.path,
      url: signed.signedUrl,
      caption: row.caption || "",
      createdAt: row.created_at ? new Date(row.created_at).getTime() : 0
    };
  }));

  return images;
}

async function deleteProjectImage(imageRowId, path) {
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
  if (rmErr) throw rmErr;

  const { error: dbErr } = await supabase.from("project_images").delete().eq("id", imageRowId);
  if (dbErr) throw dbErr;
}

// -----------------------------
// Render images
// -----------------------------
async function refreshImageGrid(projectId, gridEl) {
  if (!gridEl) return;

  gridEl.innerHTML = `<div class="image-empty">Loading...</div>`;

  try {
    if (!currentUser) {
      gridEl.innerHTML = `<div class="image-empty">Log in to view images.</div>`;
      return;
    }

    const images = await listProjectImages(projectId);

    gridEl.innerHTML = "";
    if (images.length === 0) {
      gridEl.innerHTML = `<div class="image-empty">No images yet.</div>`;
      return;
    }

    for (const img of images) {
      const card = document.createElement("div");
      card.className = "image-card";

      const dateStr = img.createdAt ? new Date(img.createdAt).toLocaleDateString() : "";

      card.innerHTML = `
        <img class="image-thumb" src="${img.url}" alt="Project image" />
        <div class="image-meta">
          <div class="image-caption-text">${escapeHtml(img.caption || "")}</div>
          <div class="image-date">${dateStr}</div>
        </div>
        <button class="image-delete" type="button" title="Delete image">✕</button>
      `;

      card.querySelector(".image-thumb").addEventListener("click", (e) => {
        e.stopPropagation();
        if (window.__openImageModal) window.__openImageModal(img.url, img.caption || "");
      });

      card.querySelector(".image-delete").addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await deleteProjectImage(img.id, img.path);
          await refreshImageGrid(projectId, gridEl);
        } catch (err) {
          console.error(err);
          alert(err.message || "Delete failed.");
        }
      });

      gridEl.appendChild(card);
    }
  } catch (err) {
    console.error(err);
    gridEl.innerHTML = `<div class="image-empty">Couldn’t load images. Check policies.</div>`;
  }
}

// -----------------------------
// Render (by status)
// -----------------------------
function render() {
  const cols = {
    "Idea": document.getElementById("col-idea"),
    "Planning": document.getElementById("col-planning"),
    "In Progress": document.getElementById("col-inprogress"),
    "Paused": document.getElementById("col-paused"),
    "Completed": document.getElementById("col-completed")
  };

  if (!cols["Idea"] || !cols["Planning"] || !cols["In Progress"] || !cols["Paused"] || !cols["Completed"]) return;
  for (const key of Object.keys(cols)) cols[key].innerHTML = "";

  projects.forEach(p => {
    const bubble = document.createElement("div");
    bubble.className = "project-bubble";

    const typeTag = p.type ? `<span class="tag">${escapeHtml(p.type)}</span>` : "";
    const mediumLine = p.medium ? `<p><strong>Medium:</strong> ${escapeHtml(p.medium)}</p>` : "";

    bubble.innerHTML = `
      <div class="bubble-title-row">
        <h4>${escapeHtml(p.title)}</h4>
        ${typeTag}
      </div>

      ${mediumLine}

      <label class="status-row">
        <span>Status</span>
        <select class="status-select">
          ${STATUSES.map(s => `<option value="${s}" ${p.status === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </label>

      <details class="project-details">
        <summary>Notes</summary>
        <textarea class="notes-textarea" placeholder="Notes...">${escapeHtml(p.notes || "")}</textarea>
      </details>

      <details class="project-details images-details">
        <summary>Images</summary>
        <div class="image-uploader">
          <input class="image-file" type="file" accept="image/*" />
          <input class="image-caption" type="text" placeholder="Caption (optional)" />
          <button class="image-add-btn" type="button">Upload</button>
        </div>
        <div class="image-grid"></div>
      </details>

      <button class="delete-btn" type="button">Delete</button>
    `;

    bubble.querySelectorAll(".project-details").forEach(d => d.addEventListener("click", e => e.stopPropagation()));

    bubble.querySelector(".status-select").addEventListener("change", e => {
      p.status = e.target.value;
      saveProjects();
      render();
    });

    bubble.querySelector(".notes-textarea").addEventListener("input", e => {
      p.notes = e.target.value;
      saveProjects();
    });

    bubble.querySelector(".delete-btn").addEventListener("click", () => {
      projects = projects.filter(x => x.id !== p.id);
      saveProjects();
      render();
    });

    const grid = bubble.querySelector(".image-grid");
    const fileInput = bubble.querySelector(".image-file");
    const captionInput = bubble.querySelector(".image-caption");
    const uploadBtn = bubble.querySelector(".image-add-btn");

    refreshImageGrid(p.id, grid);

    uploadBtn.addEventListener("click", async () => {
      if (!currentUser) return alert("Please log in first.");

      const file = fileInput.files?.[0];
      if (!file) return alert("Pick an image first.");

      const maxMB = 5;
      if (file.size > maxMB * 1024 * 1024) return alert(`Please use an image under ${maxMB}MB.`);

      uploadBtn.disabled = true;
      uploadBtn.textContent = "Uploading...";

      try {
        await uploadProjectImage(p.id, file, captionInput.value.trim());
        fileInput.value = "";
        captionInput.value = "";
        await refreshImageGrid(p.id, grid);
      } catch (err) {
        console.error(err);
        alert(err.message || "Upload failed. Check bucket + policies.");
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = "Upload";
      }
    });

    (cols[p.status] || cols["Idea"]).appendChild(bubble);
  });

  updateStatusGraph();
}

// -----------------------------
// Boot: auth + initial session + form + logout button
// -----------------------------
document.addEventListener("DOMContentLoaded", async () => {
  setupImageModal();

  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const logoutBtnTop = document.getElementById("logoutBtnTop");

  // Register
  registerBtn.onclick = async () => {
    const { error } = await supabase.auth.signUp({
      email: emailInput.value,
      password: passwordInput.value
    });
    if (error) return alert(error.message);
    alert("Registered! (If confirmations are on, check your email.)");
  };

  // Login
  loginBtn.onclick = async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput.value,
      password: passwordInput.value
    });
    if (error) return alert(error.message);
  };

  // Logout (top-left)
  logoutBtnTop.onclick = async () => {
    await supabase.auth.signOut();
  };

  // Session listener
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      currentUser = session.user;
      setLoggedInUI(session.user.email || "user");
      loadProjects();
      render();
    } else {
      currentUser = null;
      setLoggedOutUI();
    }
  });

  // Initial session
  const { data } = await supabase.auth.getSession();
  if (data?.session?.user) {
    currentUser = data.session.user;
    setLoggedInUI(data.session.user.email || "user");
    loadProjects();
    render();
  } else {
    setLoggedOutUI();
  }

  // Add project
  document.getElementById("project-form").addEventListener("submit", (e) => {
    e.preventDefault();

    projects.push({
      id: Date.now(),
      title: document.getElementById("title").value.trim(),
      type: document.getElementById("type").value.trim(),
      medium: document.getElementById("medium").value.trim(),
      status: document.getElementById("status").value,
      notes: ""
    });

    saveProjects();
    e.target.reset();
    render();
  });
});

// -----------------------------
// Helpers
// -----------------------------
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}



























