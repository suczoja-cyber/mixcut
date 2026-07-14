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
  { id: "pink", label: "8x pink", color: "#FF7373" },
  { id: "black", label: "Black", color: "#111111" },
  { id: "blue", label: "Blue", color: "#2F63FF" },
  { id: "red", label: "Red", color: "#FF3B30" },
  { id: "green", label: "Green", color: "#34C759" },
  { id: "orange", label: "Orange", color: "#FF9500" },
  { id: "purple", label: "Purple", color: "#AF52DE" }
];
const captionFonts = [
  { id: "classic", label: "Classic", family: "Arial, Helvetica, sans-serif", weight: 800 },
  { id: "modern", label: "Modern", family: "Avenir Next, Helvetica Neue, Arial, sans-serif", weight: 700 },
  { id: "bold", label: "Bold", family: "Arial Black, Arial, sans-serif", weight: 900 },
  { id: "serif", label: "Serif", family: "Georgia, Times New Roman, serif", weight: 700 },
  { id: "snapchat", label: "Snapchat", family: "Helvetica Neue, Helvetica, Arial, sans-serif", weight: 400, boxColor: "rgba(0,0,0,.72)", strokeWidth: 0, fullWidthBox: true, baseFontScale: .7, lineHeight: 1.12 }
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
  ai: { rawClip: null, copyMode: "paste", selectedColorIds: ["white"], selectedFontIds: ["classic"], selectedPositionIds: ["lower"], bodySelectedColorIds: ["white"], bodySelectedFontIds: ["classic"], bodySelectedPositionIds: ["lower"], ctaSelectedColorIds: ["white"], ctaSelectedFontIds: ["classic"], ctaSelectedPositionIds: ["lower"], bodyDesignMode: "same", ctaDesignMode: "same", bodyTextMode: "none", ctaTextMode: "none", bodyCaption: "", ctaCaption: "", positionAdjustments: Object.fromEntries(["hooks", "bodies", "ctas"].map((part) => [part, Object.fromEntries(captionPositions.map((position) => [position.id, { size: 100, x: 0, y: 0 }]))])), sectionFrames: { bodies: null, ctas: null }, sectionPreviewing: { bodies: false, ctas: false }, sectionPreviewError: { bodies: "", ctas: "" }, hookText: "", manualHookText: "", paraphrases: [], selectedStyleIds: [], previewVariants: [], frame: null, previewing: false, previewError: "", loading: false, error: "" },
  zipBlob: null
};
const limits = { maxCombinations: 100 };
const dimensions = { vertical: [720, 1280], square: [1080, 1080], landscape: [1280, 720] };
let ffmpegInstance = null;
let ffmpegLogLines = [];
let activeFfmpegCommandLogs = [];
let processingStartedAt = 0;
let processingTimer = null;
let currentCountLabel = "";
let previewGeneration = 0;
let sectionPreviewGeneration = { bodies: 0, ctas: 0 };
state.ai.selectedStyleIds = availableCaptionStyles().map((style) => style.id);

if (window.location.protocol === "file:") $("fileWarning").hidden = false;

document.querySelectorAll("[data-parts]").forEach((button) => button.addEventListener("click", () => {
  if (Number(button.dataset.parts) === state.partCount) return;
  state.partCount = Number(button.dataset.parts);
  resetResult();
  render();
}));
$("aspectRatio").addEventListener("change", () => { resetResult(); render(); if (state.hookMode === "ai" && state.ai.rawClip && state.ai.paraphrases.length) refreshAiPreviews(true); if (state.hookMode === "ai") ["bodies", "ctas"].forEach((part) => { if (state.files[part].length) refreshSectionPreview(part, true); }); });

