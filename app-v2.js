import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://pavagjywyubnbmzejojp.supabase.co";
const SUPABASE_KEY = "sb_publishable_XQouTjRTbiSuLsog-ZghGw_x4f9APJy";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null;

function $(id) { return document.getElementById(id); }

function setAuthBoot(msg) {
  const el = $("bootStatusAuth");
  if (el) el.textContent = msg;
  console.log("[AUTH]", msg);
}

function setAppBoot(msg) {
  const el = $("bootStatus");
  if (el) el.textContent = msg;
  console.log("[APP]", msg);
}

function showError(msg) {
  const wrap = $("errorBanner");
  const text = $("errorBannerMsg");
  if (wrap && text) {
    text.textContent = msg || "Unknown error";
    wrap.style.display = "block";
  }
  console.error(msg);
}

function clearError() {
  const wrap = $("errorBanner");
  if (wrap) wrap.style.display = "none";
}

function setLoggedInUI(email) {
  $("auth")?.style && ($("auth").style.display = "none");
  $("app")?.style && ($("app").style.display = "block");
  if ($("authStatusApp")) $("authStatusApp").textContent = `Logged in as ${email}`;
}

function setLoggedOutUI() {
  $("auth")?.style && ($("auth").style.display = "block");
  $("app")?.style && ($("app").style.display = "none");
  if ($("authStatusAuth")) $("authStatusAuth").textContent = "Not logged in";
}

async function doLogin() {
  clearError();
  const email = ($("email")?.value || "").trim();
  const password = $("password")?.value || "";

  if (!email || !password) {
    setAuthBoot("Enter email + password.");
    return alert("Please enter email and password.");
  }

  setAuthBoot("Logging in…");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    setAuthBoot("Login failed.");
    showError(error.message);
    alert(error.message);
    return;
  }

  setAuthBoot("✅ Logged in!");
  const user = data?.user;
  if (user) {
    currentUser = user;
    setLoggedInUI(user.email || "user");
    setAppBoot("✅ Ready.");
  }
}

function wireLogin() {
  const loginBtn = $("loginBtn");
  if (!loginBtn) {
    setAuthBoot("❌ loginBtn not found (ID mismatch).");
    return;
  }

  // Make sure we only wire once
  if (loginBtn.dataset.wired) return;
  loginBtn.dataset.wired = "1";

  loginBtn.addEventListener("click", async () => {
    try {
      await doLogin();
    } catch (err) {
      setAuthBoot("Login crashed.");
      showError(err.message || String(err));
      alert(err.message || String(err));
    }
  });

  // Enter key support
  const email = $("email");
  const pass = $("password");
  [email, pass].forEach((el) => {
    if (!el) return;
    el.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        try { await doLogin(); }
        catch (err) {
          setAuthBoot("Login crashed.");
          showError(err.message || String(err));
          alert(err.message || String(err));
        }
      }
    });
  });

  setAuthBoot("✅ Login wired.");
}

function wireLogout() {
  const logoutBtn = $("logoutBtnTop");
  if (!logoutBtn) return;
  if (logoutBtn.dataset.wired) return;
  logoutBtn.dataset.wired = "1";

  logoutBtn.addEventListener("click", async () => {
    try {
      setAppBoot("Logging out…");
      await supabase.auth.signOut();
      setAppBoot("Logged out.");
    } catch (err) {
      showError(err.message || String(err));
      alert(err.message || String(err));
    }
  });
}

async function boot() {
  setAuthBoot("✅ JS loaded. Checking session…");
  wireLogin();
  wireLogout();

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    setAuthBoot("Session check failed.");
    showError(error.message);
    return;
  }

  const user = data?.session?.user;
  if (user) {
    currentUser = user;
    setLoggedInUI(user.email || "user");
    setAppBoot("✅ Session restored.");
  } else {
    currentUser = null;
    setLoggedOutUI();
    setAuthBoot("Not logged in.");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => boot().catch(e => showError(e.message || String(e))), { once: true });
} else {
  boot().catch(e => showError(e.message || String(e)));
}
































