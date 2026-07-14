const $ = (id) => document.getElementById(id);
const partDefinitions = {
  hooks: { label: "Hooks", singular: "hook", help: "Stop the scroll" },
  bodies: { label: "Bodies", singular: "body", help: "Deliver the message" },
  ctas: { label: "CTAs", singular: "cta", help: "Drive the action" }
};
const partSets = { 2: ["hooks", "bodies"], 3: ["hooks", "bodies", "ctas"] };
const captionStyles = [
  { id: "creator", label: "Creator lower-third", detail: "Bold white · dark box", font: "Sans", color: "white", extra: "box=1:boxcolor=black@0.72:boxborderw=22:x=(w-text_w)/2:y=h*0.70:alpha='if(lt(t\\,0.3)\\,t/0.3\\,1)'" },
  { id: "impact", label: "Impact center", detail: "Yellow serif · outlined", font: "Serif", color: "#F3D82E", extra: "borderw=5:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2" },
  { id: "clean", label: "Clean top", detail: "White · 8x blue", font: "Sans", color: "white", extra: "box=1:boxcolor=#1838D4@0.94:boxborderw=18:x=(w-text_w)/2:y=h*0.12:enable='gte(t\\,0.18)'" }
];
const state = {
  files: { hooks: [], bodies: [], ctas: [] },
  partCount: 3,
  hookMode: "manual",
  ai: { rawClip: null, hookText: "", paraphrases: [], loading: false, error: "" },
  zipBlob: null
};
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
  resetResult();
  render();
}));

function activeParts() { return partSets[state.partCount]; }
function selectedParaphrases() { return state.ai.paraphrases.filter((item) => item.selected); }
function hookVariantCount() { return state.hookMode === "manual" ? state.files.hooks.length : selectedParaphrases().length * captionStyles.length; }
function partCountFor(part) { return part === "hooks" ? hookVariantCount() : state.files[part].length; }
function isPartReady(part) {
  if (part !== "hooks" || state.hookMode === "manual") return state.files[part].length > 0;
  return Boolean(state.ai.rawClip && selectedParaphrases().length);
}
function totalCombinations() { return activeParts().reduce((total, part) => total * partCountFor(part), 1); }
function resetResult() { state.zipBlob = null; $("processPanel").hidden = true; }

function addFiles(part, files) {
  const videos = files.filter(isVideoFile);
  if (videos.length !== files.length) showToast("Some files were skipped because they aren't supported videos.", true);
  videos.forEach((file) => {
    const duplicate = state.files[part].some((item) => item.file.name === file.name && item.file.size === file.size);
    if (!duplicate) state.files[part].push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
  });
  resetResult();
  render();
}

function setRawHook(files) {
  const file = files.find(isVideoFile);
  if (!file) return showToast("Choose a video file for the raw hook clip.", true);
  if (state.ai.rawClip) URL.revokeObjectURL(state.ai.rawClip.url);
  state.ai.rawClip = { id: crypto.randomUUID(), file, url: URL.createObjectURL(file) };
  resetResult();
  render();
}

function removeFile(part, id) {
  const item = state.files[part].find((clip) => clip.id === id);
  if (item) URL.revokeObjectURL(item.url);
  state.files[part] = state.files[part].filter((clip) => clip.id !== id);
  resetResult();
  render();
}

function removeRawHook() {
  if (state.ai.rawClip) URL.revokeObjectURL(state.ai.rawClip.url);
  state.ai.rawClip = null;
  resetResult();
  render();
}

function isVideoFile(file) { return file && (file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mpeg|mpg|hevc)$/i.test(file.name)); }
function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

function clipMarkup(clip, part) {
  return `<div class="clip"><video src="${clip.url}" muted preload="metadata"></video><div class="clip-info"><b title="${escapeHtml(clip.file.name)}">${escapeHtml(clip.file.name)}</b><span>${formatBytes(clip.file.size)}</span></div><button class="remove-clip" type="button" data-remove-part="${part}" data-id="${clip.id}" aria-label="Remove ${escapeHtml(clip.file.name)}">×</button></div>`;
}

function standardUploadMarkup(part) {
  const definition = partDefinitions[part];
  return `<label class="drop-zone" data-drop="${part}"><input type="file" data-input="${part}" multiple><span class="upload-icon">+</span><b>Drop ${definition.singular} videos here</b><small>or <u>choose from Photos</u></small></label><div class="clip-list">${state.files[part].map((clip) => clipMarkup(clip, part)).join("")}</div>`;
}

