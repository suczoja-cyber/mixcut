const state = { hooks: [], demos: [], ctas: [], zipBlob: null };
const categories = ["hooks", "demos", "ctas"];
const limits = { maxCombinations: 100 };
const dimensions = { vertical: [720, 1280], square: [1080, 1080], landscape: [1280, 720] };
document.documentElement.dataset.processingTools = `${typeof window.FFmpeg}:${typeof window.JSZip}`;
let ffmpegInstance = null;
let processingStartedAt = 0;
let processingTimer = null;
let currentCountLabel = "";

const $ = (id) => document.getElementById(id);

if (window.location.protocol === "file:") {
  $("fileWarning").hidden = false;
}

categories.forEach((category) => {
  const input = $(`${category}Input`);
  const drop = $(`${category}Drop`);
  input.addEventListener("change", () => addFiles(category, [...input.files]));
  ["dragenter", "dragover"].forEach((eventName) => drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    drop.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((eventName) => drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    drop.classList.remove("dragover");
  }));
  drop.addEventListener("drop", (event) => addFiles(category, [...event.dataTransfer.files]));
});

function addFiles(category, files) {
  const videos = files.filter((file) => file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi|mpeg|mpg|hevc)$/i.test(file.name));
  if (videos.length !== files.length) showToast("Some files were skipped because they aren't supported videos.", true);
  videos.forEach((file) => {
    const duplicate = state[category].some((item) => item.file.name === file.name && item.file.size === file.size);
    if (!duplicate) state[category].push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
  });
  $(`${category}Input`).value = "";
  render();
}

function removeFile(category, id) {
  const item = state[category].find((clip) => clip.id === id);
  if (item) URL.revokeObjectURL(item.url);
  state[category] = state[category].filter((clip) => clip.id !== id);
  render();
}

