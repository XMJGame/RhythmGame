(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = Object.fromEntries([
    'audio','audioFile','projectFile','dropZone','fileCard','fileName','fileMeta','replaceAudioBtn','analyzeBtn','sensitivity','sensitivityValue','analysisResult','bpmValue','beatCount','countPill','playBtn','playIcon','stopBtn','backBtn','forwardBtn','currentTime','durationTime','playbackRate','metronome','waveform','canvasShell','emptyWave','timelineHint','zoom','fitBtn','addBeatBtn','undoBtn','redoBtn','beatTableBody','tableEmpty','selectedLabel','inspectorFields','beatTimeInput','beatType','beatStrength','strengthValue','beatNote','deleteBeatBtn','projectName','saveProjectBtn','openProjectBtn','exportCsvBtn','exportJsonBtn','toastRegion','progressModal','progressBar','progressText','dragHelp'
  ].map(id => [id, $(id)]));

  const state = {
    audioBuffer: null,
    audioFile: null,
    audioUrl: null,
    waveform: [],
    beats: [],
    selectedId: null,
    bpm: 0,
    zoom: 1,
    viewStart: 0,
    draggingId: null,
    dragMoved: false,
    history: [],
    future: [],
    lastMetronomeBeat: null,
    audioContext: null,
    dirty: false
  };

  let animationFrame = 0;
  let resizeFrame = 0;
  const canvasCtx = els.waveform.getContext('2d');

  function toast(message, type = 'success') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    els.toastRegion.append(node);
    setTimeout(() => node.remove(), 3200);
  }

  function formatTime(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    const ms = Math.floor((safe % 1) * 1000);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  function fileSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function cloneBeats() {
    return state.beats.map(beat => ({ ...beat }));
  }

  function snapshot() {
    state.history.push(cloneBeats());
    if (state.history.length > 80) state.history.shift();
    state.future = [];
    updateHistoryButtons();
  }

  function restoreBeats(beats) {
    state.beats = beats.map(beat => ({ ...beat }));
    if (!state.beats.some(beat => beat.id === state.selectedId)) state.selectedId = null;
    renderAll();
    markDirty();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(cloneBeats());
    restoreBeats(state.history.pop());
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(cloneBeats());
    restoreBeats(state.future.pop());
  }

  function updateHistoryButtons() {
    els.undoBtn.disabled = !state.history.length;
    els.redoBtn.disabled = !state.future.length;
  }

  function markDirty() {
    state.dirty = true;
    scheduleLocalSave();
  }

  let saveTimer;
  function scheduleLocalSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem('rhythm-studio-autosave', JSON.stringify(projectData(false)));
      } catch (_) { /* local storage can be unavailable */ }
    }, 500);
  }

  function projectData(includeVersion = true) {
    return {
      ...(includeVersion ? { format: 'rhythm-chart-studio', version: 1 } : {}),
      name: els.projectName.value.trim() || '未命名谱面',
      audio: state.audioFile ? { name: state.audioFile.name, size: state.audioFile.size, duration: els.audio.duration || 0 } : null,
      bpm: Number(state.bpm.toFixed(2)),
      duration: Number((els.audio.duration || 0).toFixed(3)),
      createdWith: '节拍工坊',
      beats: state.beats.map((beat, index) => ({
        index: index + 1,
        time: Number(beat.time.toFixed(3)),
        type: beat.type,
        strength: beat.strength,
        note: beat.note || ''
      }))
    };
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name.replace(/[\\/:*?\"<>|]/g, '_');
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function enableAudioControls(enabled) {
    [els.analyzeBtn, els.playBtn, els.stopBtn, els.backBtn, els.forwardBtn, els.zoom, els.fitBtn, els.addBeatBtn].forEach(el => el.disabled = !enabled);
  }

  async function loadAudioFile(file) {
    if (!file || (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name))) {
      toast('请选择 MP3、WAV、OGG、M4A 等音乐文件', 'error');
      return;
    }
    if (state.beats.length && !confirm('更换音乐会清空当前节拍，继续吗？')) {
      els.audioFile.value = '';
      return;
    }
    if (file.size > 250 * 1024 * 1024) {
      toast('文件太大了，请选择 250 MB 以内的音乐', 'error');
      return;
    }
    showProgress('正在读取音乐…', 15);
    try {
      if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
      state.audioFile = file;
      state.audioUrl = URL.createObjectURL(file);
      els.audio.src = state.audioUrl;
      const arrayBuffer = await file.arrayBuffer();
      state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      showProgress('正在生成声音波形…', 48);
      state.audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer.slice(0));
      state.waveform = buildWaveform(state.audioBuffer, 2400);
      await waitForMetadata();
      state.beats = [];
      state.selectedId = null;
      state.history = [];
      state.future = [];
      state.bpm = 0;
      state.zoom = 1;
      state.viewStart = 0;
      els.zoom.value = '1';
      els.fileName.textContent = file.name;
      els.fileMeta.textContent = `${fileSize(file.size)} · ${formatTime(state.audioBuffer.duration)}`;
      els.dropZone.classList.add('hidden');
      els.fileCard.classList.remove('hidden');
      els.emptyWave.classList.add('hidden');
      els.timelineHint.textContent = '双击空白处添加，拖动节拍线调整时间';
      els.durationTime.textContent = formatTime(state.audioBuffer.duration);
      els.analysisResult.classList.add('hidden');
      enableAudioControls(true);
      renderAll();
      markDirty();
      showProgress('音乐准备好了', 100);
      setTimeout(hideProgress, 220);
      toast('音乐已载入，可以自动分析或直接播放打拍子');
    } catch (error) {
      hideProgress();
      console.error(error);
      toast('无法读取这个音乐文件，请尝试换成 MP3 或 WAV', 'error');
    }
  }

  function waitForMetadata() {
    if (Number.isFinite(els.audio.duration)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      els.audio.addEventListener('loadedmetadata', resolve, { once: true });
      els.audio.addEventListener('error', reject, { once: true });
    });
  }

  function buildWaveform(buffer, bars) {
    const channel = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / bars));
    const values = [];
    for (let i = 0; i < bars; i++) {
      let peak = 0;
      const start = i * block;
      for (let j = start; j < Math.min(start + block, channel.length); j += 3) peak = Math.max(peak, Math.abs(channel[j]));
      values.push(peak);
    }
    const max = Math.max(...values, 0.01);
    return values.map(value => value / max);
  }

  function showProgress(text, percent) {
    els.progressModal.classList.remove('hidden');
    els.progressText.textContent = text;
    els.progressBar.style.width = `${percent}%`;
  }

  function hideProgress() {
    els.progressModal.classList.add('hidden');
  }

  async function analyzeAudio() {
    if (!state.audioBuffer) return;
    showProgress('正在寻找明显的鼓点和节奏规律…', 10);
    await new Promise(resolve => setTimeout(resolve, 40));
    try {
      const channel = state.audioBuffer.getChannelData(0);
      const sampleRate = state.audioBuffer.sampleRate;
      const hop = 1024;
      const frame = 2048;
      const energies = [];
      for (let i = 0; i + frame < channel.length; i += hop) {
        let sum = 0;
        for (let j = 0; j < frame; j += 4) {
          const v = channel[i + j];
          sum += v * v;
        }
        energies.push(Math.sqrt(sum / (frame / 4)));
      }
      showProgress('正在判断哪些声音像节拍…', 38);
      await new Promise(resolve => setTimeout(resolve, 30));
      const novelty = energies.map((energy, i) => Math.max(0, energy - (energies[i - 1] || energy)));
      const smooth = novelty.map((_, i) => {
        let total = 0;
        for (let j = Math.max(0, i - 1); j <= Math.min(novelty.length - 1, i + 1); j++) total += novelty[j];
        return total / 3;
      });
      const sorted = [...smooth].sort((a, b) => a - b);
      const sensitivity = Number(els.sensitivity.value) / 100;
      const quantile = 0.93 - sensitivity * 0.22;
      const threshold = sorted[Math.floor(sorted.length * quantile)] || 0;
      const minGapFrames = Math.max(5, Math.floor((0.20 * sampleRate) / hop));
      const peaks = [];
      let last = -minGapFrames;
      for (let i = 2; i < smooth.length - 2; i++) {
        if (smooth[i] >= threshold && smooth[i] >= smooth[i - 1] && smooth[i] > smooth[i + 1]) {
          if (i - last >= minGapFrames) {
            peaks.push({ frame: i, value: smooth[i] });
            last = i;
          } else if (smooth[i] > peaks[peaks.length - 1].value) {
            peaks[peaks.length - 1] = { frame: i, value: smooth[i] };
            last = i;
          }
        }
      }
      showProgress('正在估算歌曲速度…', 66);
      await new Promise(resolve => setTimeout(resolve, 30));
      const peakTimes = peaks.map(p => p.frame * hop / sampleRate);
      const bpm = estimateBpm(peakTimes);
      const maxValue = Math.max(...peaks.map(p => p.value), 0.001);
      const detected = peaks.map((peak, index) => ({
        id: makeId(),
        time: Number((peak.frame * hop / sampleRate).toFixed(3)),
        type: (index % 4 === 0 && peak.value > maxValue * 0.52) ? 'accent' : 'beat',
        strength: Math.round(45 + (peak.value / maxValue) * 55),
        note: ''
      }));
      snapshot();
      state.beats = dedupeBeats(detected);
      state.bpm = bpm;
      state.selectedId = null;
      els.bpmValue.textContent = bpm ? bpm.toFixed(1) : '—';
      els.analysisResult.classList.remove('hidden');
      showProgress(`找到了 ${state.beats.length} 个候选节拍`, 100);
      renderAll();
      markDirty();
      setTimeout(hideProgress, 260);
      toast(`分析完成：找到 ${state.beats.length} 个候选节拍`);
    } catch (error) {
      hideProgress();
      console.error(error);
      toast('分析时遇到问题，你仍然可以播放音乐并按 T 手动打拍子', 'error');
    }
  }

  function estimateBpm(times) {
    if (times.length < 3) return 0;
    const bins = new Map();
    for (let i = 0; i < times.length; i++) {
      for (let j = i + 1; j < Math.min(times.length, i + 8); j++) {
        let interval = times[j] - times[i];
        if (interval <= 0) continue;
        let bpm = 60 / interval;
        while (bpm < 70) bpm *= 2;
        while (bpm > 190) bpm /= 2;
        const key = Math.round(bpm * 2) / 2;
        bins.set(key, (bins.get(key) || 0) + 1 / (j - i));
      }
    }
    return [...bins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
  }

  function dedupeBeats(beats) {
    return beats.sort((a, b) => a.time - b.time).filter((beat, i, list) => !i || beat.time - list[i - 1].time > 0.045);
  }

  function makeId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function addBeat(time = els.audio.currentTime, source = 'manual') {
    if (!state.audioBuffer) return;
    const clamped = Math.max(0, Math.min(time, els.audio.duration || state.audioBuffer.duration));
    snapshot();
    const beat = { id: makeId(), time: Number(clamped.toFixed(3)), type: 'beat', strength: source === 'tap' ? 90 : 80, note: '' };
    state.beats.push(beat);
    state.beats.sort((a, b) => a.time - b.time);
    state.selectedId = beat.id;
    renderAll();
    markDirty();
    if (source !== 'tap') toast(`已在 ${formatTime(beat.time)} 添加节拍`);
  }

  function deleteBeat(id = state.selectedId) {
    if (!id) return;
    const index = state.beats.findIndex(beat => beat.id === id);
    if (index < 0) return;
    snapshot();
    state.beats.splice(index, 1);
    state.selectedId = state.beats[Math.min(index, state.beats.length - 1)]?.id || null;
    renderAll();
    markDirty();
  }

  function updateSelected(changes, takeSnapshot = true) {
    const beat = state.beats.find(item => item.id === state.selectedId);
    if (!beat) return;
    if (takeSnapshot) snapshot();
    Object.assign(beat, changes);
    beat.time = Math.max(0, Math.min(Number(beat.time) || 0, els.audio.duration || Infinity));
    state.beats.sort((a, b) => a.time - b.time);
    renderAll();
    markDirty();
  }

  function renderAll() {
    renderTimeline();
    renderBeatList();
    renderInspector();
    updateCounts();
    updateHistoryButtons();
  }

  function updateCounts() {
    els.beatCount.textContent = state.beats.length;
    els.countPill.textContent = `${state.beats.length} 个`;
    els.tableEmpty.classList.toggle('hidden', state.beats.length > 0);
    els.exportCsvBtn.disabled = !state.beats.length;
    els.exportJsonBtn.disabled = !state.beats.length;
  }

  function viewDuration() {
    const duration = els.audio.duration || state.audioBuffer?.duration || 1;
    return duration / state.zoom;
  }

  function keepPlayheadVisible() {
    if (state.zoom <= 1) return;
    const duration = viewDuration();
    const time = els.audio.currentTime;
    if (time < state.viewStart || time > state.viewStart + duration) {
      state.viewStart = Math.max(0, Math.min(time - duration * .12, (els.audio.duration || 0) - duration));
    }
  }

  function timeToX(time, width) {
    return ((time - state.viewStart) / viewDuration()) * width;
  }

  function xToTime(x, width) {
    return state.viewStart + (x / width) * viewDuration();
  }

  function resizeCanvas() {
    const rect = els.canvasShell.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    els.waveform.width = Math.max(1, Math.floor(rect.width * dpr));
    els.waveform.height = Math.max(1, Math.floor(rect.height * dpr));
    canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderTimeline();
  }

  function renderTimeline() {
    const rect = els.canvasShell.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;
    canvasCtx.clearRect(0, 0, width, height);
    canvasCtx.fillStyle = '#0b1015';
    canvasCtx.fillRect(0, 0, width, height);
    const duration = viewDuration();
    const rulerHeight = 30;

    canvasCtx.strokeStyle = 'rgba(131,148,163,.16)';
    canvasCtx.fillStyle = '#697581';
    canvasCtx.font = '11px ui-monospace, monospace';
    const targetSteps = width < 600 ? 5 : 10;
    const rawStep = duration / targetSteps;
    const options = [.1,.25,.5,1,2,5,10,15,30,60,120,300];
    const step = options.find(v => v >= rawStep) || 600;
    const first = Math.ceil(state.viewStart / step) * step;
    for (let time = first; time <= state.viewStart + duration; time += step) {
      const x = timeToX(time, width);
      canvasCtx.beginPath(); canvasCtx.moveTo(x, 0); canvasCtx.lineTo(x, height); canvasCtx.stroke();
      canvasCtx.fillText(formatTime(time).slice(0, 5), x + 4, 18);
    }

    if (state.waveform.length) {
      canvasCtx.beginPath();
      canvasCtx.strokeStyle = '#657582';
      canvasCtx.lineWidth = 1;
      const mid = rulerHeight + (height - rulerHeight) / 2;
      const amp = (height - rulerHeight) * .42;
      const total = state.waveform.length;
      for (let px = 0; px < width; px++) {
        const time = xToTime(px, width);
        const idx = Math.min(total - 1, Math.floor((time / (els.audio.duration || 1)) * total));
        const value = state.waveform[Math.max(0, idx)] || 0;
        canvasCtx.moveTo(px + .5, mid - value * amp);
        canvasCtx.lineTo(px + .5, mid + value * amp);
      }
      canvasCtx.stroke();
      canvasCtx.strokeStyle = 'rgba(255,255,255,.08)';
      canvasCtx.beginPath(); canvasCtx.moveTo(0, mid); canvasCtx.lineTo(width, mid); canvasCtx.stroke();
    }

    state.beats.forEach((beat, index) => {
      const x = timeToX(beat.time, width);
      if (x < -10 || x > width + 10) return;
      const selected = beat.id === state.selectedId;
      canvasCtx.strokeStyle = selected ? '#ff6474' : beat.type === 'accent' ? '#67e8f9' : beat.type === 'note' ? '#b78cff' : '#ffd43b';
      canvasCtx.lineWidth = selected ? 3 : beat.type === 'accent' ? 2.5 : 1.5;
      canvasCtx.beginPath(); canvasCtx.moveTo(x, rulerHeight); canvasCtx.lineTo(x, height); canvasCtx.stroke();
      canvasCtx.fillStyle = canvasCtx.strokeStyle;
      canvasCtx.beginPath(); canvasCtx.moveTo(x - 5, rulerHeight); canvasCtx.lineTo(x + 5, rulerHeight); canvasCtx.lineTo(x, rulerHeight + 7); canvasCtx.closePath(); canvasCtx.fill();
      if (selected || (state.zoom >= 2 && width > 500)) {
        canvasCtx.fillStyle = selected ? '#ff6474' : '#aeb7c0';
        canvasCtx.font = '10px ui-monospace, monospace';
        canvasCtx.fillText(String(index + 1), x + 5, rulerHeight + 15);
      }
    });

    if (state.audioBuffer) {
      const playX = timeToX(els.audio.currentTime, width);
      if (playX >= 0 && playX <= width) {
        canvasCtx.strokeStyle = '#fff'; canvasCtx.lineWidth = 1;
        canvasCtx.beginPath(); canvasCtx.moveTo(playX, 0); canvasCtx.lineTo(playX, height); canvasCtx.stroke();
        canvasCtx.fillStyle = '#fff'; canvasCtx.beginPath(); canvasCtx.arc(playX, 9, 3, 0, Math.PI * 2); canvasCtx.fill();
      }
    }
  }

  function renderBeatList() {
    els.beatTableBody.innerHTML = '';
    const fragment = document.createDocumentFragment();
    state.beats.forEach((beat, index) => {
      const row = document.createElement('tr');
      row.dataset.id = beat.id;
      if (beat.id === state.selectedId) row.classList.add('selected');
      const typeLabel = beat.type === 'accent' ? '重拍' : beat.type === 'note' ? '备注点' : '普通';
      row.innerHTML = `<td>${index + 1}</td><td><code>${formatTime(beat.time)}</code></td><td><span class="type-chip ${beat.type}">${typeLabel}</span></td><td><div class="strength-bar" title="强度 ${beat.strength}%"><i style="width:${beat.strength}%"></i></div></td><td><button class="delete-row" aria-label="删除第 ${index + 1} 个节拍">×</button></td>`;
      row.addEventListener('click', event => {
        if (event.target.closest('.delete-row')) { deleteBeat(beat.id); return; }
        state.selectedId = beat.id;
        els.audio.currentTime = beat.time;
        keepPlayheadVisible();
        renderAll();
      });
      fragment.append(row);
    });
    els.beatTableBody.append(fragment);
    const selectedRow = els.beatTableBody.querySelector('tr.selected');
    if (selectedRow && document.activeElement?.closest('.beat-list') == null) selectedRow.scrollIntoView({ block: 'nearest' });
  }

  function renderInspector() {
    const beat = state.beats.find(item => item.id === state.selectedId);
    els.inspectorFields.disabled = !beat;
    if (!beat) {
      els.selectedLabel.textContent = '请选择一个节拍';
      els.beatTimeInput.value = '';
      return;
    }
    const index = state.beats.indexOf(beat) + 1;
    els.selectedLabel.textContent = `正在编辑第 ${index} 个节拍`;
    els.beatTimeInput.value = beat.time.toFixed(3);
    els.beatType.value = beat.type;
    els.beatStrength.value = beat.strength;
    els.strengthValue.textContent = `${beat.strength}%`;
    els.beatNote.value = beat.note || '';
  }

  function nearestBeatAt(x, width, tolerance = 9) {
    let closest = null;
    let distance = Infinity;
    for (const beat of state.beats) {
      const delta = Math.abs(timeToX(beat.time, width) - x);
      if (delta < tolerance && delta < distance) { closest = beat; distance = delta; }
    }
    return closest;
  }

  function canvasPointer(event) {
    const rect = els.waveform.getBoundingClientRect();
    return { x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)), width: rect.width };
  }

  function startDrag(event) {
    if (!state.audioBuffer) return;
    const { x, width } = canvasPointer(event);
    const beat = nearestBeatAt(x, width, 11);
    if (beat) {
      snapshot();
      state.draggingId = beat.id;
      state.selectedId = beat.id;
      state.dragMoved = false;
      els.dragHelp.classList.remove('hidden');
      els.waveform.setPointerCapture(event.pointerId);
      renderAll();
    } else {
      els.audio.currentTime = Math.max(0, Math.min(xToTime(x, width), els.audio.duration));
      renderTimeline();
    }
  }

  function moveDrag(event) {
    if (!state.draggingId) return;
    const { x, width } = canvasPointer(event);
    const beat = state.beats.find(item => item.id === state.draggingId);
    if (!beat) return;
    beat.time = Number(Math.max(0, Math.min(xToTime(x, width), els.audio.duration)).toFixed(3));
    state.dragMoved = true;
    els.dragHelp.textContent = formatTime(beat.time);
    renderTimeline();
    renderInspector();
  }

  function endDrag() {
    if (!state.draggingId) return;
    state.beats.sort((a, b) => a.time - b.time);
    state.draggingId = null;
    els.dragHelp.classList.add('hidden');
    els.dragHelp.textContent = '拖动以调整时间';
    renderAll();
    markDirty();
  }

  function togglePlay() {
    if (!state.audioBuffer) return;
    if (els.audio.paused) els.audio.play().catch(() => toast('浏览器阻止了播放，请再点一次播放', 'error'));
    else els.audio.pause();
  }

  function animationLoop() {
    els.currentTime.textContent = formatTime(els.audio.currentTime);
    keepPlayheadVisible();
    renderTimeline();
    if (!els.audio.paused) {
      maybeClickMetronome();
      animationFrame = requestAnimationFrame(animationLoop);
    }
  }

  function maybeClickMetronome() {
    if (!els.metronome.checked || !state.beats.length) return;
    const now = els.audio.currentTime;
    const beat = state.beats.find(item => item.time >= now - .045 && item.time <= now + .025);
    if (beat && beat.id !== state.lastMetronomeBeat) {
      state.lastMetronomeBeat = beat.id;
      clickSound(beat.type === 'accent' ? 1100 : 760);
    }
  }

  function clickSound(frequency) {
    try {
      state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const osc = state.audioContext.createOscillator();
      const gain = state.audioContext.createGain();
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(.14, state.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, state.audioContext.currentTime + .045);
      osc.connect(gain).connect(state.audioContext.destination);
      osc.start(); osc.stop(state.audioContext.currentTime + .05);
    } catch (_) { /* optional feedback */ }
  }

  function saveProject() {
    downloadFile(`${els.projectName.value || '未命名谱面'}.rhythm.json`, JSON.stringify(projectData(), null, 2), 'application/json');
    state.dirty = false;
    toast('工程已保存。下次还需要重新选择同一首音乐。');
  }

  async function openProject(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.beats)) throw new Error('missing beats');
      if (state.beats.length && !confirm('打开工程会替换当前节拍，继续吗？')) return;
      snapshot();
      state.beats = data.beats.map(beat => ({
        id: makeId(), time: Number(beat.time) || 0,
        type: ['beat','accent','note'].includes(beat.type) ? beat.type : 'beat',
        strength: Math.max(10, Math.min(100, Number(beat.strength) || 80)), note: String(beat.note || '')
      })).sort((a, b) => a.time - b.time);
      state.bpm = Number(data.bpm) || 0;
      els.projectName.value = data.name || file.name.replace(/\.rhythm\.json$|\.json$/i, '');
      els.bpmValue.textContent = state.bpm ? state.bpm.toFixed(1) : '—';
      els.analysisResult.classList.remove('hidden');
      state.selectedId = null;
      renderAll();
      markDirty();
      const audioHint = data.audio?.name ? ` 请再载入音乐“${data.audio.name}”。` : '';
      toast(`工程已打开，共 ${state.beats.length} 个节拍。${audioHint}`);
    } catch (error) {
      toast('这个文件不是有效的节拍工程', 'error');
    }
  }

  function exportCsv() {
    const rows = [['index','time_seconds','time_display','type','strength','note'], ...state.beats.map((beat, i) => [i + 1, beat.time.toFixed(3), formatTime(beat.time), beat.type, beat.strength, beat.note])];
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadFile(`${els.projectName.value || '谱面'}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast('CSV 已导出');
  }

  function exportGameJson() {
    const data = projectData();
    data.beats = data.beats.map(({ index, time, type, strength, note }) => ({ t: Math.round(time * 1000), type, strength, ...(note ? { note } : {}) }));
    data.timeUnit = 'milliseconds';
    downloadFile(`${els.projectName.value || '谱面'}.game.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('游戏 JSON 已导出，时间单位是毫秒');
  }

  async function registerWebMcpTools() {
    if (!document.modelContext?.registerTool) return;
    const register = tool => document.modelContext.registerTool(tool).catch(() => {});
    await Promise.all([
      register({
        name: 'get_chart_summary',
        description: 'Read the current rhythm chart name, BPM, duration, and beat count without changing it.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, consequentialHint: false, untrustedContentHint: false },
        execute: async () => JSON.stringify(projectData())
      }),
      register({
        name: 'add_chart_beat',
        description: 'Add one editable beat marker to the current rhythm chart at an exact time in seconds.',
        inputSchema: {
          type: 'object',
          properties: { time: { type: 'number', minimum: 0, description: 'Beat time in seconds.' } },
          required: ['time']
        },
        annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: false },
        execute: async ({ time }) => {
          if (!state.audioBuffer) return 'Load an audio file before adding beat markers.';
          addBeat(Number(time));
          return `Added a beat at ${Number(time).toFixed(3)} seconds.`;
        }
      }),
      register({
        name: 'set_chart_name',
        description: 'Change the current rhythm chart project name.',
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string', minLength: 1, maxLength: 60 } },
          required: ['name']
        },
        annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: false },
        execute: async ({ name }) => {
          els.projectName.value = String(name).slice(0, 60);
          markDirty();
          return `Chart renamed to ${els.projectName.value}.`;
        }
      })
    ]);
  }

  els.audioFile.addEventListener('change', event => loadAudioFile(event.target.files[0]));
  els.replaceAudioBtn.addEventListener('click', () => els.audioFile.click());
  ['dragenter','dragover'].forEach(type => els.dropZone.addEventListener(type, event => { event.preventDefault(); els.dropZone.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(type => els.dropZone.addEventListener(type, event => { event.preventDefault(); els.dropZone.classList.remove('dragover'); }));
  els.dropZone.addEventListener('drop', event => loadAudioFile(event.dataTransfer.files[0]));
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => { if (!event.target.closest('#dropZone')) event.preventDefault(); });
  els.sensitivity.addEventListener('input', () => els.sensitivityValue.textContent = `${els.sensitivity.value}%`);
  els.analyzeBtn.addEventListener('click', analyzeAudio);
  els.playBtn.addEventListener('click', togglePlay);
  els.stopBtn.addEventListener('click', () => { els.audio.pause(); els.audio.currentTime = 0; state.viewStart = 0; renderTimeline(); });
  els.backBtn.addEventListener('click', () => els.audio.currentTime = Math.max(0, els.audio.currentTime - 5));
  els.forwardBtn.addEventListener('click', () => els.audio.currentTime = Math.min(els.audio.duration, els.audio.currentTime + 5));
  els.playbackRate.addEventListener('change', () => els.audio.playbackRate = Number(els.playbackRate.value));
  els.audio.addEventListener('play', () => { els.playIcon.textContent = 'Ⅱ'; cancelAnimationFrame(animationFrame); animationLoop(); });
  els.audio.addEventListener('pause', () => { els.playIcon.textContent = '▶'; cancelAnimationFrame(animationFrame); renderTimeline(); });
  els.audio.addEventListener('ended', () => { els.playIcon.textContent = '▶'; state.lastMetronomeBeat = null; });
  els.audio.addEventListener('seeked', () => { state.lastMetronomeBeat = null; els.currentTime.textContent = formatTime(els.audio.currentTime); renderTimeline(); });
  els.zoom.addEventListener('input', () => { state.zoom = Number(els.zoom.value); state.viewStart = Math.max(0, Math.min(els.audio.currentTime - viewDuration() / 2, els.audio.duration - viewDuration())); renderTimeline(); });
  els.fitBtn.addEventListener('click', () => { state.zoom = 1; state.viewStart = 0; els.zoom.value = '1'; renderTimeline(); });
  els.addBeatBtn.addEventListener('click', () => addBeat());
  els.undoBtn.addEventListener('click', undo);
  els.redoBtn.addEventListener('click', redo);
  els.waveform.addEventListener('pointerdown', startDrag);
  els.waveform.addEventListener('pointermove', moveDrag);
  els.waveform.addEventListener('pointerup', endDrag);
  els.waveform.addEventListener('pointercancel', endDrag);
  els.waveform.addEventListener('dblclick', event => { const p = canvasPointer(event); if (!nearestBeatAt(p.x, p.width)) addBeat(xToTime(p.x, p.width)); });
  els.waveform.addEventListener('wheel', event => {
    if (!state.audioBuffer) return;
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      state.zoom = Math.max(1, Math.min(12, state.zoom + (event.deltaY < 0 ? .5 : -.5)));
      els.zoom.value = String(state.zoom);
    } else if (state.zoom > 1) {
      state.viewStart = Math.max(0, Math.min(state.viewStart + event.deltaY * viewDuration() / 1400, els.audio.duration - viewDuration()));
    }
    renderTimeline();
  }, { passive: false });
  els.beatTimeInput.addEventListener('change', () => updateSelected({ time: Number(els.beatTimeInput.value) }));
  els.beatType.addEventListener('change', () => updateSelected({ type: els.beatType.value }));
  els.beatStrength.addEventListener('input', () => { els.strengthValue.textContent = `${els.beatStrength.value}%`; });
  els.beatStrength.addEventListener('change', () => updateSelected({ strength: Number(els.beatStrength.value) }));
  els.beatNote.addEventListener('focus', () => {
    if (state.selectedId) snapshot();
  });
  els.beatNote.addEventListener('input', () => {
    const beat = state.beats.find(item => item.id === state.selectedId);
    if (!beat) return;
    beat.note = els.beatNote.value.slice(0, 80);
    markDirty();
  });
  els.inspectorFields.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
    const beat = state.beats.find(item => item.id === state.selectedId);
    if (beat) updateSelected({ time: beat.time + Number(button.dataset.step) });
  }));
  els.deleteBeatBtn.addEventListener('click', () => deleteBeat());
  els.saveProjectBtn.addEventListener('click', saveProject);
  els.openProjectBtn.addEventListener('click', () => els.projectFile.click());
  els.projectFile.addEventListener('change', event => openProject(event.target.files[0]));
  els.exportCsvBtn.addEventListener('click', exportCsv);
  els.exportJsonBtn.addEventListener('click', exportGameJson);
  els.projectName.addEventListener('input', markDirty);

  document.addEventListener('keydown', event => {
    if (event.target.matches('input,select,textarea')) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
    if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return; }
    if (event.key.toLowerCase() === 't' && state.audioBuffer) { event.preventDefault(); addBeat(els.audio.currentTime, 'tap'); clickSound(900); return; }
    if (event.code === 'Space' && state.audioBuffer) { event.preventDefault(); togglePlay(); return; }
    if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId) { event.preventDefault(); deleteBeat(); return; }
    if (state.selectedId && ['ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const beat = state.beats.find(item => item.id === state.selectedId);
      const amount = event.shiftKey ? .001 : .01;
      updateSelected({ time: beat.time + (event.key === 'ArrowRight' ? amount : -amount) });
    }
  });

  window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resizeCanvas); });
  window.addEventListener('beforeunload', event => { if (state.dirty && state.beats.length) { event.preventDefault(); event.returnValue = ''; } });

  try {
    const saved = JSON.parse(localStorage.getItem('rhythm-studio-autosave') || 'null');
    if (saved?.beats?.length) {
      els.projectName.value = saved.name || '未命名谱面';
      state.beats = saved.beats.map(beat => ({ ...beat, id: makeId() }));
      state.bpm = Number(saved.bpm) || 0;
      els.bpmValue.textContent = state.bpm ? state.bpm.toFixed(1) : '—';
      els.analysisResult.classList.remove('hidden');
      toast(`已恢复上次未导出的 ${state.beats.length} 个节拍，请重新载入音乐`);
    }
  } catch (_) { /* ignore corrupt autosave */ }

  resizeCanvas();
  renderAll();
  registerWebMcpTools();
})();