function aiHookMarkup() {
  const raw = state.ai.rawClip;
  const review = state.ai.paraphrases.length ? `<div class="paraphrase-review"><div class="review-heading"><div><b>Choose the lines to render</b><small>${selectedParaphrases().length} of ${state.ai.paraphrases.length} selected · each makes ${captionStyles.length} styles</small></div></div>${state.ai.paraphrases.map((item, index) => `<label class="paraphrase-option"><input type="checkbox" data-paraphrase="${item.id}" ${item.selected ? "checked" : ""}><span>${index + 1}</span><p>${escapeHtml(item.text)}</p></label>`).join("")}</div>` : "";
  return `<div class="ai-hook-panel">
    ${raw ? `<div class="raw-hook-clip"><video src="${raw.url}" muted preload="metadata"></video><div><b>${escapeHtml(raw.file.name)}</b><span>${formatBytes(raw.file.size)} · raw textless clip</span></div><button type="button" id="removeRawHook" aria-label="Remove raw hook">×</button></div>` : `<label class="drop-zone raw-hook-zone" id="rawHookDrop"><input type="file" id="rawHookInput"><span class="upload-icon">+</span><b>Add one raw, textless hook</b><small>Drop it here or <u>choose from Photos</u></small></label>`}
    <div class="ai-copy-form"><label for="hookText">Original hook line</label><textarea id="hookText" maxlength="300" rows="3" placeholder="12 years of school and nobody told me about this">${escapeHtml(state.ai.hookText)}</textarea><button type="button" id="generateParaphrases" ${state.ai.loading ? "disabled" : ""}>${state.ai.loading ? "Claude is writing…" : state.ai.paraphrases.length ? "Regenerate paraphrases" : "Generate paraphrases"}<span>✦</span></button>${state.ai.error ? `<p class="ai-error">${escapeHtml(state.ai.error)}</p>` : ""}<small class="privacy-note">Only this text is sent to Claude. Your video stays in this browser.</small></div>
    ${review}
    <div class="caption-style-row">${captionStyles.map((style) => `<span class="style-pill"><b>${style.label}</b>${style.detail}</span>`).join("")}</div>
  </div>`;
}

function render() {
  document.querySelectorAll("[data-parts]").forEach((button) => button.classList.toggle("active", Number(button.dataset.parts) === state.partCount));
  const parts = activeParts();
  $("uploadGrid").classList.toggle("two-parts", state.partCount === 2);
  $("uploadGrid").innerHTML = parts.map((part, index) => {
    const definition = partDefinitions[part];
    const count = partCountFor(part);
    const hookSwitch = part === "hooks" ? `<div class="hook-mode-switch" role="group" aria-label="Hook source"><button type="button" data-hook-mode="manual" class="${state.hookMode === "manual" ? "active" : ""}">Upload my clips</button><button type="button" data-hook-mode="ai" class="${state.hookMode === "ai" ? "active" : ""}">AI hook generator <span>✦</span></button></div>` : "";
    const content = part === "hooks" && state.hookMode === "ai" ? aiHookMarkup() : standardUploadMarkup(part);
    return `<section class="upload-card ${part === "hooks" && state.hookMode === "ai" ? "ai-hook-card" : ""}" data-part="${part}"><div class="card-heading"><span class="part-number">0${index + 1}</span><div><h3>${definition.label}</h3><p>${definition.help}</p></div><span class="file-count">${count} ${count === 1 ? "clip" : "clips"}</span></div>${hookSwitch}${content}</section>`;
  }).join("");

  bindUploadEvents();
  bindAiEvents();
  const total = totalCombinations();
  $("formulaStrip").innerHTML = parts.map((part, index) => `${index ? '<span class="formula-symbol">×</span>' : ''}<span class="formula-chip"><b>${partCountFor(part)}</b> ${part === "hooks" && state.hookMode === "ai" ? "generated hooks" : partDefinitions[part].label.toLowerCase()}</span>`).join("") + `<span class="formula-symbol">=</span><span class="formula-chip formula-total"><b>${total}</b> videos</span>`;

  const ready = parts.every(isPartReady) && total <= limits.maxCombinations;
  $("generateButton").disabled = !ready;
  $("readyDot").classList.toggle("ready", ready);
  if (total > limits.maxCombinations) {
    $("readyTitle").textContent = `${total} combinations is too many for one batch`;
    $("readyText").textContent = `Deselect lines or remove clips to stay at or below ${limits.maxCombinations}.`;
  } else if (ready) {
    $("readyTitle").textContent = `${total} unique ${total === 1 ? "video" : "videos"} ready`;
    $("readyText").textContent = `${state.partCount}-part structure · packed into one ZIP.`;
  } else {
    const missing = parts.filter((part) => !isPartReady(part)).map((part) => part === "hooks" && state.hookMode === "ai" ? "Raw hook + selected text" : partDefinitions[part].label);
    $("readyTitle").textContent = "Finish every video part";
    $("readyText").textContent = `Still needed: ${missing.join(", ")}.`;
  }
  updateWorkflow(ready ? 3 : 2);
}