function totalCombinations() {
  return state.hooks.length * state.demos.length * state.ctas.length;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function render() {
  categories.forEach((category) => {
    const count = state[category].length;
    $(`${category}Count`).textContent = `${count} ${count === 1 ? "clip" : "clips"}`;
    $(`${category}List`).innerHTML = state[category].map((clip) => `
      <div class="clip">
        <video src="${clip.url}" muted preload="metadata"></video>
        <div class="clip-info"><b title="${escapeHtml(clip.file.name)}">${escapeHtml(clip.file.name)}</b><span>${formatBytes(clip.file.size)}</span></div>
        <button class="remove-clip" type="button" data-category="${category}" data-id="${clip.id}" aria-label="Remove ${escapeHtml(clip.file.name)}">×</button>
      </div>`).join("");
  });
  document.querySelectorAll(".remove-clip").forEach((button) => button.addEventListener("click", () => removeFile(button.dataset.category, button.dataset.id)));

  const total = totalCombinations();
  $("formulaHooks").textContent = state.hooks.length;
  $("formulaDemos").textContent = state.demos.length;
  $("formulaCtas").textContent = state.ctas.length;
  $("formulaTotal").textContent = total;
  const ready = categories.every((category) => state[category].length > 0) && total <= limits.maxCombinations;
  $("generateButton").disabled = !ready;
  $("resetButton").disabled = !categories.some((category) => state[category].length);
  $("readyDot").classList.toggle("ready", ready);

  if (total > limits.maxCombinations) {
    $("readyTitle").textContent = `${total} combinations is too many for one batch`;
    $("readyText").textContent = `Remove a few clips to stay at or below ${limits.maxCombinations}.`;
  } else if (ready) {
    $("readyTitle").textContent = `${total} unique ${total === 1 ? "video" : "videos"} ready to make`;
    $("readyText").textContent = "They'll be named and packed into one ZIP.";
  } else {
    const missing = categories.filter((category) => !state[category].length).map((c) => c === "ctas" ? "CTAs" : c);
    $("readyTitle").textContent = "Add clips to all 3 sections";
    $("readyText").textContent = missing.length ? `Still needed: ${missing.join(", ")}.` : "Your combination count will appear here.";
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

$("resetButton").addEventListener("click", () => {
  categories.forEach((category) => {
    state[category].forEach((clip) => URL.revokeObjectURL(clip.url));
    state[category] = [];
  });
  state.zipBlob = null;
  $("processPanel").hidden = true;
  render();
});

$("generateButton").addEventListener("click", generateVideos);
$("downloadButton").addEventListener("click", downloadZip);

async function generateVideos() {
  const total = totalCombinations();
  if (!total || total > limits.maxCombinations) return;
  if (!window.FFmpeg || !window.JSZip) {
    showToast("The video tools couldn't load. Check your internet connection and try again.", true);
    return;
  }

  setBusy(true);
  startProcessingTimer();
  const panel = $("processPanel");
  panel.hidden = false;
  $("successState").hidden = true;
  panel.scrollIntoView({ behavior: "smooth", block: "center" });
  updateProgress(0, "Loading the video engine", `0 / ${total}`);

  try {
    const { fetchFile } = FFmpeg;
    const ffmpeg = await getVideoEngine();
    updateProgress(3, "Reading your source clips", `0 / ${total}`);

    const fileMap = {};
    for (const category of categories) {
      for (let index = 0; index < state[category].length; index++) {
        const clip = state[category][index];
        const extension = getExtension(clip.file.name);
        const fsName = `${category}_${index + 1}.${extension}`;
        fileMap[clip.id] = fsName;
        ffmpeg.FS("writeFile", fsName, await fetchFile(clip.file));
      }
    }

    const [width, height] = dimensions[$("aspectRatio").value];
    const allClips = categories.flatMap((category) => state[category]);
    const normalizedMap = {};

    for (let index = 0; index < allClips.length; index++) {
      const clip = allClips[index];
      const normalizedName = `ready_${index + 1}.mp4`;
      const clipStart = 4 + (index / allClips.length) * 31;
      const clipShare = 31 / allClips.length;
      const clipLabel = `Clip ${index + 1} / ${allClips.length}`;
      updateProgress(Math.round(clipStart), `Preparing ${clip.file.name}`, clipLabel);
      ffmpeg.setProgress(({ ratio }) => {
        const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
        updateProgress(Math.round(clipStart + safeRatio * clipShare), `Preparing ${clip.file.name}`, clipLabel);
      });
      await normalizeClip(ffmpeg, fileMap[clip.id], normalizedName, width, height);
      updateProgress(Math.round(clipStart + clipShare), `Prepared ${clip.file.name}`, clipLabel);
      normalizedMap[clip.id] = normalizedName;
    }

    const zip = new JSZip();
    const outputFolder = zip.folder("mixcut-variations");
    const combinations = cartesian(state.hooks, state.demos, state.ctas);

    for (let index = 0; index < combinations.length; index++) {
      const [hook, demo, cta] = combinations[index];
      const outputName = `hook-${state.hooks.indexOf(hook) + 1}_demo-${state.demos.indexOf(demo) + 1}_cta-${state.ctas.indexOf(cta) + 1}.mp4`;
      const percent = 35 + Math.round((index / combinations.length) * 57);
      updateProgress(percent, `Stitching ${outputName}`, `${index + 1} / ${total}`);
      const listName = `list_${index}.txt`;
      const listText = [hook, demo, cta].map((clip) => `file '${normalizedMap[clip.id]}'`).join("\n");
      ffmpeg.FS("writeFile", listName, new TextEncoder().encode(listText));
      await ffmpeg.run("-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", "-movflags", "+faststart", outputName);
      const output = ffmpeg.FS("readFile", outputName);
      outputFolder.file(outputName, output);
      ffmpeg.FS("unlink", outputName);
      ffmpeg.FS("unlink", listName);
    }

    updateProgress(92, "Packing everything into a ZIP", `${total} / ${total}`);
    state.zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" }, (metadata) => {
      updateProgress(92 + Math.round(metadata.percent * .08), "Packing everything into a ZIP", `${total} / ${total}`);
    });
    updateProgress(100, "Finished", `${total} / ${total}`);
    $("processTitle").textContent = "All done — nice work.";
    $("successCopy").textContent = `${total} video ${total === 1 ? "variation is" : "variations are"} packed and ready to download.`;
    $("successState").hidden = false;
    showToast("Your video variations are ready.");
  } catch (error) {
    console.error(error);
    $("processTitle").textContent = "We couldn't finish this batch";
    const localFileIssue = window.location.protocol === "file:";
    const failureMessage = localFileIssue
      ? "Open Mixcut through http://127.0.0.1:4173, then try again."
      : "A clip could not be converted. Try exporting it as MP4 (H.264).";
    updateProgress(0, failureMessage, "Not completed");
    showToast(localFileIssue ? "The local file view blocked the video engine." : "A source clip uses a codec this browser cannot convert.", true);
  } finally {
    stopProcessingTimer();
    setBusy(false);
  }
}

async function getVideoEngine() {
  if (ffmpegInstance?.isLoaded()) return ffmpegInstance;
  const { createFFmpeg } = FFmpeg;
  ffmpegInstance = createFFmpeg({
    log: false,
    corePath: new URL("vendor/ffmpeg-core.js", window.location.href).href
  });
  await ffmpegInstance.load();
  return ffmpegInstance;
}

async function normalizeClip(ffmpeg, inputName, outputName, width, height) {
  const videoFilter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,format=yuv420p`;
  const common = ["-vf", videoFilter, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];
  try {
    await ffmpeg.run("-i", inputName, "-map", "0:v:0", "-map", "0:a:0", ...common, outputName);
  } catch (error) {
    safeUnlink(ffmpeg, outputName);
    await ffmpeg.run(
      "-i", inputName, "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-map", "0:v:0", "-map", "1:a:0", ...common, "-shortest", outputName
    );
  }
}

function safeUnlink(ffmpeg, fileName) {
  try { ffmpeg.FS("unlink", fileName); } catch (error) { /* File was never created. */ }
}

function cartesian(hooks, demos, ctas) {
  const combinations = [];
  hooks.forEach((hook) => demos.forEach((demo) => ctas.forEach((cta) => combinations.push([hook, demo, cta]))));
  return combinations;
}

function getExtension(name) {
  const extension = name.split(".").pop().toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(extension) ? extension : "mp4";
}

function setBusy(isBusy) {
  $("generateButton").disabled = isBusy || !categories.every((category) => state[category].length);
  $("resetButton").disabled = isBusy || !categories.some((category) => state[category].length);
  $("aspectRatio").disabled = isBusy;
  categories.forEach((category) => $(`${category}Input`).disabled = isBusy);
  $("generateButton").querySelector("span").textContent = isBusy ? "Making your videos…" : "I'm done — make my videos";
}

function updateProgress(percent, status, count) {
  $("progressPercent").textContent = `${Math.min(100, percent)}%`;
  $("progressBar").style.width = `${Math.min(100, percent)}%`;
  $("processStatus").textContent = status;
  currentCountLabel = count;
  renderProcessCount();
}

function startProcessingTimer() {
  processingStartedAt = Date.now();
  clearInterval(processingTimer);
  processingTimer = setInterval(renderProcessCount, 1000);
}

function stopProcessingTimer() {
  clearInterval(processingTimer);
  processingTimer = null;
  renderProcessCount();
}

function renderProcessCount() {
  if (!processingStartedAt) {
    $("processCount").textContent = currentCountLabel;
    return;
  }
  const seconds = Math.max(0, Math.floor((Date.now() - processingStartedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  $("processCount").textContent = `${currentCountLabel} · ${minutes}:${remainder} elapsed`;
}

function downloadZip() {
  if (!state.zipBlob) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(state.zipBlob);
  link.download = `mixcut-${totalCombinations()}-variations.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

let toastTimer;
function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

render();

if (new URLSearchParams(window.location.search).has("engine-test")) {
  getVideoEngine()
    .then(() => document.documentElement.dataset.engineTest = "ready")
    .catch((error) => {
      document.documentElement.dataset.engineTest = `failed:${error.message}`;
      console.error(error);
    });
}
