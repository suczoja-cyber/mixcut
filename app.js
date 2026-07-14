const $ = (id) => document.getElementById(id);
const partDefinitions = {
  hooks: { label: "Hooks", singular: "hook", help: "Stop the scroll" },
  bodies: { label: "Bodies", singular: "body", help: "Deliver the message" },
  ctas: { label: "CTAs", singular: "cta", help: "Drive the action" }
};
const partSets = { 2: ["hooks", "bodies"], 3: ["hooks", "bodies", "ctas"] };
const captionColors = [
  { id: "white", label: "White", color: "#FFFFFF" },
  { id: "yellow", label: "Yellow", color: "#F3D82E" },
  { id: "pink", label: "8x pink", color: "#FF7373" }
];
const captionPositions = [
  { id: "lower", label: "Lower third", detail: "lower 70%", position: { x: 50, y: 70 } },
  { id: "center", label: "Center", detail: "center 50%", position: { x: 50, y: 50 } },
  { id: "top", label: "Top", detail: "top 12%", position: { x: 50, y: 12 } }
];
const state = {
  files: { hooks: [], bodies: [], ctas: [] },
  partCount: 3,
  hookMode: "manual",
  ai: { rawClip: null, copyMode: "paste", variationMode: "both", fixedColor: "yellow", hookText: "", manualHookText: "", paraphrases: [], selectedStyleIds: [], previewVariants: [], frame: null, previewing: false, previewError: "", loading: false, error: "" },
  zipBlob: null
};
const limits = { maxCombinations: 100 };
const dimensions = { vertical: [720, 1280], square: [1080, 1080], landscape: [1280, 720] };
let ffmpegInstance = null;
let processingStartedAt = 0;
let processingTimer = null;
let currentCountLabel = "";
let previewGeneration = 0;
state.ai.selectedStyleIds = availableCaptionStyles().map((style) => style.id);

if (window.location.protocol === "file:") $("fileWarning").hidden = false;

document.querySelectorAll("[data-parts]").forEach((button) => button.addEventListener("click", () => {
  if (Number(button.dataset.parts) === state.partCount) return;
  state.partCount = Number(button.dataset.parts);
  resetResult();
  render();
}));
$("aspectRatio").addEventListener("change", () => { resetResult(); render(); if (state.hookMode === "ai" && state.ai.rawClip && state.ai.paraphrases.length) refreshAiPreviews(true); });