function bindUploadEvents() {
  document.querySelectorAll("[data-input]").forEach((input) => input.addEventListener("change", () => addFiles(input.dataset.input, [...input.files])));
  document.querySelectorAll("[data-drop]").forEach((drop) => bindDropZone(drop, (files) => addFiles(drop.dataset.drop, files)));
  document.querySelectorAll("[data-remove-part]").forEach((button) => button.addEventListener("click", () => removeFile(button.dataset.removePart, button.dataset.id)));
}

function bindAiEvents() {
  document.querySelectorAll("[data-hook-mode]").forEach((button) => button.addEventListener("click", () => {
    state.hookMode = button.dataset.hookMode;
    resetResult();
    render();
  }));
  const rawInput = $("rawHookInput");
  if (rawInput) rawInput.addEventListener("change", () => setRawHook([...rawInput.files]));
  const rawDrop = $("rawHookDrop");
  if (rawDrop) bindDropZone(rawDrop, setRawHook);
  if ($("removeRawHook")) $("removeRawHook").addEventListener("click", removeRawHook);
  if ($("hookText")) $("hookText").addEventListener("input", (event) => { state.ai.hookText = event.target.value; });
  if ($("generateParaphrases")) $("generateParaphrases").addEventListener("click", generateParaphrases);
  document.querySelectorAll("[data-paraphrase]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const item = state.ai.paraphrases.find((candidate) => candidate.id === checkbox.dataset.paraphrase);
    if (item) item.selected = checkbox.checked;
    resetResult();
    render();
  }));
}

