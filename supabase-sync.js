(function () {
  "use strict";

  const SUPABASE_URL = "https://vfmuimzjfgzaizozqfqx.supabase.co";
  const SUPABASE_KEY = "sb_publishable_e-tgafoPLYRbraqumYozbg_sO4HzbMT";
  const SESSION_KEY = "8x-variants-supabase-session-v1";
  const MAX_OUTPUT_UPLOAD_BYTES = 50 * 1024 * 1024;
  const statusElement = () => document.getElementById("supabaseStatus");

  function setStatus(label, state) {
    const element = statusElement();
    if (!element) return;
    element.classList.remove("connected", "syncing", "offline");
    if (state) element.classList.add(state);
    const text = element.querySelector("b");
    if (text) text.textContent = label;
  }

  function headers(accessToken, extra) {
    return {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
      ...extra
    };
  }

  async function request(path, options = {}) {
    const response = await fetch(`${SUPABASE_URL}${path}`, options);
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const message = payload?.msg || payload?.message || payload?.error_description || payload?.error || `Supabase request failed (${response.status}).`;
      throw new Error(String(message));
    }
    return payload;
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
    catch (error) { return null; }
  }

  function saveSession(session) {
    const expiresAt = session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
    const stored = { ...session, expires_at: expiresAt };
    localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    return stored;
  }

  async function createAnonymousSession() {
    const session = await request("/auth/v1/signup", {
      method: "POST",
      headers: headers(null, { "content-type": "application/json" }),
      body: JSON.stringify({})
    });
    if (!session?.access_token || !session?.user?.id) throw new Error("Supabase did not create a private session.");
    return saveSession(session);
  }

  async function refreshSession(session) {
    const refreshed = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: headers(null, { "content-type": "application/json" }),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    return saveSession(refreshed);
  }

  async function getSession() {
    let session = readSession();
    if (session?.access_token && session?.user?.id && Number(session.expires_at) > Math.floor(Date.now() / 1000) + 90) return session;
    if (session?.refresh_token) {
      try { return await refreshSession(session); }
      catch (error) { localStorage.removeItem(SESSION_KEY); }
    }
    return createAnonymousSession();
  }

  function safeName(value) {
    const name = String(value || "video.mp4").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return name.slice(0, 100) || "video.mp4";
  }

  function storagePath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
  }

  async function uploadObject(session, bucket, path, file) {
    return request(`/storage/v1/object/${bucket}/${storagePath(path)}`, {
      method: "POST",
      headers: headers(session.access_token, {
        "content-type": file.type || "application/octet-stream",
        "x-upsert": "false"
      }),
      body: file
    });
  }

  async function insertJob(session, record) {
    const rows = await request("/rest/v1/render_jobs?select=id,status", {
      method: "POST",
      headers: headers(session.access_token, {
        "content-type": "application/json",
        Prefer: "return=representation"
      }),
      body: JSON.stringify(record)
    });
    if (!Array.isArray(rows) || !rows[0]?.id) throw new Error("Supabase did not create a render job.");
    return rows[0];
  }

  async function updateJob(session, id, changes) {
    return request(`/rest/v1/render_jobs?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: headers(session.access_token, {
        "content-type": "application/json",
        Prefer: "return=minimal"
      }),
      body: JSON.stringify(changes)
    });
  }

  function serializableManifest(payload) {
    return {
      version: 1,
      renderer: "browser",
      hook_mode: payload.hookMode,
      aspect_ratio: payload.aspectRatio,
      requested_count: payload.total,
      parts: payload.parts,
      sources: payload.files.map((entry) => ({
        id: entry.id,
        part: entry.part,
        name: entry.file.name,
        size: entry.file.size,
        type: entry.file.type || "application/octet-stream"
      }))
    };
  }

  async function begin(payload) {
    setStatus("Connecting private storage…", "syncing");
    const session = await getSession();
    const jobId = crypto.randomUUID();
    const prefix = `${session.user.id}/${jobId}`;
    const manifest = serializableManifest(payload);
    await insertJob(session, {
      id: jobId,
      status: "processing",
      progress: 0,
      requested_count: payload.total,
      completed_count: 0,
      input_prefix: prefix,
      manifest
    });

    const uploaded = [];
    for (let index = 0; index < payload.files.length; index++) {
      const entry = payload.files[index];
      const path = `${prefix}/${String(index + 1).padStart(2, "0")}-${safeName(entry.file.name)}`;
      setStatus(`Backing up clip ${index + 1}/${payload.files.length}…`, "syncing");
      await uploadObject(session, "source-videos", path, entry.file);
      uploaded.push({ id: entry.id, path, part: entry.part });
    }
    await updateJob(session, jobId, {
      progress: 5,
      manifest: { ...manifest, uploaded_sources: uploaded }
    });
    setStatus("Supabase connected", "connected");
    return { session, jobId, prefix, manifest, uploaded };
  }

  async function complete(jobPromise, zipBlob) {
    if (!jobPromise) return;
    try {
      const job = await jobPromise;
      let outputPath = null;
      let outputUploaded = false;
      if (zipBlob && zipBlob.size <= MAX_OUTPUT_UPLOAD_BYTES) {
        outputPath = `${job.prefix}/8x-variants-${job.jobId}.zip`;
        setStatus("Saving finished ZIP…", "syncing");
        await uploadObject(job.session, "rendered-videos", outputPath, new File([zipBlob], "8x-variants.zip", { type: "application/zip" }));
        outputUploaded = true;
      }
      await updateJob(job.session, job.jobId, {
        status: "completed",
        progress: 100,
        completed_count: job.manifest.requested_count,
        output_path: outputPath,
        finished_at: new Date().toISOString(),
        manifest: {
          ...job.manifest,
          uploaded_sources: job.uploaded,
          output_uploaded: outputUploaded,
          output_note: outputUploaded ? "ZIP stored in rendered-videos." : "ZIP exceeded the 50 MB Supabase bucket limit and remains available locally."
        }
      });
      setStatus(outputUploaded ? "Supabase backup complete" : "Sources backed up privately", "connected");
    } catch (error) {
      console.warn("Supabase completion sync failed", error);
      setStatus("Local mode · backup unavailable", "offline");
    }
  }

  async function fail(jobPromise, message) {
    if (!jobPromise) return;
    try {
      const job = await jobPromise;
      await updateJob(job.session, job.jobId, {
        status: "failed",
        error: String(message || "Local rendering failed.").slice(0, 1000),
        finished_at: new Date().toISOString()
      });
      setStatus("Supabase connected", "connected");
    } catch (error) {
      console.warn("Supabase failure sync failed", error);
      setStatus("Local mode · backup unavailable", "offline");
    }
  }

  async function checkConnection() {
    try {
      await getSession();
      setStatus("Supabase connected", "connected");
      return true;
    } catch (error) {
      console.warn("Supabase connection failed", error);
      setStatus("Local mode · backup unavailable", "offline");
      return false;
    }
  }

  window.SupabaseSync = { begin, complete, fail, checkConnection };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", checkConnection, { once: true });
  else checkConnection();
})();