function activeParts() { return partSets[state.partCount]; }
function selectedParaphrases() { return state.ai.paraphrases.filter((item) => item.selected); }
function designIds(part, kind) {
  if (part === "hooks") return state.ai[`selected${kind}Ids`];
  return state.ai[`${part === "bodies" ? "body" : "cta"}Selected${kind}Ids`];
}
function setDesignIds(part, kind, ids) {
  if (part === "hooks") state.ai[`selected${kind}Ids`] = ids;
  else state.ai[`${part === "bodies" ? "body" : "cta"}Selected${kind}Ids`] = ids;
}
function availableCaptionStyles(part = "hooks") {
  const colors = captionColors.filter((color) => designIds(part, "Color").includes(color.id));
  const fonts = captionFonts.filter((font) => designIds(part, "Font").includes(font.id));
  const positions = captionPositions.filter((position) => designIds(part, "Position").includes(position.id));
  return positions.flatMap((position) => colors.flatMap((color) => fonts.map((font) => makeCaptionStyle(color, font, position))));
}
function makeCaptionStyle(color, font, placement) {
  const darkText = color.id === "black";
  return styleWithExtra({
    id: `${color.id}-${font.id}-${placement.id}`,
    colorId: color.id,
    fontId: font.id,
    positionId: placement.id,
    label: `${color.label} · ${font.label} · ${placement.label}`,
    detail: `${color.label} · ${font.label} · ${placement.detail}`,
    font: font.label,
    fontFamily: font.family,
    fontWeight: font.weight,
    color: color.color,
    strokeColor: darkText ? "#FFFFFF" : "#000000",
    strokeWidth: font.strokeWidth ?? 5,
    boxColor: font.boxColor || null,
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
function sectionTextMode(part) { return part === "bodies" ? state.ai.bodyTextMode : state.ai.ctaTextMode; }
function sectionDesignMode(part) { return part === "bodies" ? state.ai.bodyDesignMode : state.ai.ctaDesignMode; }
function sectionStyles(part) { return sectionDesignMode(part) === "same" ? selectedStyles() : availableCaptionStyles(part); }
function sectionCaptionLines(part) { return (part === "bodies" ? state.ai.bodyCaption : state.ai.ctaCaption).split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
function adjustedCaptionStyle(style, part) {
  const adjustment = state.ai.positionAdjustments[part][style.positionId] || { size: 100, x: 0, y: 0 };
  return { ...style, fontScale: (style.baseFontScale || 1) * adjustment.size / 100, position: { x: Math.max(0, Math.min(100, style.position.x + adjustment.x)), y: Math.max(0, Math.min(100, style.position.y + adjustment.y)) } };
}
function positionAdjustmentMarkup(part) {
  const positions = captionPositions.filter((position) => designIds(part, "Position").includes(position.id));
  return `<div class="position-adjustments"><div><b>Fine-tune each position for ${partDefinitions[part].singular}</b><small>Changes apply only to that position in this video part.</small></div>${positions.map((position) => { const value = state.ai.positionAdjustments[part][position.id]; return `<fieldset class="position-adjust-row"><legend>${position.label}</legend><label><span>Size %</span><input type="number" min="50" max="200" step="5" value="${value.size}" data-position-adjust-part="${part}" data-position-adjust-id="${position.id}" data-position-adjust-key="size"></label><label><span>Left / right</span><input type="number" min="-50" max="50" step="1" value="${value.x}" data-position-adjust-part="${part}" data-position-adjust-id="${position.id}" data-position-adjust-key="x"></label><label><span>Up / down</span><input type="number" min="-50" max="50" step="1" value="${value.y}" data-position-adjust-part="${part}" data-position-adjust-id="${position.id}" data-position-adjust-key="y"></label></fieldset>`; }).join("")}<small>0 keeps the base position. Negative moves left/up; positive moves right/down.</small></div>`;
}
function designPickerMarkup(part, start = 1) {
  const colors = designIds(part, "Color");
  const fonts = designIds(part, "Font");
  const positions = designIds(part, "Position");
  const colorPicker = `<div class="variation-choice"><div><b>${start}. Choose colors</b><small>Each checked color creates a variation.</small></div><div class="choice-grid color-grid">${captionColors.map((color) => `<label class="choice-pill ${colors.includes(color.id) ? "selected" : ""}"><input type="checkbox" data-design-part="${part}" data-caption-color="${color.id}" ${colors.includes(color.id) ? "checked" : ""}><i style="--swatch:${color.color}"></i>${color.label}</label>`).join("")}</div></div>`;
  const fontPicker = `<div class="variation-choice"><div><b>${start + 1}. Choose fonts</b><small>Snapchat includes its familiar translucent caption bar.</small></div><div class="choice-grid font-grid">${captionFonts.map((font) => `<label class="choice-pill font-pill ${fonts.includes(font.id) ? "selected" : ""}" style="--font:${font.family}"><input type="checkbox" data-design-part="${part}" data-caption-font="${font.id}" ${fonts.includes(font.id) ? "checked" : ""}><span>${font.label}</span></label>`).join("")}</div></div>`;
  const positionPicker = `<div class="variation-choice"><div><b>${start + 2}. Choose positions</b><small>Every chosen color and font is made in every checked position.</small></div><div class="choice-grid">${captionPositions.map((position) => `<label class="choice-pill ${positions.includes(position.id) ? "selected" : ""}"><input type="checkbox" data-design-part="${part}" data-caption-position="${position.id}" ${positions.includes(position.id) ? "checked" : ""}>${position.label}</label>`).join("")}</div></div>`;
  return `${colorPicker}${fontPicker}${positionPicker}${positionAdjustmentMarkup(part)}`;
}
function hookVariantCount() { return state.hookMode === "manual" ? state.files.hooks.length : (state.ai.rawClip && state.ai.frame ? selectedPreviewVariants().length : 0); }
function partCountFor(part) {
  if (part === "hooks") return hookVariantCount();
  if (state.hookMode === "ai" && (part === "bodies" || part === "ctas")) {
    const textFactor = sectionTextMode(part) === "custom" ? sectionCaptionLines(part).length : 1;
    const designFactor = sectionTextMode(part) !== "none" && sectionDesignMode(part) === "custom" ? availableCaptionStyles(part).length : 1;
    return state.files[part].length * textFactor * designFactor;
  }
  return state.files[part].length;
}
function isPartReady(part) {
  if (part !== "hooks" || state.hookMode === "manual") {
    const hasClips = state.files[part].length > 0;
    if (state.hookMode === "ai" && (part === "bodies" || part === "ctas")) {
      if (sectionTextMode(part) === "custom" && !sectionCaptionLines(part).length) return false;
      if (sectionTextMode(part) !== "none" && sectionDesignMode(part) === "custom" && !availableCaptionStyles(part).length) return false;
    }
    return hasClips;
  }
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
  if (state.hookMode === "ai" && (part === "bodies" || part === "ctas")) refreshSectionPreview(part, true);
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
  if (state.hookMode === "ai" && (part === "bodies" || part === "ctas")) refreshSectionPreview(part, true);
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

function sectionPreviewMarkup(part) {
  if (state.hookMode !== "ai" || (part !== "bodies" && part !== "ctas")) return "";
  const label = part === "bodies" ? "Body" : "CTA";
  if (!state.files[part].length) return `<div class="section-preview-panel"><b>${label} preview</b><div class="preview-empty"><b>Upload a ${label.toLowerCase()} clip</b><span>A thumbnail preview will appear here.</span></div></div>`;
  if (state.ai.sectionPreviewing[part]) return `<div class="section-preview-panel"><b>${label} preview</b><div class="preview-loading"><span></span><div><b>Capturing the ${label.toLowerCase()} frame…</b></div></div></div>`;
  if (state.ai.sectionPreviewError[part]) return `<div class="section-preview-panel"><b>${label} preview</b><div class="preview-error"><b>Preview unavailable</b><span>${escapeHtml(state.ai.sectionPreviewError[part])}</span><button type="button" data-retry-section-preview="${part}">Try again</button></div></div>`;
  const frame = state.ai.sectionFrames[part];
  if (!frame) return `<div class="section-preview-panel"><b>${label} preview</b><div class="preview-empty"><b>Preparing preview</b><span>The thumbnail will appear automatically.</span></div></div>`;
  const mode = sectionTextMode(part);
  const firstHook = selectedParaphrases()[0]?.text || "Your hook text";
  const lines = mode === "custom" ? sectionCaptionLines(part) : [mode === "same" ? firstHook : ""];
  const styles = mode === "none" ? [{ id: "no-text", label: "No text", position: { x: 50, y: 50 } }] : sectionStyles(part);
  const cards = lines.flatMap((text, lineIndex) => styles.map((style) => {
    const adjusted = mode === "none" ? style : adjustedCaptionStyle(style, part);
    const key = `${part}--${lineIndex}--${style.id}`;
    const adjustment = mode === "none" ? { size: 100 } : state.ai.positionAdjustments[part][style.positionId];
    return `<article class="section-preview-card"><canvas data-section-preview-canvas="${key}" data-section-preview-part="${part}" data-section-preview-line="${lineIndex}" data-section-preview-style="${style.id}" width="${frame.width}" height="${frame.height}"></canvas><div><b>${escapeHtml(style.label)}</b><small>${text ? escapeHtml(text) : "No caption"}</small>${text ? `<em>${Math.round(adjusted.position.x)}% × ${Math.round(adjusted.position.y)}% · ${adjustment.size}% size</em>` : ""}</div></article>`;
  })).join("");
  return `<div class="section-preview-panel"><div><b>${label} preview</b><small>Using the first uploaded clip · ${lines.length} text ${lines.length === 1 ? "version" : "versions"}</small></div><div class="section-preview-grid">${cards || `<div class="preview-empty"><b>Add text above</b><span>One non-empty line creates one variation.</span></div>`}</div></div>`;
}

function standardUploadMarkup(part) {
  const definition = partDefinitions[part];
  const captionValue = part === "bodies" ? state.ai.bodyCaption : state.ai.ctaCaption;
  const mode = sectionTextMode(part);
  const designMode = sectionDesignMode(part);
  const lineCount = sectionCaptionLines(part).length;
  const sectionName = definition.singular === "body" ? "Body" : "CTA";
  const designEditor = mode === "none" ? "" : `<div class="section-design-editor"><span>${sectionName} text design</span><div class="section-design-switch" role="group" aria-label="${sectionName} text design"><button type="button" data-section-design-mode="same" data-section-design-part="${part}" class="${designMode === "same" ? "active" : ""}">Keep hook design</button><button type="button" data-section-design-mode="custom" data-section-design-part="${part}" class="${designMode === "custom" ? "active" : ""}">Customize design</button></div>${designMode === "custom" ? designPickerMarkup(part) : `<small>Font, color, and position will match each hook variation.</small>`}</div>`;
  const captionEditor = state.hookMode === "ai" && (part === "bodies" || part === "ctas") ? `<div class="part-caption-editor"><span>${sectionName} on-screen text</span><div class="section-text-switch" role="group" aria-label="${sectionName} text behavior"><button type="button" data-section-text-mode="none" data-section-text-part="${part}" class="${mode === "none" ? "active" : ""}">No text</button><button type="button" data-section-text-mode="same" data-section-text-part="${part}" class="${mode === "same" ? "active" : ""}">Keep hook text</button><button type="button" data-section-text-mode="custom" data-section-text-part="${part}" class="${mode === "custom" ? "active" : ""}">Different text</button></div>${mode === "custom" ? `<label><span>${sectionName} text variations · one per line</span><textarea data-part-caption="${part}" rows="4" maxlength="2000" placeholder="Version one&#10;Version two&#10;Version three">${escapeHtml(captionValue)}</textarea></label><small>${lineCount || 0} text ${lineCount === 1 ? "variation" : "variations"} × ${state.files[part].length} uploaded ${state.files[part].length === 1 ? "clip" : "clips"}.</small>` : `<small>${mode === "same" ? "The exact hook text continues through this section." : "No caption will be added to this section."}</small>`}${designEditor}</div>` : "";
  return `<label class="drop-zone" data-drop="${part}"><input type="file" data-input="${part}" multiple><span class="upload-icon">+</span><b>Drop ${definition.singular} videos here</b><small>or <u>choose from Photos</u></small></label><div class="clip-list">${state.files[part].map((clip) => clipMarkup(clip, part)).join("")}</div>${captionEditor}${sectionPreviewMarkup(part)}`;
}

function syncPreviewVariants() {
  const previous = new Map(state.ai.previewVariants.map((variant) => [variant.id, variant.selected]));
  state.ai.previewVariants = selectedParaphrases().flatMap((line) => selectedStyles().map((style) => {
    const id = `${line.id}--${style.id}`;
    return { id, lineId: line.id, styleId: style.id, selected: previous.has(id) ? previous.get(id) : true };
  }));
}

function previewGridMarkup() {
  if (!state.ai.rawClip) return `<section class="thumbnail-review"><div class="thumbnail-review-head"><div><span class="section-tag">PREVIEW FILTER</span><b>Hook thumbnail previews</b><small>Preview every text and style combination before rendering.</small></div></div><div class="preview-empty"><b>Upload the raw hook video above</b><span>${state.ai.paraphrases.length ? `${state.ai.paraphrases.length} hook lines are ready. Attach the textless video to create the thumbnail grid.` : "Then add your hook lines to create the thumbnail grid."}</span></div></section>`;
  if (!state.ai.paraphrases.length) return `<section class="thumbnail-review"><div class="thumbnail-review-head"><div><span class="section-tag">PREVIEW FILTER</span><b>Hook thumbnail previews</b><small>Preview every text and style combination before rendering.</small></div></div><div class="preview-empty"><b>Add at least one hook line</b><span>Your visual combinations will appear here automatically.</span></div></section>`;
  if (state.ai.previewing) return `<div class="preview-loading"><span></span><div><b>Capturing a preview frame…</b><small>No video encoding yet — this only takes a moment.</small></div></div>`;
  if (state.ai.previewError) return `<div class="preview-error"><b>Preview unavailable</b><span>${escapeHtml(state.ai.previewError)}</span><button type="button" id="retryPreviews">Try again</button></div>`;
  if (!state.ai.frame || !state.ai.previewVariants.length) return `<div class="preview-empty"><b>Choose at least one line and one style</b><span>Your visual combinations will appear here before rendering.</span></div>`;
  const selectedCount = selectedPreviewVariants().length;
  const styles = availableCaptionStyles();
  return `<section class="thumbnail-review"><div class="thumbnail-review-head"><div><span class="section-tag">PREVIEW FILTER</span><b>Choose the exact hooks to render</b><small>${selectedCount} of ${state.ai.previewVariants.length} combinations selected</small></div><div><button type="button" id="selectAllPreviews">Select all</button><button type="button" id="clearAllPreviews">Clear</button></div></div><div class="thumbnail-grid">${state.ai.previewVariants.map((variant) => {
    const line = state.ai.paraphrases.find((item) => item.id === variant.lineId);
    const style = styles.find((item) => item.id === variant.styleId);
    const adjusted = adjustedCaptionStyle(style, "hooks");
    const adjustment = state.ai.positionAdjustments.hooks[style.positionId];
    return `<label class="thumbnail-card ${variant.selected ? "selected" : ""}"><canvas data-preview-canvas="${variant.id}" width="${state.ai.frame.width}" height="${state.ai.frame.height}"></canvas><span class="thumbnail-toggle"><input type="checkbox" data-preview-variant="${variant.id}" ${variant.selected ? "checked" : ""}><i>✓</i></span><span class="animation-badge">${escapeHtml(style.animation)}</span><div><b>${escapeHtml(style.label)}</b><small>${escapeHtml(line.text)}</small><em>${Math.round(adjusted.position.x)}% × ${Math.round(adjusted.position.y)}% · ${adjustment.size}% size</em></div></label>`;
  }).join("")}</div></section>`;
}

function aiHookMarkup() {
  const raw = state.ai.rawClip;
  const usingClaude = state.ai.copyMode === "claude";
  const copyText = usingClaude ? state.ai.hookText : state.ai.manualHookText;
  const styles = availableCaptionStyles();
  const variationCount = selectedParaphrases().length * styles.length;
  const review = state.ai.paraphrases.length ? `<div class="paraphrase-review"><div class="review-heading"><div><b>Choose the lines to preview</b><small>${selectedParaphrases().length} of ${state.ai.paraphrases.length} selected</small></div></div>${state.ai.paraphrases.map((item, index) => `<label class="paraphrase-option"><input type="checkbox" data-paraphrase="${item.id}" ${item.selected ? "checked" : ""}><span>${index + 1}</span><p>${escapeHtml(item.text)}</p></label>`).join("")}</div>` : "";
  return `<div class="ai-hook-panel">
    ${raw ? `<div class="raw-hook-clip"><video src="${raw.url}" muted preload="metadata"></video><div><b>${escapeHtml(raw.file.name)}</b><span>${formatBytes(raw.file.size)} · raw textless clip</span></div><button type="button" id="removeRawHook" aria-label="Remove raw hook">×</button></div>` : `<label class="drop-zone raw-hook-zone" id="rawHookDrop"><input type="file" id="rawHookInput" accept="video/*,.mp4,.mov,.m4v,.webm,.hevc"><span class="upload-icon">+</span><b>Add one raw, textless hook</b><small>Required for thumbnails · drop it here or <u>choose from Photos</u></small></label>`}
    <div class="ai-copy-form"><div class="copy-source-switch" role="group" aria-label="Hook text source"><button type="button" data-copy-mode="paste" class="${!usingClaude ? "active" : ""}">Paste my hook lines</button><button type="button" data-copy-mode="claude" class="${usingClaude ? "active" : ""}">Generate with Claude <span>✦</span></button></div><label for="hookText">${usingClaude ? "Original hook line" : "Your hook lines · one per line"}</label><textarea id="hookText" maxlength="${usingClaude ? 300 : 4000}" rows="${usingClaude ? 3 : 6}" placeholder="${usingClaude ? "12 years of school and nobody told me about this" : "12 years of school and nobody told me about this&#10;Nobody teaches you this in school&#10;I wish I had learned this years ago"}">${escapeHtml(copyText)}</textarea><button class="copy-action" type="button" id="${usingClaude ? "generateParaphrases" : "useManualHooks"}" ${state.ai.loading ? "disabled" : ""}>${usingClaude ? (state.ai.loading ? "Claude is writing…" : state.ai.paraphrases.length ? "Regenerate paraphrases" : "Generate paraphrases") : (state.ai.paraphrases.length ? "Replace with these hook lines" : "Use these hook lines")}<span>${usingClaude ? "✦" : "→"}</span></button>${state.ai.error ? `<p class="ai-error">${escapeHtml(state.ai.error)}</p>` : ""}<small class="privacy-note">${usingClaude ? "Only this text is sent to Claude. Your video stays in this browser." : "No API call. Blank lines are ignored and your text stays in this browser."}</small></div>
    ${review}
    ${state.ai.paraphrases.length ? `<div class="style-picker"><div><b>Build your caption variations</b><small>${selectedParaphrases().length} hooks × ${state.ai.selectedColorIds.length} colors × ${state.ai.selectedFontIds.length} fonts × ${state.ai.selectedPositionIds.length} positions = ${variationCount} captioned hooks</small></div>${designPickerMarkup("hooks")}</div>` : ""}
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
    const hasSectionVariations = state.hookMode === "ai" && part !== "hooks" && (sectionTextMode(part) === "custom" || (sectionTextMode(part) !== "none" && sectionDesignMode(part) === "custom"));
    const countUnit = hasSectionVariations ? (count === 1 ? "variation" : "variations") : (count === 1 ? "clip" : "clips");
    const hookSwitch = part === "hooks" ? `<div class="hook-mode-switch" role="group" aria-label="Hook source"><button type="button" data-hook-mode="manual" class="${state.hookMode === "manual" ? "active" : ""}">Upload finished hook clips</button><button type="button" data-hook-mode="ai" class="${state.hookMode === "ai" ? "active" : ""}">Create captioned hooks <span>✦</span></button></div>` : "";
    const content = part === "hooks" && state.hookMode === "ai" ? aiHookMarkup() : standardUploadMarkup(part);
    return `<section class="upload-card ${part === "hooks" && state.hookMode === "ai" ? "ai-hook-card" : ""}" data-part="${part}"><div class="card-heading"><span class="part-number">0${index + 1}</span><div><h3>${definition.label}</h3><p>${definition.help}</p></div><span class="file-count">${count} ${countUnit}</span></div>${hookSwitch}${content}</section>`;
  }).join("");

  bindUploadEvents();
  bindAiEvents();
  if (state.ai.frame && state.ai.previewVariants.length) requestAnimationFrame(paintPreviewCanvases);
  ["bodies", "ctas"].forEach((part) => { if (state.ai.sectionFrames[part]) requestAnimationFrame(() => paintSectionPreviewCanvases(part)); });
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
    if (state.hookMode === "ai") ["bodies", "ctas"].forEach((part) => { if (state.files[part].length) refreshSectionPreview(part, false); });
  }));
  const rawInput = $("rawHookInput");
  if (rawInput) rawInput.addEventListener("change", () => setRawHook([...rawInput.files]));
  const rawDrop = $("rawHookDrop");
  if (rawDrop) bindDropZone(rawDrop, setRawHook);
  if ($("removeRawHook")) $("removeRawHook").addEventListener("click", removeRawHook);
  document.querySelectorAll("[data-copy-mode]").forEach((button) => button.addEventListener("click", () => { state.ai.copyMode = button.dataset.copyMode; state.ai.error = ""; render(); }));
  document.querySelectorAll("[data-section-text-mode]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.sectionTextPart === "bodies") state.ai.bodyTextMode = button.dataset.sectionTextMode; else state.ai.ctaTextMode = button.dataset.sectionTextMode;
    resetResult();
    render();
    refreshSectionPreview(button.dataset.sectionTextPart, false);
  }));
  document.querySelectorAll("[data-section-design-mode]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.sectionDesignPart === "bodies") state.ai.bodyDesignMode = button.dataset.sectionDesignMode; else state.ai.ctaDesignMode = button.dataset.sectionDesignMode;
    resetResult();
    render();
    refreshSectionPreview(button.dataset.sectionDesignPart, false);
  }));
  document.querySelectorAll("[data-part-caption]").forEach((field) => {
    field.addEventListener("input", () => { if (field.dataset.partCaption === "bodies") state.ai.bodyCaption = field.value; else state.ai.ctaCaption = field.value; });
    field.addEventListener("change", () => { resetResult(); render(); refreshSectionPreview(field.dataset.partCaption, false); });
  });
  document.querySelectorAll("[data-position-adjust-part]").forEach((field) => {
    field.addEventListener("input", () => {
      const part = field.dataset.positionAdjustPart;
      const positionId = field.dataset.positionAdjustId;
      const key = field.dataset.positionAdjustKey;
      const minimum = key === "size" ? 50 : -50;
      const maximum = key === "size" ? 200 : 50;
      state.ai.positionAdjustments[part][positionId][key] = Math.max(minimum, Math.min(maximum, Number(field.value) || 0));
      if (part === "hooks") paintPreviewCanvases(); else paintSectionPreviewCanvases(part);
    });
    field.addEventListener("change", () => { resetResult(); render(); });
  });
  if ($("hookText")) $("hookText").addEventListener("input", (event) => { if (state.ai.copyMode === "claude") state.ai.hookText = event.target.value; else state.ai.manualHookText = event.target.value; });
  if ($("generateParaphrases")) $("generateParaphrases").addEventListener("click", generateParaphrases);
  if ($("useManualHooks")) $("useManualHooks").addEventListener("click", applyManualHookLines);
  document.querySelectorAll("[data-caption-color]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const part = checkbox.dataset.designPart || "hooks";
    const current = designIds(part, "Color");
    setDesignIds(part, "Color", checkbox.checked ? [...new Set([...current, checkbox.dataset.captionColor])] : current.filter((id) => id !== checkbox.dataset.captionColor));
    if (part === "hooks") { state.ai.selectedStyleIds = availableCaptionStyles().map((style) => style.id); syncPreviewVariants(); }
    resetResult();
    render();
    if (part === "hooks") refreshAiPreviews(false); else refreshSectionPreview(part, false);
  }));
  document.querySelectorAll("[data-caption-font]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const part = checkbox.dataset.designPart || "hooks";
    const current = designIds(part, "Font");
    setDesignIds(part, "Font", checkbox.checked ? [...new Set([...current, checkbox.dataset.captionFont])] : current.filter((id) => id !== checkbox.dataset.captionFont));
    if (part === "hooks") { state.ai.selectedStyleIds = availableCaptionStyles().map((style) => style.id); syncPreviewVariants(); }
    resetResult();
    render();
    if (part === "hooks") refreshAiPreviews(false); else refreshSectionPreview(part, false);
  }));
  document.querySelectorAll("[data-caption-position]").forEach((checkbox) => checkbox.addEventListener("change", () => {
    const part = checkbox.dataset.designPart || "hooks";
    const current = designIds(part, "Position");
    setDesignIds(part, "Position", checkbox.checked ? [...new Set([...current, checkbox.dataset.captionPosition])] : current.filter((id) => id !== checkbox.dataset.captionPosition));
    if (part === "hooks") { state.ai.selectedStyleIds = availableCaptionStyles().map((style) => style.id); syncPreviewVariants(); }
    resetResult();
    render();
    if (part === "hooks") { refreshAiPreviews(false); ["bodies", "ctas"].forEach((section) => { if (state.files[section].length && sectionDesignMode(section) === "same") refreshSectionPreview(section, false); }); }
    else refreshSectionPreview(part, false);
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
  document.querySelectorAll("[data-retry-section-preview]").forEach((button) => button.addEventListener("click", () => refreshSectionPreview(button.dataset.retrySectionPreview, true)));
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

async function refreshSectionPreview(part, recapture = false) {
  const clip = state.files[part][0];
  if (!clip) {
    state.ai.sectionFrames[part] = null;
    state.ai.sectionPreviewing[part] = false;
    state.ai.sectionPreviewError[part] = "";
    render();
    return;
  }
  const generation = ++sectionPreviewGeneration[part];
  state.ai.sectionPreviewing[part] = true;
  state.ai.sectionPreviewError[part] = "";
  render();
  try {
    const aspect = $("aspectRatio").value;
    if (recapture || !state.ai.sectionFrames[part] || state.ai.sectionFrames[part].aspect !== aspect) state.ai.sectionFrames[part] = await captureRepresentativeFrame(clip.url, aspect);
  } catch (error) {
    if (generation === sectionPreviewGeneration[part]) {
      state.ai.sectionFrames[part] = null;
      state.ai.sectionPreviewError[part] = "This browser could not read a still frame from the clip. Try an H.264 MP4.";
    }
  } finally {
    if (generation === sectionPreviewGeneration[part]) {
      state.ai.sectionPreviewing[part] = false;
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
    drawCaptionPreview(context, line.text, adjustedCaptionStyle(style, "hooks"), canvas.width, canvas.height);
  });
}

async function paintSectionPreviewCanvases(part) {
  const frame = state.ai.sectionFrames[part];
  if (!frame) return;
  const image = new Image();
  image.src = frame.dataUrl;
  await image.decode();
  const mode = sectionTextMode(part);
  const lines = mode === "custom" ? sectionCaptionLines(part) : [mode === "same" ? (selectedParaphrases()[0]?.text || "Your hook text") : ""];
  const styles = sectionStyles(part);
  document.querySelectorAll(`[data-section-preview-part="${part}"]`).forEach((canvas) => {
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (mode === "none") return;
    const style = styles.find((item) => item.id === canvas.dataset.sectionPreviewStyle);
    const text = lines[Number(canvas.dataset.sectionPreviewLine)] || "";
    if (style && text) drawCaptionPreview(context, text, adjustedCaptionStyle(style, part), canvas.width, canvas.height);
  });
}

function drawCaptionPreview(context, text, style, width, height) {
  const fontSize = Math.max(8, Math.round(Math.min(width, height) * .072 * (style.fontScale || 1)));
  context.save();
  context.font = `${style.fontWeight || 800} ${fontSize}px ${style.fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  const maxTextWidth = width * .82;
  const lines = wrapCanvasText(context, text, maxTextWidth, 4);
  const lineHeight = fontSize * (style.lineHeight || 1.14);
  const blockWidth = Math.min(maxTextWidth, Math.max(...lines.map((line) => context.measureText(line).width)));
  const blockHeight = lines.length * lineHeight;
  const centerX = width * (style.position.x / 100);
  const centerY = Math.max(blockHeight / 2 + 10, Math.min(height - blockHeight / 2 - 10, height * (style.position.y / 100)));
  if (style.boxColor) {
    const paddingX = fontSize * .55;
    const paddingY = fontSize * .38;
    context.fillStyle = style.boxColor;
    if (style.fullWidthBox) context.fillRect(0, centerY - blockHeight / 2 - paddingY, width, blockHeight + paddingY * 2);
    else {
      roundedRect(context, centerX - blockWidth / 2 - paddingX, centerY - blockHeight / 2 - paddingY, blockWidth + paddingX * 2, blockHeight + paddingY * 2, fontSize * .25);
      context.fill();
    }
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

const zipCrcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function zipCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index++) crc = zipCrcTable[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function zipDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function zipHeader(size) {
  const bytes = new Uint8Array(size);
  return { bytes, view: new DataView(bytes.buffer) };
}

class StoreZipBuilder {
  constructor(folder) { this.folder = folder.replace(/\/$/, ""); this.parts = []; this.entries = []; this.offset = 0; }
  add(fileName, data) {
    const name = new TextEncoder().encode(`${this.folder}/${fileName}`);
    const size = data.byteLength;
    const crc = zipCrc32(data);
    const stamp = zipDateTime();
    const { bytes: header, view } = zipHeader(30);
    view.setUint32(0, 0x04034B50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x0800, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, name.length, true);
    view.setUint16(28, 0, true);
    this.parts.push(new Blob([header, name, data], { type: "application/octet-stream" }));
    this.entries.push({ name, size, crc, stamp, offset: this.offset });
    this.offset += header.length + name.length + size;
  }
  toBlob() {
    const centralOffset = this.offset;
    const centralParts = [];
    let centralSize = 0;
    this.entries.forEach((entry) => {
      const { bytes: header, view } = zipHeader(46);
      view.setUint32(0, 0x02014B50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 20, true);
      view.setUint16(8, 0x0800, true);
      view.setUint16(10, 0, true);
      view.setUint16(12, entry.stamp.time, true);
      view.setUint16(14, entry.stamp.date, true);
      view.setUint32(16, entry.crc, true);
      view.setUint32(20, entry.size, true);
      view.setUint32(24, entry.size, true);
      view.setUint16(28, entry.name.length, true);
      view.setUint32(42, entry.offset, true);
      centralParts.push(header, entry.name);
      centralSize += header.length + entry.name.length;
    });
    const { bytes: end, view } = zipHeader(22);
    view.setUint32(0, 0x06054B50, true);
    view.setUint16(8, this.entries.length, true);
    view.setUint16(10, this.entries.length, true);
    view.setUint32(12, centralSize, true);
    view.setUint32(16, centralOffset, true);
    return new Blob([...this.parts, ...centralParts, end], { type: "application/zip" });
  }
}

$("generateButton").addEventListener("click", generateVideos);
$("downloadButton").addEventListener("click", downloadZip);

async function generateVideos() {
  const parts = activeParts();
  const total = totalCombinations();
  if (!total || total > limits.maxCombinations || !parts.every(isPartReady)) return;
  if (!window.FFmpeg) return showToast("The video tools couldn't load. Refresh and try again.", true);

  setBusy(true);
  ffmpegLogLines = [];
  activeFfmpegCommandLogs = [];
  startProcessingTimer();
  $("processPanel").hidden = false;
  $("successState").hidden = true;
  $("processTitle").textContent = "Preparing your videos…";
  $("processPanel").scrollIntoView({ behavior: "smooth", block: "center" });
  updateProgress(0, "Loading the video engine", `0 / ${total}`);

  let ffmpeg = null;
  let aiSource = null;
  const aiTemporaryHookName = "ai_hook_current.mp4";
  try {
    const { fetchFile } = FFmpeg;
    ffmpeg = await getVideoEngine();
    const [width, height] = dimensions[$("aspectRatio").value];
    const workingFiles = { hooks: state.files.hooks, bodies: state.files.bodies, ctas: state.files.ctas };
    if (state.hookMode === "ai") {
      workingFiles.hooks = buildAiHookDescriptors();
      workingFiles.bodies = buildSectionDescriptors("bodies");
      workingFiles.ctas = buildSectionDescriptors("ctas");
      aiSource = await prepareAiHookSource(ffmpeg, width, height, fetchFile);
    }

    const allClips = state.hookMode === "ai" ? parts.filter((part) => part !== "hooks").flatMap((part) => state.files[part].map((clip) => ({ ...clip, part }))) : parts.flatMap((part) => workingFiles[part].map((clip) => ({ ...clip, part })));
    const fileMap = {};
    const normalizationBase = state.hookMode === "ai" ? 8 : 4;
    const normalizationSpan = state.hookMode === "ai" ? 22 : 31;
    updateProgress(normalizationBase, "Reading your source clips", `0 / ${total}`);

    for (let index = 0; index < allClips.length; index++) {
      const clip = allClips[index];
      if (clip.preparedFsName) { fileMap[clip.id] = clip.preparedFsName; continue; }
      fileMap[clip.id] = `source_${index + 1}.${getExtension(clip.file.name)}`;
    }

    const normalizedMap = {};
    for (let index = 0; index < allClips.length; index++) {
      const clip = allClips[index];
      if (clip.preparedFsName) { normalizedMap[clip.id] = clip.preparedFsName; continue; }
      const outputName = `ready_${index + 1}.mp4`;
      let normalizationInput = fileMap[clip.id];
      let browserPreparedName = null;
      const clipStart = normalizationBase + (index / allClips.length) * normalizationSpan;
      const clipShare = normalizationSpan / allClips.length;
      const clipLabel = `Clip ${index + 1} / ${allClips.length}`;
      updateProgress(Math.round(clipStart), `Preparing ${clip.file.name}`, clipLabel);
      ffmpeg.setProgress(({ ratio }) => {
        const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
        updateProgress(Math.round(clipStart + safeRatio * clipShare), `Preparing ${clip.file.name}`, clipLabel);
      });
      safeUnlink(ffmpeg, outputName);
      safeUnlink(ffmpeg, normalizationInput);
      ffmpeg.FS("writeFile", normalizationInput, await fetchFile(clip.file));
      try {
        await normalizeClip(ffmpeg, normalizationInput, outputName, width, height);
      } catch (nativeCause) {
        safeUnlink(ffmpeg, outputName);
        updateProgress(Math.round(clipStart), `Making ${clip.file.name} compatible with the Mac video decoder`, clipLabel);
        browserPreparedName = `browser_source_${index + 1}.webm`;
        safeUnlink(ffmpeg, browserPreparedName);
        try {
          ffmpeg.FS("writeFile", browserPreparedName, await transcodeHookInBrowser(clip.file, width, height));
          await normalizeClip(ffmpeg, browserPreparedName, outputName, width, height);
        } catch (browserCause) {
          throw processingError(`“${clip.file.name}” could not be decoded. Browser check: ${browserCause.message} Videos saved from Messages may use HEVC; on Mac, open it in QuickTime and export/save an H.264 MP4, then upload that copy.`, nativeCause);
        }
      }
      if (browserPreparedName) safeUnlink(ffmpeg, browserPreparedName);
      safeUnlink(ffmpeg, fileMap[clip.id]);
      normalizedMap[clip.id] = outputName;
    }

    const zip = new StoreZipBuilder("mixcut-variations");
    const combinations = cartesian(parts.map((part) => workingFiles[part]));
    let sharedTailName = null;
    let sharedTailListName = null;
    if (state.hookMode === "ai" && sectionTextMode("bodies") === "none" && sectionTextMode("ctas") === "none" && parts.length === 3 && workingFiles.bodies.length === 1 && workingFiles.ctas.length === 1) {
      sharedTailName = "shared_body_cta.mp4";
      sharedTailListName = "shared_body_cta.txt";
      const sharedNames = [normalizedMap[workingFiles.bodies[0].sourceId], normalizedMap[workingFiles.ctas[0].sourceId]];
      ffmpeg.FS("writeFile", sharedTailListName, new TextEncoder().encode(sharedNames.map((name) => `file '${name}'`).join("\n") + "\n"));
      safeUnlink(ffmpeg, sharedTailName);
      updateProgress(29, "Preparing the shared Body + CTA once", `0 / ${total}`);
      await concatenateClips(ffmpeg, sharedNames, sharedTailListName, sharedTailName);
      sharedNames.forEach((name) => safeUnlink(ffmpeg, name));
    }
    let currentAiHookId = null;
    let captionedPartMap = {};
    let captionedPartNames = [];
    for (let index = 0; index < combinations.length; index++) {
      const combination = combinations[index];
      const outputName = combination.map((clip, partIndex) => `${partDefinitions[parts[partIndex]].singular}-${workingFiles[parts[partIndex]].indexOf(clip) + 1}`).join("_") + ".mp4";
      const percent = 30 + Math.round((index / combinations.length) * 62);
      if (state.hookMode === "ai" && combination[0].id !== currentAiHookId) {
        captionedPartNames.forEach((name) => safeUnlink(ffmpeg, name));
        captionedPartMap = {};
        captionedPartNames = [];
        safeUnlink(ffmpeg, aiTemporaryHookName);
        await renderAiHookVariant(ffmpeg, aiSource, combination[0], aiTemporaryHookName, width, height, percent, index + 1, total);
        normalizedMap[combination[0].id] = aiTemporaryHookName;
        currentAiHookId = combination[0].id;
      }
      if (state.hookMode === "ai") {
        for (let partIndex = 1; partIndex < combination.length; partIndex++) {
          const partClip = combination[partIndex];
          if (partClip.captionMode === "none" || captionedPartMap[partClip.id]) continue;
          const captionText = partClip.captionMode === "same" ? combination[0].line.text : partClip.captionText;
          const captionedName = `captioned_${parts[partIndex]}_${captionedPartNames.length + 1}.mp4`;
          safeUnlink(ffmpeg, captionedName);
          await renderSectionCaption(ffmpeg, normalizedMap[partClip.sourceId], captionText, partClip.captionStyle || combination[0].style, captionedName, width, height, partDefinitions[parts[partIndex]].label, percent, index + 1, total);
          captionedPartMap[partClip.id] = captionedName;
          captionedPartNames.push(captionedName);
        }
      }
      updateProgress(percent, `Stitching ${outputName}`, `${index + 1} / ${total}`);
      const listName = `list_${index}.txt`;
      const inputNames = sharedTailName ? [normalizedMap[combination[0].id], sharedTailName] : combination.map((clip, partIndex) => partIndex === 0 ? normalizedMap[clip.id] : (captionedPartMap[clip.id] || normalizedMap[clip.sourceId]));
      const listText = inputNames.map((name) => `file '${name}'`).join("\n") + "\n";
      ffmpeg.FS("writeFile", listName, new TextEncoder().encode(listText));
      safeUnlink(ffmpeg, outputName);
      try {
        await concatenateClips(ffmpeg, inputNames, listName, outputName);
      } catch (cause) {
        throw processingError("Every clip was prepared, but the final videos could not be joined. Reload the page and try one variation first.", cause);
      }
      zip.add(outputName, ffmpeg.FS("readFile", outputName));
      safeUnlink(ffmpeg, outputName);
      safeUnlink(ffmpeg, listName);
    }
    captionedPartNames.forEach((name) => safeUnlink(ffmpeg, name));

    updateProgress(92, "Packing everything into a ZIP", `${total} / ${total}`);
    state.zipBlob = zip.toBlob();
    updateProgress(100, "Finished", `${total} / ${total}`);
    $("processTitle").textContent = "All done. Ready to test.";
    $("successCopy").textContent = `${total} ${state.partCount}-part video ${total === 1 ? "variation is" : "variations are"} ready to download.`;
    $("successState").hidden = false;
    updateWorkflow(4);
    showToast("Your video variations are ready.");
  } catch (error) {
    console.error(error);
    const message = error.userMessage || `A clip could not be processed. ${ffmpegFailureDetail(error)}`;
    $("processTitle").textContent = "We couldn't finish this batch";
    updateProgress(0, message, "Not completed");
    showToast(message, true);
  } finally {
    if (ffmpeg) {
      safeUnlink(ffmpeg, aiTemporaryHookName);
      safeUnlink(ffmpeg, "shared_body_cta.mp4");
      safeUnlink(ffmpeg, "shared_body_cta.txt");
      if (aiSource) safeUnlink(ffmpeg, aiSource.name);
    }
    stopProcessingTimer();
    setBusy(false);
  }
}

function buildAiHookDescriptors() {
  const styles = availableCaptionStyles();
  const variants = selectedPreviewVariants().slice();
  return variants.map((variant, index) => {
    const line = state.ai.paraphrases.find((item) => item.id === variant.lineId);
    const style = styles.find((item) => item.id === variant.styleId);
    return { id: `ai-${variant.id}`, file: { name: `generated-hook-${index + 1}.mp4`, size: 0 }, aiVariant: true, line, style };
  }).filter((clip) => clip.line && clip.style);
}

function buildSectionDescriptors(part) {
  const mode = sectionTextMode(part);
  const lines = mode === "custom" ? sectionCaptionLines(part) : [""];
  const styles = mode !== "none" && sectionDesignMode(part) === "custom" ? availableCaptionStyles(part) : [null];
  return state.files[part].flatMap((clip) => lines.flatMap((text, index) => styles.map((style) => ({
    ...clip,
    id: `${clip.id}--${mode}-${index}--${style?.id || "hook-design"}`,
    sourceId: clip.id,
    captionMode: mode,
    captionText: text,
    captionStyle: style
  }))));
}

async function prepareAiHookSource(ffmpeg, width, height, fetchFile) {
  const raw = state.ai.rawClip;
  const inputName = `ai_raw.${getExtension(raw.file.name)}`;
  const normalizedInputName = "ai_raw_ready.mp4";
  const browserReadyName = "ai_browser_ready.webm";
  try {
    updateProgress(3, "Checking and preparing the raw hook", `0 / ${selectedPreviewVariants().length} hooks`);
    safeUnlink(ffmpeg, browserReadyName);
    try {
      const browserReadyData = await transcodeHookInBrowser(raw.file, width, height);
      ffmpeg.FS("writeFile", browserReadyName, browserReadyData);
      if (!fileExists(ffmpeg, browserReadyName)) throw new Error("The browser conversion did not create a video file.");
      return { name: browserReadyName, data: browserReadyData.slice() };
    } catch (browserCause) {
      ffmpeg.FS("writeFile", inputName, await fetchFile(raw.file));
    }
    safeUnlink(ffmpeg, normalizedInputName);
    try {
      await normalizeClip(ffmpeg, inputName, normalizedInputName, width, height);
    } catch (cause) {
      throw processingError("The raw hook could not be decoded. On Mac, export it as an H.264 MP4 (Most Compatible), then try again.", cause);
    }
    if (!fileExists(ffmpeg, normalizedInputName)) throw new Error("The prepared raw hook file was not created.");
    return { name: normalizedInputName, data: ffmpeg.FS("readFile", normalizedInputName).slice() };
  } finally {
    safeUnlink(ffmpeg, inputName);
  }
}

async function transcodeHookInBrowser(file, width, height) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error("Browser video conversion is unavailable.");
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const sourceUrl = URL.createObjectURL(file);
  canvas.width = width;
  canvas.height = height;
  video.src = sourceUrl;
  video.preload = "auto";
  video.playsInline = true;
  video.muted = true;
  await new Promise((resolve, reject) => {
    video.addEventListener("loadeddata", resolve, { once: true });
    video.addEventListener("error", () => reject(new Error("The browser could not decode this hook clip.")), { once: true });
    video.load();
  });

  const canvasStream = canvas.captureStream(30);
  const capture = video.captureStream || video.webkitCaptureStream;
  const sourceStream = capture ? capture.call(video) : null;
  sourceStream?.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
  const mimeType = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
  const pixels = width * height;
  const videoBitsPerSecond = Math.max(8000000, Math.min(16000000, Math.round(pixels * 10)));
  const recorder = new MediaRecorder(canvasStream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond });
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
  const stopped = new Promise((resolve, reject) => {
    recorder.addEventListener("stop", resolve, { once: true });
    recorder.addEventListener("error", () => reject(new Error("The browser video conversion failed.")), { once: true });
  });
  const context = canvas.getContext("2d");
  let frameRequest = 0;
  const drawFrame = () => {
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
    const drawWidth = video.videoWidth * scale;
    const drawHeight = video.videoHeight * scale;
    context.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    if (!video.ended && !video.paused) frameRequest = requestAnimationFrame(drawFrame);
  };

  try {
    recorder.start(250);
    await video.play();
    drawFrame();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("The browser video conversion timed out.")), Math.max(15000, (video.duration || 5) * 2000 + 10000));
      video.addEventListener("ended", () => { clearTimeout(timeout); resolve(); }, { once: true });
      video.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("The hook stopped during browser conversion.")); }, { once: true });
    });
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    const output = new Blob(chunks, { type: mimeType || "video/webm" });
    if (!output.size) throw new Error("The browser conversion created an empty video.");
    return new Uint8Array(await output.arrayBuffer());
  } finally {
    cancelAnimationFrame(frameRequest);
    video.pause();
    if (recorder.state !== "inactive") recorder.stop();
    canvasStream.getTracks().forEach((track) => track.stop());
    sourceStream?.getTracks().forEach((track) => track.stop());
    URL.revokeObjectURL(sourceUrl);
  }
}