function activeParts() { return partSets[state.partCount]; }
function selectedParaphrases() { return state.ai.paraphrases.filter((item) => item.selected); }
function availableCaptionStyles() {
  if (state.ai.variationMode === "color") {
    return captionColors.map((color) => makeCaptionStyle(color, captionPositions[0], "color"));
  }
  if (state.ai.variationMode === "position") {
    const color = captionColors.find((item) => item.id === state.ai.fixedColor) || captionColors[1];
    return captionPositions.map((position) => makeCaptionStyle(color, position, "position"));
  }
  return captionPositions.flatMap((position) => captionColors.map((color) => makeCaptionStyle(color, position, "both")));
}
function makeCaptionStyle(color, placement, mode) {
  const label = mode === "color" ? color.label : mode === "position" ? placement.label : `${color.label} · ${placement.label}`;
  return styleWithExtra({
    id: `${color.id}-${placement.id}`,
    label,
    detail: `${color.label} text · ${placement.detail}`,
    font: "Sans",
    fontFamily: "Arial, Helvetica, sans-serif",
    color: color.color,
    strokeColor: "#000000",
    strokeWidth: 5,
    boxColor: null,
    position: placement.position,
    animation: "Static"
  });
}
function styleWithExtra(style) {
  let decoration = "";
  if (style.boxColor?.includes("24,56,212")) decoration = "box=1:boxcolor=#1838D4@0.94:boxborderw=18:";
  else if (style.boxColor) decoration = "box=1:boxcolor=black@0.72:boxborderw=22:";
  else if (style.strokeColor && style.strokeWidth) decoration = `borderw=${style.strokeWidth}:bordercolor=black:`;
  let animation = "";
  if (style.animation === "Fade in") animation = ":alpha='if(lt(t\\,0.3)\\,t/0.3\\,1)'";
  else if (style.animation === "Pop in") animation = ":enable='gte(t\\,0.18)'";
  return { ...style, extra: `${decoration}x=(w-text_w)/2:y=(h-text_h)*${(style.position.y / 100).toFixed(2)}${animation}` };
}
function selectedStyles() { return availableCaptionStyles().filter((style) => state.ai.selectedStyleIds.includes(style.id)); }
function selectedPreviewVariants() { return state.ai.previewVariants.filter((variant) => variant.selected); }
function hookVariantCount() { return state.hookMode === "manual" ? state.files.hooks.length : selectedPreviewVariants().length; }
function partCountFor(part) { return part === "hooks" ? hookVariantCount() : state.files[part].length; }
function isPartReady(part) {
  if (part !== "hooks" || state.hookMode === "manual") return state.files[part].length > 0;
  return Boolean(state.ai.rawClip && state.ai.frame && selectedPreviewVariants().length);
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
  state.ai.frame = null;
  state.ai.previewError = "";
  syncPreviewVariants();
  resetResult();
  render();
  if (state.ai.paraphrases.length) refreshAiPreviews(true);
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
  state.ai.frame = null;
  state.ai.previewVariants = [];
  state.ai.previewError = "";
  previewGeneration++;
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

function syncPreviewVariants() {
  const previous = new Map(state.ai.previewVariants.map((variant) => [variant.id, variant.selected]));
  state.ai.previewVariants = selectedParaphrases().flatMap((line) => selectedStyles().map((style) => {
    const id = `${line.id}--${style.id}`;
    return { id, lineId: line.id, styleId: style.id, selected: previous.has(id) ? previous.get(id) : true };
  }));
}

function previewGridMarkup() {
  if (!state.ai.paraphrases.length || !state.ai.rawClip) return "";
  if (state.ai.previewing) return `<div class="preview-loading"><span></span><div><b>Capturing a preview frame…</b><small>No video encoding yet — this only takes a moment.</small></div></div>`;
  if (state.ai.previewError) return `<div class="preview-error"><b>Preview unavailable</b><span>${escapeHtml(state.ai.previewError)}</span><button type="button" id="retryPreviews">Try again</button></div>`;
  if (!state.ai.frame || !state.ai.previewVariants.length) return `<div class="preview-empty"><b>Choose at least one line and one style</b><span>Your visual combinations will appear here before rendering.</span></div>`;
  const selectedCount = selectedPreviewVariants().length;
  const styles = availableCaptionStyles();
  return `<section class="thumbnail-review"><div class="thumbnail-review-head"><div><span class="section-tag">PREVIEW FILTER</span><b>Choose the exact hooks to render</b><small>${selectedCount} of ${state.ai.previewVariants.length} combinations selected</small></div><div><button type="button" id="selectAllPreviews">Select all</button><button type="button" id="clearAllPreviews">Clear</button></div></div><div class="thumbnail-grid">${state.ai.previewVariants.map((variant) => {
    const line = state.ai.paraphrases.find((item) => item.id === variant.lineId);
    const style = styles.find((item) => item.id === variant.styleId);
    return `<label class="thumbnail-card ${variant.selected ? "selected" : ""}"><canvas data-preview-canvas="${variant.id}" width="${state.ai.frame.width}" height="${state.ai.frame.height}"></canvas><span class="thumbnail-toggle"><input type="checkbox" data-preview-variant="${variant.id}" ${variant.selected ? "checked" : ""}><i>✓</i></span><span class="animation-badge">${escapeHtml(style.animation)}</span><div><b>${escapeHtml(style.label)}</b><small>${escapeHtml(line.text)}</small><em>${style.position.x}% × ${style.position.y}% position</em></div></label>`;
  }).join("")}</div></section>`;
}

function aiHookMarkup() {
  const raw = state.ai.rawClip;
  const usingClaude = state.ai.copyMode === "claude";
  const copyText = usingClaude ? state.ai.hookText : state.ai.manualHookText;
  const styles = availableCaptionStyles();
  const fixedColor = captionColors.find((color) => color.id === state.ai.fixedColor) || captionColors[1];
  const variationCount = selectedParaphrases().length * styles.length;
  const fixedColorPicker = state.ai.variationMode === "position" ? `<div class="fixed-color-picker"><span>Text color for every position</span><div role="group" aria-label="Fixed caption color">${captionColors.map((color) => `<button type="button" data-fixed-caption-color="${color.id}" class="${fixedColor.id === color.id ? "active" : ""}"><i style="--swatch:${color.color}"></i>${color.label}</button>`).join("")}</div></div>` : "";
  const review = state.ai.paraphrases.length ? `<div class="paraphrase-review"><div class="review-heading"><div><b>Choose the lines to preview</b><small>${selectedParaphrases().length} of ${state.ai.paraphrases.length} selected</small></div></div>${state.ai.paraphrases.map((item, index) => `<label class="paraphrase-option"><input type="checkbox" data-paraphrase="${item.id}" ${item.selected ? "checked" : ""}><span>${index + 1}</span><p>${escapeHtml(item.text)}</p></label>`).join("")}</div>` : "";
  return `<div class="ai-hook-panel">
    ${raw ? `<div class="raw-hook-clip"><video src="${raw.url}" muted preload="metadata"></video><div><b>${escapeHtml(raw.file.name)}</b><span>${formatBytes(raw.file.size)} · raw textless clip</span></div><button type="button" id="removeRawHook" aria-label="Remove raw hook">×</button></div>` : `<label class="drop-zone raw-hook-zone" id="rawHookDrop"><input type="file" id="rawHookInput"><span class="upload-icon">+</span><b>Add one raw, textless hook</b><small>Drop it here or <u>choose from Photos</u></small></label>`}
    <div class="ai-copy-form"><div class="copy-source-switch" role="group" aria-label="Hook text source"><button type="button" data-copy-mode="paste" class="${!usingClaude ? "active" : ""}">Paste my hook lines</button><button type="button" data-copy-mode="claude" class="${usingClaude ? "active" : ""}">Generate with Claude <span>✦</span></button></div><label for="hookText">${usingClaude ? "Original hook line" : "Your hook lines · one per line"}</label><textarea id="hookText" maxlength="${usingClaude ? 300 : 4000}" rows="${usingClaude ? 3 : 6}" placeholder="${usingClaude ? "12 years of school and nobody told me about this" : "12 years of school and nobody told me about this&#10;Nobody teaches you this in school&#10;I wish I had learned this years ago"}">${escapeHtml(copyText)}</textarea><button class="copy-action" type="button" id="${usingClaude ? "generateParaphrases" : "useManualHooks"}" ${state.ai.loading ? "disabled" : ""}>${usingClaude ? (state.ai.loading ? "Claude is writing…" : state.ai.paraphrases.length ? "Regenerate paraphrases" : "Generate paraphrases") : (state.ai.paraphrases.length ? "Replace with these hook lines" : "Use these hook lines")}<span>${usingClaude ? "✦" : "→"}</span></button>${state.ai.error ? `<p class="ai-error">${escapeHtml(state.ai.error)}</p>` : ""}<small class="privacy-note">${usingClaude ? "Only this text is sent to Claude. Your video stays in this browser." : "No API call. Blank lines are ignored and your text stays in this browser."}</small></div>
    ${review}
    ${state.ai.paraphrases.length ? `<div class="style-picker"><div><b>What should vary?</b><small>${selectedParaphrases().length} selected hooks × ${styles.length} variations = ${variationCount} captioned hooks</small></div><div class="variation-mode-switch" role="group" aria-label="Caption variation type"><button type="button" data-variation-mode="color" class="${state.ai.variationMode === "color" ? "active" : ""}">Color only</button><button type="button" data-variation-mode="position" class="${state.ai.variationMode === "position" ? "active" : ""}">Position only</button><button type="button" data-variation-mode="both" class="${state.ai.variationMode === "both" ? "active" : ""}">Color + position</button></div>${fixedColorPicker}<div class="caption-style-row ${styles.length > 3 ? "many-styles" : ""}">${styles.map((style) => `<label class="style-pill ${state.ai.selectedStyleIds.includes(style.id) ? "selected" : ""}"><input type="checkbox" data-caption-style="${style.id}" ${state.ai.selectedStyleIds.includes(style.id) ? "checked" : ""}><b>${style.label}</b><span>${style.detail}</span><em>${style.position.x}% × ${style.position.y}% · ${style.animation}</em></label>`).join("")}</div></div>` : ""}
    ${previewGridMarkup()}
  </div>`;
}

function render() {
  document.querySelectorAll("[data-parts]").forEach((button) => button.classList.toggle("active", Number(button.dataset.parts) === state.partCount));
  const parts = activeParts();
  $("uploadGrid").classList.toggle("two-parts", state.partCount === 2);
  $("uploadGrid").classList.toggle("ai-mode", state.hookMode === "ai");
  $("uploadGrid").innerHTML = parts.map((part, index) => {
    const definition = partDefinitions[part];
    const count = partCountFor(part);
    const hookSwitch = part === "hooks" ? `<div class="hook-mode-switch" role="group" aria-label="Hook source"><button type="button" data-hook-mode="manual" class="${state.hookMode === "manual" ? "active" : ""}">Upload finished hook clips</button><button type="button" data-hook-mode="ai" class="${state.hookMode === "ai" ? "active" : ""}">Create captioned hooks <span>✦</span></button></div>` : "";
    const content = part === "hooks" && state.hookMode === "ai" ? aiHookMarkup() : standardUploadMarkup(part);
    return `<section class="upload-card ${part === "hooks" && state.hookMode === "ai" ? "ai-hook-card" : ""}" data-part="${part}"><div class="card-heading"><span class="part-number">0${index + 1}</span><div><h3>${definition.label}</h3><p>${definition.help}</p></div><span class="file-count">${count} ${count === 1 ? "clip" : "clips"}</span></div>${hookSwitch}${content}</section>`;
  }).join("");

  bindUploadEvents();
  bindAiEvents();
  if (state.ai.frame && state.ai.previewVariants.length) requestAnimationFrame(paintPreviewCanvases);
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
    const missing = parts.filter((part) => !isPartReady(part)).map((part) => part === "hooks" && state.hookMode === "ai" ? "Selected hook previews" : partDefinitions[part].label);
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
  document.querySelectorAll("[data-copy-mode]").forEach((button) => button.addEventListener("click", () => { state.ai.copyMode = button.dataset.copyMode; state.ai.error = ""; render(); }));
  if ($("hookText")) $("hookText").addEventListener("input", (event) => { if (state.ai.copyMode === "claude") state.ai.hookText = event.target.value; else state.ai.manualHookText = event.target.value; });
  if ($("generateParaphrases")) $("generateParaphrases").addEventListener("click", generateParaphrases);
  if ($("useManualHooks")) $("useManualHooks").addEventListener("click", applyManualHookLines);
  document.querySelectorAll("[data-variation-mode]").forEach((button) => button.addEventListener("click", () => {
    state.ai.variationMode = button.dataset.variationMode;
    state.ai.selectedStyleIds = availableCaptionStyles().map((style) => style.id);
    syncPreviewVariants();
    resetResult();
    render();
    refreshAiPreviews(false);
  }));
  document.querySelectorAll("[data-fixed-caption-color]").forEach((button) => button.addEventListener("click", () => {
    state.ai.fixedColor = button.dataset.fixedCaptionColor;
    state.ai.selectedStyleIds = availableCaptionStyles().map((style) => style.id);
    syncPreviewVariants();
    resetResult();
    render();
    refreshAiPreviews(false);
  }));
  document.querySelectorAll("[data-paraphrase]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const item = state.ai.paraphrases.find((candidate) => candidate.id === checkbox.dataset.paraphrase);
    if (item) item.selected = checkbox.checked;
    syncPreviewVariants();
    resetResult();
    render();
    refreshAiPreviews(false);
  }));
  document.querySelectorAll("[data-caption-style]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    state.ai.selectedStyleIds = checkbox.checked ? [...new Set([...state.ai.selectedStyleIds, checkbox.dataset.captionStyle])] : state.ai.selectedStyleIds.filter((id) => id !== checkbox.dataset.captionStyle);
    syncPreviewVariants();
    resetResult();
    render();
    refreshAiPreviews(false);
  }));
  document.querySelectorAll("[data-preview-variant]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const variant = state.ai.previewVariants.find((item) => item.id === checkbox.dataset.previewVariant);
    if (variant) variant.selected = checkbox.checked;
    resetResult();
    render();
  }));
  if ($("selectAllPreviews")) $("selectAllPreviews").addEventListener("click", () => { state.ai.previewVariants.forEach((variant) => { variant.selected = true; }); resetResult(); render(); });
  if ($("clearAllPreviews")) $("clearAllPreviews").addEventListener("click", () => { state.ai.previewVariants.forEach((variant) => { variant.selected = false; }); resetResult(); render(); });
  if ($("retryPreviews")) $("retryPreviews").addEventListener("click", () => refreshAiPreviews(true));
}

