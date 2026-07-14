const $ = (id) => document.getElementById(id);
const partDefinitions = {
  hooks: { label: "Hooks", singular: "hook", help: "Stop the scroll" },
  bodies: { label: "Bodies", singular: "body", help: "Deliver the message" },
  ctas: { label: "CTAs", singular: "cta", help: "Drive the action" }
};
const partSets = { 2: ["hooks", "bodies"], 3: ["hooks", "bodies", "ctas"] };
const state = { files: { hooks: [], bodies: [], ctas: [] }, partCount: 3, zipBlob: null };
const limits = { maxCombinations: 100 };
const dimensions = { vertical: [720, 1280], square: [1080, 1080], landscape: [1280, 720] };
let ffmpegInstance = null;
let processingStartedAt = 0;
let processingTimer = null;
let currentCountLabel = "";

if (window.location.protocol === "file:") $("fileWarning").hidden = false;

document.querySelectorAll("[data-parts]").forEach((button) => button.addEventListener("click", () => {
  if (Number(button.dataset.parts) === state.partCount) return;
  state.partCount = Number(button.dataset.parts);
  state.zipBlob = null;
  $("processPanel").hidden = true;
  render();
}));

function activeParts() { return partSets[state.partCount]; }

function totalCombinations() {
  return activeParts().reduce((total, key) => total * state.files[key].length, 1);
}

function addFiles(part, files) {
  const videos = files.filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mpeg|mpg|hevc)$/i.test(file.name));
  if (videos.length !== files.length) showToast("Some files were skipped because they aren't supported videos.", true);
  videos.forEach((file) => {
    const duplicate = state.files[part].some((item) => item.file.name === file.name && item.file.size === file.size);
    if (!duplicate) state.files[part].push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
  });
  render();
}