async function renderAiHookVariant(ffmpeg, source, clip, outputName, width, height, progressStart, number, total) {
  const captionName = "caption_current.png";
  if (!fileExists(ffmpeg, source.name)) ffmpeg.FS("writeFile", source.name, source.data);
  ffmpeg.FS("writeFile", captionName, await createCaptionOverlay(clip.line.text, adjustedCaptionStyle(clip.style, "hooks"), width, height));
  updateProgress(progressStart, `Rendering captioned hook ${number} / ${total}`, `${number} / ${total}`);
  try {
    await captionClip(ffmpeg, source.name, captionName, outputName);
  } catch (cause) {
    throw processingError(`The caption could not be rendered. ${ffmpegFailureDetail(cause)}`, cause);
  } finally {
    safeUnlink(ffmpeg, captionName);
  }
}

async function renderSectionCaption(ffmpeg, sourceName, text, style, outputName, width, height, sectionLabel, progressStart, number, total) {
  const captionName = `caption_${sectionLabel.toLowerCase()}.png`;
  const part = sectionLabel === "Bodies" ? "bodies" : "ctas";
  ffmpeg.FS("writeFile", captionName, await createCaptionOverlay(text, adjustedCaptionStyle(style, part), width, height));
  updateProgress(progressStart, `Rendering ${sectionLabel} text for this style`, `${number} / ${total}`);
  try {
    await captionClip(ffmpeg, sourceName, captionName, outputName);
  } catch (cause) {
    throw processingError(`The ${sectionLabel.toLowerCase()} caption could not be rendered. ${ffmpegFailureDetail(cause)}`, cause);
  } finally {
    safeUnlink(ffmpeg, captionName);
  }
}