function bindDropZone(drop, callback) {
  ["dragenter", "dragover"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove("dragover"); }));
  drop.addEventListener("drop", (event) => callback([...event.dataTransfer.files]));
}

async function refreshAiPreviews(recapture = false) {
  syncPreviewVariants();
  if (!state.ai.rawClip || !selectedParaphrases().length || !selectedStyles().length) {
    state.ai.frame = null;
    state.ai.previewing = false;
    state.ai.previewError = "";
    render();
    return;
  }
  const generation = ++previewGeneration;
  state.ai.previewing = true;
  state.ai.previewError = "";
  render();
  try {
    const aspect = $("aspectRatio").value;
    if (recapture || !state.ai.frame || state.ai.frame.aspect !== aspect) state.ai.frame = await captureRepresentativeFrame(state.ai.rawClip.url, aspect);
  } catch (error) {
    if (generation === previewGeneration) {
      state.ai.frame = null;
      state.ai.previewError = "This browser could not read a still frame from the clip. Try an H.264 MP4.";
    }
  } finally {
    if (generation === previewGeneration) {
      state.ai.previewing = false;
      render();
    }
  }
}

async function captureRepresentativeFrame(url, aspect) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  await waitForMediaEvent(video, "loadedmetadata");
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const target = duration > .2 ? Math.min(Math.max(duration * .25, .1), Math.min(2, duration - .05)) : 0;
  if (target > 0) {
    video.currentTime = target;
    await waitForMediaEvent(video, "seeked");
  } else {
    await waitForMediaEvent(video, "loadeddata");
  }
  const [ratioWidth, ratioHeight] = dimensions[aspect];
  const maxWidth = 320;
  const maxHeight = 360;
  const scale = Math.min(maxWidth / ratioWidth, maxHeight / ratioHeight);
  const width = Math.max(160, Math.round(ratioWidth * scale));
  const height = Math.max(100, Math.round(ratioHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  const fit = Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * fit;
  const drawHeight = video.videoHeight * fit;
  context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  video.removeAttribute("src");
  video.load();
  return { dataUrl: canvas.toDataURL("image/jpeg", .82), width, height, aspect };
}

function waitForMediaEvent(media, eventName) {
  const readyStateNeeded = { loadedmetadata: 1, loadeddata: 2 }[eventName];
  if (readyStateNeeded && media.readyState >= readyStateNeeded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${eventName}`)), 8000);
    const cleanup = () => { clearTimeout(timeout); media.removeEventListener(eventName, onReady); media.removeEventListener("error", onError); };
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error("Video frame could not be decoded")); };
    media.addEventListener(eventName, onReady, { once: true });
    media.addEventListener("error", onError, { once: true });
  });
}

async function paintPreviewCanvases() {
  const frame = state.ai.frame;
  if (!frame) return;
  const image = new Image();
  image.src = frame.dataUrl;
  await image.decode();
  const styles = availableCaptionStyles();
  document.querySelectorAll("[data-preview-canvas]").forEach((canvas) => {
    const variant = state.ai.previewVariants.find((item) => item.id === canvas.dataset.previewCanvas);
    const line = variant && state.ai.paraphrases.find((item) => item.id === variant.lineId);
    const style = variant && styles.find((item) => item.id === variant.styleId);
    if (!line || !style) return;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawCaptionPreview(context, line.text, style, canvas.width, canvas.height);
  });
}

function drawCaptionPreview(context, text, style, width, height) {
  const fontSize = Math.max(13, Math.round(Math.min(width, height) * .072));
  context.save();
  context.font = `800 ${fontSize}px ${style.fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  const maxTextWidth = width * .82;
  const lines = wrapCanvasText(context, text, maxTextWidth, 4);
  const lineHeight = fontSize * 1.14;
  const blockWidth = Math.min(maxTextWidth, Math.max(...lines.map((line) => context.measureText(line).width)));
  const blockHeight = lines.length * lineHeight;
  const centerX = width * (style.position.x / 100);
  const centerY = Math.max(blockHeight / 2 + 10, Math.min(height - blockHeight / 2 - 10, height * (style.position.y / 100)));
  if (style.boxColor) {
    const paddingX = fontSize * .55;
    const paddingY = fontSize * .38;
    context.fillStyle = style.boxColor;
    roundedRect(context, centerX - blockWidth / 2 - paddingX, centerY - blockHeight / 2 - paddingY, blockWidth + paddingX * 2, blockHeight + paddingY * 2, fontSize * .25);
    context.fill();
  }
  lines.forEach((line, index) => {
    const y = centerY - ((lines.length - 1) * lineHeight) / 2 + index * lineHeight;
    if (style.strokeColor && style.strokeWidth) {
      context.strokeStyle = style.strokeColor;
      context.lineWidth = Math.max(2, style.strokeWidth * (width / 320));
      context.strokeText(line, centerX, y);
    }
    context.fillStyle = style.color;
    context.fillText(line, centerX, y);
  });
  context.restore();
}

function wrapCanvasText(context, text, maxWidth, maxLines) {
  const words = text.trim().split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth && lines.length < maxLines - 1) { lines.push(line); line = word; }
    else line = candidate;
  });
  if (line) lines.push(line);
  return lines;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function applyManualHookLines() {
  const lines = state.ai.manualHookText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const uniqueLines = [...new Map(lines.map((line) => [line.toLocaleLowerCase(), line])).values()];
  if (!uniqueLines.length) {
    state.ai.error = "Paste at least one hook line.";
    render();
    return;
  }
  if (uniqueLines.length > 30) {
    state.ai.error = "Use 30 hook lines or fewer in one batch.";
    render();
    return;
  }
  if (uniqueLines.some((line) => line.length > 300)) {
    state.ai.error = "Each hook must be 300 characters or fewer.";
    render();
    return;
  }
  state.ai.error = "";
  state.ai.paraphrases = uniqueLines.map((text) => ({ id: crypto.randomUUID(), text, selected: true }));
  syncPreviewVariants();
  resetResult();
  render();
  if (state.ai.rawClip) refreshAiPreviews(false);
  showToast(`${uniqueLines.length} hook ${uniqueLines.length === 1 ? "line is" : "lines are"} ready to style.`);
}

async function generateParaphrases() {
  const hookText = state.ai.hookText.trim();
  if (hookText.length < 5) return showToast("Type a complete hook line first.", true);
  if (window.location.protocol === "file:") return showToast("Open Mixcut from its local launcher or Vercel site to use Claude.", true);
  state.ai.loading = true;
  state.ai.error = "";
  render();
  let generated = false;
  try {
    const response = await fetch("/api/generate-hooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hookText }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Claude could not generate variants.");
    state.ai.paraphrases = payload.paraphrases.map((text) => ({ id: crypto.randomUUID(), text, selected: true }));
    syncPreviewVariants();
    generated = true;
    resetResult();
  } catch (error) {
    state.ai.error = error.message;
  } finally {
    state.ai.loading = false;
    render();
    if (generated && state.ai.rawClip) refreshAiPreviews(false);
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

  let ffmpeg = null;
  let aiSourceName = null;
  const aiTemporaryHookName = "ai_hook_current.mp4";
  try {
    const { fetchFile } = FFmpeg;
    ffmpeg = await getVideoEngine();
    const [width, height] = dimensions[$("aspectRatio").value];
    const workingFiles = { hooks: state.files.hooks, bodies: state.files.bodies, ctas: state.files.ctas };
    if (state.hookMode === "ai") {
      workingFiles.hooks = buildAiHookDescriptors();
      aiSourceName = await prepareAiHookSource(ffmpeg, width, height, fetchFile);
    }

    const allClips = parts.flatMap((part) => workingFiles[part].filter((clip) => !clip.aiVariant).map((clip) => ({ ...clip, part })));
    const fileMap = {};
    const normalizationBase = state.hookMode === "ai" ? 8 : 4;
    const normalizationSpan = state.hookMode === "ai" ? 22 : 31;
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
    let currentAiHookId = null;
    for (let index = 0; index < combinations.length; index++) {
      const combination = combinations[index];
      const outputName = combination.map((clip, partIndex) => `${partDefinitions[parts[partIndex]].singular}-${workingFiles[parts[partIndex]].indexOf(clip) + 1}`).join("_") + ".mp4";
      const percent = 30 + Math.round((index / combinations.length) * 62);
      if (state.hookMode === "ai" && combination[0].id !== currentAiHookId) {
        safeUnlink(ffmpeg, aiTemporaryHookName);
        await renderAiHookVariant(ffmpeg, aiSourceName, combination[0], aiTemporaryHookName, width, height, percent, index + 1, total);
        normalizedMap[combination[0].id] = aiTemporaryHookName;
        currentAiHookId = combination[0].id;
      }
      updateProgress(percent, `Stitching ${outputName}`, `${index + 1} / ${total}`);
      const listName = `list_${index}.txt`;
      const inputNames = combination.map((clip) => normalizedMap[clip.id]);
      const listText = inputNames.map((name) => `file '${name}'`).join("\n") + "\n";
      ffmpeg.FS("writeFile", listName, new TextEncoder().encode(listText));
      safeUnlink(ffmpeg, outputName);
      try {
        await concatenateClips(ffmpeg, inputNames, listName, outputName);
      } catch (cause) {
        throw processingError("Every clip was prepared, but the final videos could not be joined. Reload the page and try one variation first.", cause);
      }
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
    const message = error.userMessage || "A clip could not be processed. Use an H.264 MP4 source and try again.";
    $("processTitle").textContent = "We couldn't finish this batch";
    updateProgress(0, message, "Not completed");
    showToast(message, true);
  } finally {
    if (ffmpeg) {
      safeUnlink(ffmpeg, aiTemporaryHookName);
      if (aiSourceName) safeUnlink(ffmpeg, aiSourceName);
    }
    stopProcessingTimer();
    setBusy(false);
  }
}

function buildAiHookDescriptors() {
  const styles = availableCaptionStyles();
  return selectedPreviewVariants().map((variant, index) => {
    const line = state.ai.paraphrases.find((item) => item.id === variant.lineId);
    const style = styles.find((item) => item.id === variant.styleId);
    return { id: `ai-${variant.id}`, file: { name: `generated-hook-${index + 1}.mp4`, size: 0 }, aiVariant: true, line, style };
  }).filter((clip) => clip.line && clip.style);
}

async function prepareAiHookSource(ffmpeg, width, height, fetchFile) {
  const raw = state.ai.rawClip;
  const inputName = `ai_raw.${getExtension(raw.file.name)}`;
  const normalizedInputName = "ai_raw_ready.mp4";
  ffmpeg.FS("writeFile", inputName, await fetchFile(raw.file));
  try {
    updateProgress(3, "Checking and preparing the raw hook", `0 / ${selectedPreviewVariants().length} hooks`);
    safeUnlink(ffmpeg, normalizedInputName);
    try {
      await normalizeClip(ffmpeg, inputName, normalizedInputName, width, height);
    } catch (cause) {
      throw processingError("The raw hook could not be decoded. On Mac, export it as an H.264 MP4 (Most Compatible), then try again.", cause);
    }
    return normalizedInputName;
  } finally {
    safeUnlink(ffmpeg, inputName);
  }
}

async function renderAiHookVariant(ffmpeg, sourceName, clip, outputName, width, height, progressStart, number, total) {
  const captionName = "caption_current.png";
  ffmpeg.FS("writeFile", captionName, await createCaptionOverlay(clip.line.text, clip.style, width, height));
  updateProgress(progressStart, `Rendering captioned hook ${number} / ${total}`, `${number} / ${total}`);
  try {
    await captionClip(ffmpeg, sourceName, captionName, outputName);
  } catch (cause) {
    throw processingError("The clip was prepared, but its caption could not be rendered. Try a shorter hook line or reload the page.", cause);
  } finally {
    safeUnlink(ffmpeg, captionName);
  }
}

function processingError(message, cause) { const error = new Error(message); error.userMessage = message; error.cause = cause; return error; }

async function concatenateClips(ffmpeg, inputNames, listName, outputName) {
  let copied = false;
  try {
    await ffmpeg.run("-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", "-movflags", "+faststart", outputName);
    copied = fileExists(ffmpeg, outputName);
  } catch (error) {}
  if (copied) return;

  safeUnlink(ffmpeg, outputName);
  const baseName = listName.replace(/\.txt$/, "");
  let currentName = inputNames[0];
  let previousTemporary = null;
  for (let index = 1; index < inputNames.length; index++) {
    const targetName = index === inputNames.length - 1 ? outputName : `${baseName}_merged_${index}.mp4`;
    safeUnlink(ffmpeg, targetName);
    await joinClipPair(ffmpeg, currentName, inputNames[index], targetName, `${baseName}_pair_${index}`);
    if (previousTemporary) safeUnlink(ffmpeg, previousTemporary);
    previousTemporary = targetName === outputName ? null : targetName;
    currentName = targetName;
  }
  if (!fileExists(ffmpeg, outputName)) throw new Error("FFmpeg completed without creating the joined output file.");
}

async function joinClipPair(ffmpeg, firstName, secondName, outputName, baseName) {
  const filter = "[0:v:0]setpts=PTS-STARTPTS[v0];[0:a:0]asetpts=PTS-STARTPTS[a0];[1:v:0]setpts=PTS-STARTPTS[v1];[1:a:0]asetpts=PTS-STARTPTS[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]";
  await ffmpeg.run("-i", firstName, "-i", secondName, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outputName);
  if (!fileExists(ffmpeg, outputName)) throw new Error("A pair of prepared clips could not be joined.");
}

function fileExists(ffmpeg, name) { try { return ffmpeg.FS("stat", name).size > 0; } catch (error) { return false; } }

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

async function createCaptionOverlay(text, style, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  drawCaptionPreview(canvas.getContext("2d"), text, style, width, height);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Caption image could not be created.")), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

async function captionClip(ffmpeg, inputName, captionName, outputName) {
  const filter = "[0:v:0][1:v:0]overlay=0:0:format=auto[v]";
  await ffmpeg.run("-i", inputName, "-loop", "1", "-i", captionName, "-filter_complex", filter, "-map", "[v]", "-map", "0:a:0", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-shortest", outputName);
  if (!fileExists(ffmpeg, outputName)) throw new Error("Caption overlay did not create a valid video.");
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

function cartesian(groups) { return groups.reduce((results, group) => results.flatMap((result) => group.map((item) => [...result, item])), [[]]); }
function getExtension(name) { const extension = name.split(".").pop().toLowerCase(); return /^[a-z0-9]{2,5}$/.test(extension) ? extension : "mp4"; }
function safeUnlink(ffmpeg, name) { try { ffmpeg.FS("unlink", name); } catch (error) {} }

function setBusy(busy) {
  $("generateButton").disabled = busy || !activeParts().every(isPartReady) || totalCombinations() > limits.maxCombinations;
  $("aspectRatio").disabled = busy;
  document.querySelectorAll("[data-input],[data-parts],[data-hook-mode],[data-copy-mode],[data-variation-mode],[data-fixed-caption-color],#rawHookInput,#generateParaphrases,#useManualHooks,[data-paraphrase],[data-caption-style],[data-preview-variant],#selectAllPreviews,#clearAllPreviews").forEach((element) => element.disabled = busy);
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