function bindDropZone(drop, callback) {
  ["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove("dragover"); }));
  drop.addEventListener("drop", (event) => callback([...event.dataTransfer.files]));
}

async function generateParaphrases() {
  const hookText = state.ai.hookText.trim();
  if (hookText.length < 5) return showToast("Type a complete hook line first.", true);
  if (window.location.protocol === "file:") return showToast("Open Mixcut from its local launcher or Vercel site to use Claude.", true);
  state.ai.loading = true;
  state.ai.error = "";
  render();
  try {
    const response = await fetch("/api/generate-hooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hookText }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Claude could not generate variants.");
    state.ai.paraphrases = payload.paraphrases.map((text) => ({ id: crypto.randomUUID(), text, selected: true }));
    resetResult();
  } catch (error) {
    state.ai.error = error.message;
  } finally {
    state.ai.loading = false;
    render();
  }
}

$("generateButton").addEventListener("click", generateVideos);
$("downloadButton").addEventListener("click", downloadZip);

async function generateVideos() {
  const parts = activeParts();
  const total = totalCombinations();
  if (!total || total > limits.maxCombinations || !parts.every(isPartReady)) return;
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
    const [width, height] = dimensions[$("aspectRatio").value];
    const workingFiles = { hooks: state.files.hooks, bodies: state.files.bodies, ctas: state.files.ctas };
    if (state.hookMode === "ai") workingFiles.hooks = await renderAiHookClips(ffmpeg, width, height, fetchFile);

    const allClips = parts.flatMap((part) => workingFiles[part].map((clip) => ({ ...clip, part })));
    const fileMap = {};
    const normalizationBase = state.hookMode === "ai" ? 30 : 4;
    const normalizationSpan = state.hookMode === "ai" ? 15 : 31;
    updateProgress(normalizationBase, "Reading your source clips", `0 / ${total}`);

    for (let index = 0; index < allClips.length; index++) {
      const clip = allClips[index];
      if (clip.preparedFsName) { fileMap[clip.id] = clip.preparedFsName; continue; }
      const fsName = `source_${index + 1}.${getExtension(clip.file.name)}`;
      fileMap[clip.id] = fsName;
      ffmpeg.FS("writeFile", fsName, await fetchFile(clip.file));
    }

    const normalizedMap = {};
    for (let index = 0; index < allClips.length; index++) {
      const clip = allClips[index];
      if (clip.preparedFsName) { normalizedMap[clip.id] = clip.preparedFsName; continue; }
      const outputName = `ready_${index + 1}.mp4`;
      const clipStart = normalizationBase + (index / allClips.length) * normalizationSpan;
      const clipShare = normalizationSpan / allClips.length;
      const clipLabel = `Clip ${index + 1} / ${allClips.length}`;
      updateProgress(Math.round(clipStart), `Preparing ${clip.file.name}`, clipLabel);
      ffmpeg.setProgress(({ ratio }) => {
        const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
        updateProgress(Math.round(clipStart + safeRatio * clipShare), `Preparing ${clip.file.name}`, clipLabel);
      });
      safeUnlink(ffmpeg, outputName);
      await normalizeClip(ffmpeg, fileMap[clip.id], outputName, width, height);
      normalizedMap[clip.id] = outputName;
    }

    const zip = new JSZip();
    const outputFolder = zip.folder("mixcut-variations");
    const combinations = cartesian(parts.map((part) => workingFiles[part]));
    for (let index = 0; index < combinations.length; index++) {
      const combination = combinations[index];
      const outputName = combination.map((clip, partIndex) => `${partDefinitions[parts[partIndex]].singular}-${workingFiles[parts[partIndex]].indexOf(clip) + 1}`).join("_") + ".mp4";
      const percent = 45 + Math.round((index / combinations.length) * 47);
      updateProgress(percent, `Stitching ${outputName}`, `${index + 1} / ${total}`);
      const listName = `list_${index}.txt`;
      const listText = combination.map((clip) => `file '${normalizedMap[clip.id]}'`).join("\n");
      ffmpeg.FS("writeFile", listName, new TextEncoder().encode(listText));
      safeUnlink(ffmpeg, outputName);
      await ffmpeg.run("-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", "-movflags", "+faststart", outputName);
      outputFolder.file(outputName, ffmpeg.FS("readFile", outputName));
      safeUnlink(ffmpeg, outputName);
      safeUnlink(ffmpeg, listName);
    }

    updateProgress(92, "Packing everything into a ZIP", `${total} / ${total}`);
    state.zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" }, ({ percent }) => updateProgress(92 + Math.round(percent * .08), "Packing everything into a ZIP", `${total} / ${total}`));
    updateProgress(100, "Finished", `${total} / ${total}`);
    $("processTitle").textContent = "All done. Ready to test.";
    $("successCopy").textContent = `${total} ${state.partCount}-part video ${total === 1 ? "variation is" : "variations are"} ready to download.`;
    $("successState").hidden = false;
    updateWorkflow(4);
    showToast("Your video variations are ready.");
  } catch (error) {
    console.error(error);
    $("processTitle").textContent = "We couldn't finish this batch";
    updateProgress(0, "A clip or caption could not be rendered. Try an MP4 (H.264) source.", "Not completed");
    showToast("Video processing failed. Try a smaller H.264 MP4 source.", true);
  } finally {
    stopProcessingTimer();
    setBusy(false);
  }
}

async function renderAiHookClips(ffmpeg, width, height, fetchFile) {
  const lines = selectedParaphrases();
  const raw = state.ai.rawClip;
  const inputName = `ai_raw.${getExtension(raw.file.name)}`;
  ffmpeg.FS("writeFile", inputName, await fetchFile(raw.file));
  const results = [];
  let completed = 0;
  const variantTotal = lines.length * captionStyles.length;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    for (const style of captionStyles) {
      const captionName = `caption_${lineIndex}_${style.id}.txt`;
      const outputName = `ai_hook_${lineIndex + 1}_${style.id}.mp4`;
      ffmpeg.FS("writeFile", captionName, new TextEncoder().encode(wrapCaption(lines[lineIndex].text)));
      const start = 3 + (completed / variantTotal) * 27;
      const share = 27 / variantTotal;
      updateProgress(Math.round(start), `Rendering AI hook ${completed + 1} / ${variantTotal}`, `${completed + 1} / ${variantTotal} hooks`);
      ffmpeg.setProgress(({ ratio }) => {
        const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
        updateProgress(Math.round(start + safeRatio * share), `Rendering AI hook ${completed + 1} / ${variantTotal}`, `${completed + 1} / ${variantTotal} hooks`);
      });
      safeUnlink(ffmpeg, outputName);
      await captionClip(ffmpeg, inputName, captionName, outputName, style, width, height);
      results.push({ id: crypto.randomUUID(), file: { name: outputName, size: 0 }, preparedFsName: outputName, aiLine: lines[lineIndex].text, style: style.id });
      safeUnlink(ffmpeg, captionName);
      completed++;
    }
  }
  safeUnlink(ffmpeg, inputName);
  return results;
}