function processingError(message, cause) { const error = new Error(message); error.userMessage = message; error.cause = cause; return error; }

async function concatenateClips(ffmpeg, inputNames, listName, outputName) {
  safeUnlink(ffmpeg, outputName);
  try {
    await runFfmpeg(ffmpeg, "-fflags", "+genpts", "-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", outputName);
    if (fileExists(ffmpeg, outputName)) return;
  } catch (error) {}

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
  await runFfmpeg(ffmpeg, "-i", firstName, "-i", secondName, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outputName);
  if (!fileExists(ffmpeg, outputName)) throw new Error("A pair of prepared clips could not be joined.");
}

function fileExists(ffmpeg, name) { try { return ffmpeg.FS("stat", name).size > 0; } catch (error) { return false; } }

async function getVideoEngine() {
  if (ffmpegInstance?.isLoaded()) return ffmpegInstance;
  ffmpegInstance = FFmpeg.createFFmpeg({ log: false, corePath: new URL("vendor/ffmpeg-core.js", window.location.href).href });
  ffmpegInstance.setLogger(({ type, message }) => {
    const line = `${type}: ${message}`;
    ffmpegLogLines.push(line);
    activeFfmpegCommandLogs.push(line);
    if (ffmpegLogLines.length > 160) ffmpegLogLines.shift();
    window.__mixcutFfmpegLogs = ffmpegLogLines.slice();
  });
  await ffmpegInstance.load();
  return ffmpegInstance;
}