function removeFile(part, id) {
  const item = state.files[part].find((clip) => clip.id === id);
  if (item) URL.revokeObjectURL(item.url);
  state.files[part] = state.files[part].filter((clip) => clip.id !== id);
  render();
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function render() {
  document.querySelectorAll("[data-parts]").forEach((button) => button.classList.toggle("active", Number(button.dataset.parts) === state.partCount));
  const parts = activeParts();
  $("uploadGrid").classList.toggle("two-parts", state.partCount === 2);
  $("uploadGrid").innerHTML = parts.map((part, index) => {
    const definition = partDefinitions[part];
    const count = state.files[part].length;
    return `<section class="upload-card" data-part="${part}">
      <div class="card-heading"><span class="part-number">0${index + 1}</span><div><h3>${definition.label}</h3><p>${definition.help}</p></div><span class="file-count">${count} ${count === 1 ? "clip" : "clips"}</span></div>
      <label class="drop-zone" data-drop="${part}"><input type="file" data-input="${part}" multiple><span class="upload-icon">+</span><b>Drop ${definition.singular} videos here</b><small>or <u>choose from Photos</u></small></label>
      <div class="clip-list">${state.files[part].map((clip) => `<div class="clip"><video src="${clip.url}" muted preload="metadata"></video><div class="clip-info"><b title="${escapeHtml(clip.file.name)}">${escapeHtml(clip.file.name)}</b><span>${formatBytes(clip.file.size)}</span></div><button class="remove-clip" type="button" data-remove-part="${part}" data-id="${clip.id}" aria-label="Remove ${escapeHtml(clip.file.name)}">×</button></div>`).join("")}</div>
    </section>`;
  }).join("");

  bindUploadEvents();
  const total = totalCombinations();
  $("formulaStrip").innerHTML = parts.map((part, index) => `${index ? '<span class="formula-symbol">×</span>' : ''}<span class="formula-chip"><b>${state.files[part].length}</b> ${partDefinitions[part].label.toLowerCase()}</span>`).join("") + `<span class="formula-symbol">=</span><span class="formula-chip formula-total"><b>${total}</b> videos</span>`;

  const ready = parts.every((part) => state.files[part].length > 0) && total <= limits.maxCombinations;
  $("generateButton").disabled = !ready;
  $("readyDot").classList.toggle("ready", ready);
  if (total > limits.maxCombinations) {
    $("readyTitle").textContent = `${total} combinations is too many for one batch`;
    $("readyText").textContent = `Remove clips to stay at or below ${limits.maxCombinations}.`;
  } else if (ready) {
    $("readyTitle").textContent = `${total} unique ${total === 1 ? "video" : "videos"} ready`;
    $("readyText").textContent = `${state.partCount}-part structure · packed into one ZIP.`;
  } else {
    const missing = parts.filter((part) => !state.files[part].length).map((part) => partDefinitions[part].label);
    $("readyTitle").textContent = "Add clips to every part";
    $("readyText").textContent = `Still needed: ${missing.join(", ")}.`;
  }
}

function bindUploadEvents() {
  document.querySelectorAll("[data-input]").forEach((input) => input.addEventListener("change", () => addFiles(input.dataset.input, [...input.files])));
  document.querySelectorAll("[data-drop]").forEach((drop) => {
    ["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove("dragover"); }));
    drop.addEventListener("drop", (event) => addFiles(drop.dataset.drop, [...event.dataTransfer.files]));
  });
  document.querySelectorAll("[data-remove-part]").forEach((button) => button.addEventListener("click", () => removeFile(button.dataset.removePart, button.dataset.id)));
}

$("generateButton").addEventListener("click", generateVideos);
$("downloadButton").addEventListener("click", downloadZip);

async function generateVideos() {
  const parts = activeParts();
  const total = totalCombinations();
  if (!total || total > limits.maxCombinations) return;
  if (!window.FFmpeg || !window.JSZip) return showToast("The video tools couldn't load. Refresh and try again.", true);

  setBusy(true);
  startProcessingTimer();
  $("processPanel").hidden = false;
  $("successState").hidden = true;
  $("processTitle").textContent = "Preparing your videos…";
  $("processPanel").scrollIntoView({ behavior: "smooth", block: "center" });
  updateProgress(0, "Loading the video engine", `0 / ${total}`);

  try {
    const { fetchFile } = FFmpeg;
    const ffmpeg = await getVideoEngine();
    const allClips = parts.flatMap((part) => state.files[part].map((clip) => ({ ...clip, part })));
    const fileMap = {};
    updateProgress(3, "Reading your source clips", `0 / ${total}`);

    for (let index = 0; index < allClips.length; index++) {
      const clip = allClips[index];
      const fsName = `source_${index + 1}.${getExtension(clip.file.name)}`;
      fileMap[clip.id] = fsName;
      ffmpeg.FS("writeFile", fsName, await fetchFile(clip.file));
    }

    const [width, height] = dimensions[$("aspectRatio").value];
    const normalizedMap = {};
    for (let index = 0; index < allClips.length; index++) {
      const clip = allClips[index];
      const outputName = `ready_${index + 1}.mp4`;
      const clipStart = 4 + (index / allClips.length) * 31;
      const clipShare = 31 / allClips.length;
      const clipLabel = `Clip ${index + 1} / ${allClips.length}`;
      updateProgress(Math.round(clipStart), `Preparing ${clip.file.name}`, clipLabel);
      ffmpeg.setProgress(({ ratio }) => {
        const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
        updateProgress(Math.round(clipStart + safeRatio * clipShare), `Preparing ${clip.file.name}`, clipLabel);
      });
      await normalizeClip(ffmpeg, fileMap[clip.id], outputName, width, height);
      normalizedMap[clip.id] = outputName;
    }

    const zip = new JSZip();
    const outputFolder = zip.folder("mixcut-variations");
    const combinations = cartesian(parts.map((part) => state.files[part]));
    for (let index = 0; index < combinations.length; index++) {
      const combination = combinations[index];
      const outputName = combination.map((clip, partIndex) => `${partDefinitions[parts[partIndex]].singular}-${state.files[parts[partIndex]].indexOf(clip) + 1}`).join("_") + ".mp4";
      const percent = 35 + Math.round((index / combinations.length) * 57);
      updateProgress(percent, `Stitching ${outputName}`, `${index + 1} / ${total}`);
      const listName = `list_${index}.txt`;
      const listText = combination.map((clip) => `file '${normalizedMap[clip.id]}'`).join("\n");
      ffmpeg.FS("writeFile", listName, new TextEncoder().encode(listText));
      await ffmpeg.run("-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", "-movflags", "+faststart", outputName);
      outputFolder.file(outputName, ffmpeg.FS("readFile", outputName));
      ffmpeg.FS("unlink", outputName);
      ffmpeg.FS("unlink", listName);
    }

    updateProgress(92, "Packing everything into a ZIP", `${total} / ${total}`);
    state.zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" }, ({ percent }) => updateProgress(92 + Math.round(percent * .08), "Packing everything into a ZIP", `${total} / ${total}`));
    updateProgress(100, "Finished", `${total} / ${total}`);
    $("processTitle").textContent = "All done. Ready to test.";
    $("successCopy").textContent = `${total} ${state.partCount}-part video ${total === 1 ? "variation is" : "variations are"} ready to download.`;
    $("successState").hidden = false;
    showToast("Your video variations are ready.");
  } catch (error) {
    console.error(error);
    $("processTitle").textContent = "We couldn't finish this batch";
    updateProgress(0, "A clip could not be converted. Try exporting it as MP4 (H.264).", "Not completed");
    showToast("A source clip uses a codec this browser cannot convert.", true);
  } finally {
    stopProcessingTimer();
    setBusy(false);
  }
}

async function getVideoEngine() {
  if (ffmpegInstance?.isLoaded()) return ffmpegInstance;
  ffmpegInstance = FFmpeg.createFFmpeg({ log: false, corePath: new URL("vendor/ffmpeg-core.js", window.location.href).href });
  await ffmpegInstance.load();
  return ffmpegInstance;
}

async function normalizeClip(ffmpeg, inputName, outputName, width, height) {
  const filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p`;
  const common = ["-vf", filter, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];
  try {
    await ffmpeg.run("-i", inputName, "-map", "0:v:0", "-map", "0:a:0", ...common, outputName);
  } catch (error) {
    safeUnlink(ffmpeg, outputName);
    await ffmpeg.run("-i", inputName, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v:0", "-map", "1:a:0", ...common, "-shortest", outputName);
  }
}

function cartesian(groups) {
  return groups.reduce((results, group) => results.flatMap((result) => group.map((item) => [...result, item])), [[]]);
}
function getExtension(name) { const extension = name.split(".").pop().toLowerCase(); return /^[a-z0-9]{2,5}$/.test(extension) ? extension : "mp4"; }
function safeUnlink(ffmpeg, name) { try { ffmpeg.FS("unlink", name); } catch (error) {} }

function setBusy(busy) {
  $("generateButton").disabled = busy || !activeParts().every((part) => state.files[part].length);
  $("aspectRatio").disabled = busy;
  document.querySelectorAll("[data-input],[data-parts]").forEach((element) => element.disabled = busy);
  $("generateButton").querySelector("span").textContent = busy ? "Making your videos…" : "Make every variation";
}
function updateProgress(percent, status, count) { $("progressPercent").textContent = `${Math.min(100, percent)}%`; $("progressBar").style.width = `${Math.min(100, percent)}%`; $("processStatus").textContent = status; currentCountLabel = count; renderProcessCount(); }
function startProcessingTimer() { processingStartedAt = Date.now(); clearInterval(processingTimer); processingTimer = setInterval(renderProcessCount, 1000); }
function stopProcessingTimer() { clearInterval(processingTimer); processingTimer = null; renderProcessCount(); }
function renderProcessCount() { if (!processingStartedAt) return $("processCount").textContent = currentCountLabel; const seconds = Math.max(0, Math.floor((Date.now() - processingStartedAt) / 1000)); $("processCount").textContent = `${currentCountLabel} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} elapsed`; }
function downloadZip() { if (!state.zipBlob) return; const link = document.createElement("a"); link.href = URL.createObjectURL(state.zipBlob); link.download = `mixcut-${state.partCount}-part-${totalCombinations()}-variations.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
let toastTimer;
function showToast(message, error = false) { $("toast").textContent = message; $("toast").classList.toggle("error", error); $("toast").classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4200); }

render();