async function getVideoEngine() {
  if (ffmpegInstance?.isLoaded()) return ffmpegInstance;
  ffmpegInstance = FFmpeg.createFFmpeg({ log: false, corePath: new URL("vendor/ffmpeg-core.js", window.location.href).href });
  await ffmpegInstance.load();
  return ffmpegInstance;
}

function baseVideoFilter(width, height) { return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p`; }

async function normalizeClip(ffmpeg, inputName, outputName, width, height) {
  await transcodeWithAudioFallback(ffmpeg, inputName, outputName, baseVideoFilter(width, height));
}

async function captionClip(ffmpeg, inputName, captionName, outputName, style, width, height) {
  const fontSize = Math.round(Math.min(width, height) * 0.055);
  const drawtext = `drawtext=font='${style.font}':textfile='${captionName}':fontcolor=${style.color}:fontsize=${fontSize}:line_spacing=${Math.round(fontSize * .24)}:${style.extra}`;
  await transcodeWithAudioFallback(ffmpeg, inputName, outputName, `${baseVideoFilter(width, height)},${drawtext}`);
}

async function transcodeWithAudioFallback(ffmpeg, inputName, outputName, filter) {
  const common = ["-vf", filter, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];
  try {
    await ffmpeg.run("-i", inputName, "-map", "0:v:0", "-map", "0:a:0", ...common, outputName);
  } catch (error) {
    safeUnlink(ffmpeg, outputName);
    await ffmpeg.run("-i", inputName, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v:0", "-map", "1:a:0", ...common, "-shortest", outputName);
  }
}

function wrapCaption(text, maxChars = 27) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    if (line && `${line} ${word}`.length > maxChars && lines.length < 3) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  });
  if (line) lines.push(line);
  if (lines.length > 4) return [...lines.slice(0, 3), lines.slice(3).join(" ")].join("\n");
  return lines.join("\n");
}

function cartesian(groups) { return groups.reduce((results, group) => results.flatMap((result) => group.map((item) => [...result, item])), [[]]); }
function getExtension(name) { const extension = name.split(".").pop().toLowerCase(); return /^[a-z0-9]{2,5}$/.test(extension) ? extension : "mp4"; }
function safeUnlink(ffmpeg, name) { try { ffmpeg.FS("unlink", name); } catch (error) {} }

function setBusy(busy) {
  $("generateButton").disabled = busy || !activeParts().every(isPartReady) || totalCombinations() > limits.maxCombinations;
  $("aspectRatio").disabled = busy;
  document.querySelectorAll("[data-input],[data-parts],[data-hook-mode],#rawHookInput,#generateParaphrases,[data-paraphrase]").forEach((element) => element.disabled = busy);
  $("generateButton").querySelector("span").textContent = busy ? "Making your videos…" : "Make every variation";
  if (busy) updateWorkflow(3, true);
}
function updateWorkflow(stage, working = false) {
  const steps = [$("workflowStep1"), $("workflowStep2"), $("workflowStep3")];
  steps.forEach((step, index) => {
    step.classList.toggle("complete", stage > index + 1);
    step.classList.toggle("active", stage === index + 1 || (stage === 4 && index === 2));
    step.classList.toggle("working", working && index === 2);
  });
}
function updateProgress(percent, status, count) { $("progressPercent").textContent = `${Math.min(100, percent)}%`; $("progressBar").style.width = `${Math.min(100, percent)}%`; $("processStatus").textContent = status; currentCountLabel = count; renderProcessCount(); }
function startProcessingTimer() { processingStartedAt = Date.now(); clearInterval(processingTimer); processingTimer = setInterval(renderProcessCount, 1000); }
function stopProcessingTimer() { clearInterval(processingTimer); processingTimer = null; renderProcessCount(); }
function renderProcessCount() { if (!processingStartedAt) return $("processCount").textContent = currentCountLabel; const seconds = Math.max(0, Math.floor((Date.now() - processingStartedAt) / 1000)); $("processCount").textContent = `${currentCountLabel} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} elapsed`; }
function downloadZip() { if (!state.zipBlob) return; const link = document.createElement("a"); link.href = URL.createObjectURL(state.zipBlob); link.download = `mixcut-${state.partCount}-part-${totalCombinations()}-variations.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); }
let toastTimer;
function showToast(message, error = false) { $("toast").textContent = message; $("toast").classList.toggle("error", error); $("toast").classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4200); }

render();