async function runFfmpeg(ffmpeg, ...args) {
  activeFfmpegCommandLogs = [];
  try {
    await ffmpeg.run(...args);
  } catch (error) {
    throw new Error(ffmpegFailureDetail(error));
  }
  const failedLine = findFfmpegFailure(activeFfmpegCommandLogs);
  if (failedLine) throw new Error(cleanFfmpegLine(failedLine));
}

function cleanFfmpegLine(line) { return String(line || "").replace(/^(?:fferr|ffout|info):\s*/i, "").trim(); }
function findFfmpegFailure(lines) {
  const specific = [...lines].reverse().find((line) => !/conversion failed!?\s*$/i.test(line) && /error (?:initializing|reinitializing|while processing)|invalid data|no such file|option not found|cannot allocate memory|out of memory|aborted|failed to inject|failed to configure|resource temporarily unavailable|killed/i.test(line));
  return specific || [...lines].reverse().find((line) => /conversion failed/i.test(line));
}
function ffmpegFailureDetail(error) {
  const direct = error?.message && !/^(?:ffmpeg\.run error|conversion failed!?)/i.test(error.message) ? error.message : "";
  const logged = findFfmpegFailure(ffmpegLogLines);
  return cleanFfmpegLine(direct || logged || error?.message || "Reload the page and try one variation first.");
}

function baseVideoFilter(width, height) { return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS`; }

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
  const filter = "[0:v:0]setpts=PTS-STARTPTS[base];[1:v:0]setpts=PTS-STARTPTS[caption];[base][caption]overlay=0:0:format=auto:eof_action=repeat:repeatlast=1[v]";
  const outputOptions = ["-af", "aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];
  try {
    await runFfmpeg(ffmpeg, "-i", inputName, "-i", captionName, "-filter_complex", filter, "-map", "[v]", "-map", "0:a:0", ...outputOptions, outputName);
  } catch (error) {
    safeUnlink(ffmpeg, outputName);
    await runFfmpeg(ffmpeg, "-i", inputName, "-i", captionName, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-filter_complex", filter, "-map", "[v]", "-map", "2:a:0", ...outputOptions, "-shortest", outputName);
  }
  if (!fileExists(ffmpeg, outputName)) throw new Error("Caption overlay did not create a valid video.");
}

async function transcodeWithAudioFallback(ffmpeg, inputName, outputName, filter) {
  const common = ["-vf", filter, "-af", "aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];
  try {
    await runFfmpeg(ffmpeg, "-i", inputName, "-map", "0:v:0", "-map", "0:a:0", ...common, outputName);
  } catch (error) {
    safeUnlink(ffmpeg, outputName);
    await runFfmpeg(ffmpeg, "-i", inputName, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-map", "0:v:0", "-map", "1:a:0", ...common, "-shortest", outputName);
  }
}

function cartesian(groups) { return groups.reduce((results, group) => results.flatMap((result) => group.map((item) => [...result, item])), [[]]); }
function getExtension(name) { const extension = name.split(".").pop().toLowerCase(); return /^[a-z0-9]{2,5}$/.test(extension) ? extension : "mp4"; }
function safeUnlink(ffmpeg, name) { try { ffmpeg.FS("unlink", name); } catch (error) {} }

function setBusy(busy) {
  $("generateButton").disabled = busy || !activeParts().every(isPartReady) || totalCombinations() > limits.maxCombinations;
  $("aspectRatio").disabled = busy;
  document.querySelectorAll("[data-input],[data-parts],[data-hook-mode],[data-copy-mode],[data-section-text-mode],[data-section-design-mode],[data-part-caption],[data-position-adjust-part],[data-caption-color],[data-caption-font],[data-caption-position],#rawHookInput,#generateParaphrases,#useManualHooks,[data-paraphrase],[data-preview-variant],#selectAllPreviews,#clearAllPreviews").forEach((element) => element.disabled = busy);
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
