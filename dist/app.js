(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = Object.fromEntries([
    'audio','audioFile','projectFile','dropZone','fileCard','fileName','fileMeta','replaceAudioBtn','analyzeBtn','analysisDensity','sensitivity','sensitivityValue','analysisResult','bpmValue','beatCount','countPill','playBtn','playIcon','stopBtn','backBtn','forwardBtn','currentTime','durationTime','playbackRate','metronome','waveform','canvasShell','emptyWave','timelineHint','zoom','fitBtn','addBeatBtn','undoBtn','redoBtn','beatTableBody','tableEmpty','selectedLabel','inspectorFields','beatTimeInput','beatType','beatStrength','strengthValue','beatNote','deleteBeatBtn','projectName','saveProjectBtn','openProjectBtn','exportCsvBtn','exportJsonBtn','toastRegion','progressModal','progressBar','progressText','dragHelp','laneCount','snapDivision','noteType','holdLengthWrap','holdLength','laneCanvas','laneEmpty','laneKeys','noteCount','clearNotesBtn','testModeBtn','generateChartBtn','laneModeHelp','judgementPop'
  ].map(id => [id, $(id)]));

  const state = {
    audioBuffer: null,
    audioFile: null,
    audioUrl: null,
    waveform: [],
    beats: [],
    notes: [],
    laneCount: 4,
    beatOffset: 0,
    selectedNoteId: null,
    testMode: false,
    hitNotes: new Set(),
    activeLanes: new Set(),
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
  const laneCtx = els.laneCanvas.getContext('2d');
  const KEY_LAYOUTS = {
    2: ['D', 'K'],
    3: ['F', 'Space', 'J'],
    4: ['D', 'F', 'J', 'K'],
    5: ['D', 'F', 'Space', 'J', 'K'],
    6: ['S', 'D', 'F', 'J', 'K', 'L']
  };

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

  function cloneEditorState() {
    return {
      beats: state.beats.map(beat => ({ ...beat })),
      notes: state.notes.map(note => ({ ...note })),
      laneCount: state.laneCount,
      beatOffset: state.beatOffset
    };
  }

  function snapshot() {
    state.history.push(cloneEditorState());
    if (state.history.length > 80) state.history.shift();
    state.future = [];
    updateHistoryButtons();
  }

  function restoreEditorState(saved) {
    const normalized = Array.isArray(saved) ? { beats: saved, notes: [], laneCount: state.laneCount, beatOffset: state.beatOffset } : saved;
    state.beats = (normalized.beats || []).map(beat => ({ ...beat }));
    state.notes = (normalized.notes || []).map(note => ({ ...note }));
    state.laneCount = Math.max(2, Math.min(6, Number(normalized.laneCount) || 4));
    state.beatOffset = Number(normalized.beatOffset) || 0;
    els.laneCount.value = String(state.laneCount);
    if (!state.beats.some(beat => beat.id === state.selectedId)) state.selectedId = null;
    if (!state.notes.some(note => note.id === state.selectedNoteId)) state.selectedNoteId = null;
    renderAll();
    markDirty();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(cloneEditorState());
    restoreEditorState(state.history.pop());
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(cloneEditorState());
    restoreEditorState(state.future.pop());
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
      ...(includeVersion ? { format: 'rhythm-chart-studio', version: 2 } : {}),
      name: els.projectName.value.trim() || '未命名谱面',
      audio: state.audioFile ? { name: state.audioFile.name, size: state.audioFile.size, duration: els.audio.duration || 0 } : null,
      bpm: Number(state.bpm.toFixed(2)),
      beatOffset: Number(state.beatOffset.toFixed(3)),
      laneCount: state.laneCount,
      snapDivision: Number(els.snapDivision.value),
      duration: Number((els.audio.duration || 0).toFixed(3)),
      createdWith: '节拍工坊',
      beats: state.beats.map((beat, index) => ({
        index: index + 1,
        time: Number(beat.time.toFixed(3)),
        type: beat.type,
        strength: beat.strength,
        note: beat.note || ''
      })),
      notes: state.notes.map((note, index) => ({
        index: index + 1,
        time: Number(note.time.toFixed(3)),
        lane: note.lane,
        type: note.type,
        ...(note.type === 'hold' ? { endTime: Number(note.endTime.toFixed(3)) } : {})
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
    els.generateChartBtn.disabled = !enabled || !state.beats.length;
    els.testModeBtn.disabled = !enabled || !state.notes.length;
  }

  async function loadAudioFile(file) {
    if (!file || (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name))) {
      toast('请选择 MP3、WAV、OGG、M4A 等音乐文件', 'error');
      return;
    }
    if ((state.beats.length || state.notes.length) && !confirm('更换音乐会清空当前节拍和轨道音符，继续吗？')) {
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
      state.notes = [];
      state.selectedId = null;
      state.selectedNoteId = null;
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
    showProgress('正在分离鼓点和持续声音…', 10);
    await new Promise(resolve => setTimeout(resolve, 40));
    try {
      const sampleRate = state.audioBuffer.sampleRate;
      const hop = 512;
      const envelope = buildOnsetEnvelope(state.audioBuffer, hop);
      const frameRate = sampleRate / hop;
      showProgress('正在寻找稳定的重复间隔…', 38);
      await new Promise(resolve => setTimeout(resolve, 30));
      const tempo = estimateTempo(envelope, frameRate);
      const bpm = tempo.bpm;
      const interval = 60 / bpm;
      const phase = findBeatPhase(envelope, frameRate, interval);
      state.beatOffset = phase;
      showProgress('正在把候选声音对齐到节拍网格…', 66);
      await new Promise(resolve => setTimeout(resolve, 30));
      const density = els.analysisDensity.value;
      const detected = buildBeatGrid(envelope, frameRate, bpm, phase, state.audioBuffer.duration, density, Number(els.sensitivity.value));
      snapshot();
      state.beats = dedupeBeats(detected);
      state.bpm = bpm;
      state.selectedId = null;
      els.bpmValue.textContent = bpm ? bpm.toFixed(1) : '—';
      els.analysisResult.classList.remove('hidden');
      showProgress(`整理出 ${state.beats.length} 个规则节拍`, 100);
      renderAll();
      markDirty();
      setTimeout(hideProgress, 260);
      const densityLabel = density === 'concise' ? '精简' : density === 'standard' ? '标准' : '细致';
      toast(`分析完成：${bpm.toFixed(1)} BPM，${densityLabel}模式保留 ${state.beats.length} 个节拍`);
    } catch (error) {
      hideProgress();
      console.error(error);
      toast('分析时遇到问题，你仍然可以播放音乐并按 T 手动打拍子', 'error');
    }
  }

  function buildOnsetEnvelope(buffer, hop) {
    const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i));
    const frame = 1024;
    const rms = [];
    const brightness = [];
    for (let start = 0; start + frame < buffer.length; start += hop) {
      let energy = 0;
      let high = 0;
      for (let j = 4; j < frame; j += 4) {
        let sample = 0;
        let previous = 0;
        for (const channel of channels) {
          sample += channel[start + j];
          previous += channel[start + j - 4];
        }
        sample /= channels.length;
        previous /= channels.length;
        energy += sample * sample;
        high += Math.abs(sample - previous);
      }
      rms.push(Math.sqrt(energy / (frame / 4)));
      brightness.push(high / (frame / 4));
    }
    const novelty = rms.map((value, i) => {
      if (!i) return 0;
      const energyRise = Math.max(0, value - rms[i - 1]);
      const brightRise = Math.max(0, brightness[i] - brightness[i - 1]);
      return energyRise + brightRise * .65;
    });
    const cleaned = novelty.map((value, i) => {
      let local = 0;
      let count = 0;
      for (let j = Math.max(0, i - 14); j <= Math.min(novelty.length - 1, i + 14); j++) { local += novelty[j]; count++; }
      const adaptive = local / Math.max(1, count);
      return Math.max(0, value - adaptive * .72);
    });
    const smooth = cleaned.map((_, i) => ((cleaned[i - 1] || 0) + cleaned[i] * 2 + (cleaned[i + 1] || 0)) / 4);
    const max = Math.max(...smooth, .0001);
    return smooth.map(value => value / max);
  }

  function estimateTempo(envelope, frameRate) {
    let best = { bpm: 120, score: -Infinity };
    for (let bpm = 65; bpm <= 180; bpm += .25) {
      const lag = Math.round(frameRate * 60 / bpm);
      let score = 0;
      let weight = 0;
      for (let i = lag; i < envelope.length; i++) {
        const emphasis = 1 + envelope[i] + envelope[i - lag];
        score += envelope[i] * envelope[i - lag] * emphasis;
        weight += emphasis;
      }
      const doubleLag = lag * 2;
      if (doubleLag < envelope.length) {
        for (let i = doubleLag; i < envelope.length; i += 2) score += envelope[i] * envelope[i - doubleLag] * .2;
      }
      score /= Math.max(1, weight);
      const centerPrior = 1 - Math.min(.12, Math.abs(bpm - 120) / 1200);
      score *= centerPrior;
      if (score > best.score) best = { bpm, score };
    }
    return best;
  }

  function findBeatPhase(envelope, frameRate, interval) {
    const period = Math.max(1, Math.round(interval * frameRate));
    let bestPhase = 0;
    let bestScore = -1;
    for (let phase = 0; phase < period; phase++) {
      let score = 0;
      for (let i = phase; i < envelope.length; i += period) {
        score += Math.max(envelope[i - 1] || 0, envelope[i] || 0, envelope[i + 1] || 0);
      }
      if (score > bestScore) { bestScore = score; bestPhase = phase; }
    }
    return bestPhase / frameRate;
  }

  function envelopeAt(envelope, frameRate, time, radiusSeconds = .055) {
    const center = Math.round(time * frameRate);
    const radius = Math.max(1, Math.round(radiusSeconds * frameRate));
    let best = { value: 0, frame: center };
    for (let i = Math.max(0, center - radius); i <= Math.min(envelope.length - 1, center + radius); i++) {
      if (envelope[i] > best.value) best = { value: envelope[i], frame: i };
    }
    return best;
  }

  function buildBeatGrid(envelope, frameRate, bpm, phase, duration, density, sensitivity) {
    const interval = 60 / bpm;
    const candidates = [];
    for (let time = phase; time < duration; time += interval) {
      const onset = envelopeAt(envelope, frameRate, time);
      candidates.push({ gridTime: time, refinedTime: onset.frame / frameRate, strength: onset.value });
    }
    if (!candidates.length) return [];
    const values = candidates.map(item => item.strength).sort((a, b) => a - b);
    const weakCut = values[Math.floor(values.length * Math.max(.05, .42 - sensitivity / 240))] || 0;
    let selected = candidates;
    if (density === 'concise') {
      const evenScore = candidates.filter((_, i) => i % 2 === 0).reduce((sum, item) => sum + item.strength, 0);
      const oddScore = candidates.filter((_, i) => i % 2 === 1).reduce((sum, item) => sum + item.strength, 0);
      const parity = oddScore > evenScore ? 1 : 0;
      selected = candidates.filter((_, i) => i % 2 === parity);
    } else if (density === 'detailed') {
      const expanded = [];
      candidates.forEach((item, i) => {
        expanded.push(item);
        if (i < candidates.length - 1) {
          const halfTime = item.gridTime + interval / 2;
          const onset = envelopeAt(envelope, frameRate, halfTime, .04);
          if (onset.value >= weakCut * 1.15) expanded.push({ gridTime: halfTime, refinedTime: onset.frame / frameRate, strength: onset.value, half: true });
        }
      });
      selected = expanded;
    }
    const maxStrength = Math.max(...selected.map(item => item.strength), .001);
    return selected
      .filter((item, i) => i === 0 || item.strength >= weakCut * .55)
      .map((item, index) => {
        const refinement = Math.abs(item.refinedTime - item.gridTime) <= .07 ? item.refinedTime : item.gridTime;
        return {
          id: makeId(),
          time: Number(Math.max(0, refinement).toFixed(3)),
          type: !item.half && index % (density === 'concise' ? 2 : 4) === 0 ? 'accent' : 'beat',
          strength: Math.round(45 + item.strength / maxStrength * 55),
          confidence: Number((item.strength / maxStrength).toFixed(2)),
          note: ''
        };
      });
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
    renderLaneEditor();
    renderBeatList();
    renderInspector();
    updateCounts();
    updateHistoryButtons();
  }

  function updateCounts() {
    els.beatCount.textContent = state.beats.length;
    els.countPill.textContent = `${state.beats.length} 个`;
    els.tableEmpty.classList.toggle('hidden', state.beats.length > 0);
    els.noteCount.textContent = state.notes.length;
    els.laneEmpty.classList.toggle('hidden', state.notes.length > 0);
    els.clearNotesBtn.disabled = !state.notes.length;
    els.testModeBtn.disabled = !state.notes.length || !state.audioBuffer;
    els.generateChartBtn.disabled = !state.beats.length || !state.audioBuffer;
    els.exportCsvBtn.disabled = !state.beats.length && !state.notes.length;
    els.exportJsonBtn.disabled = !state.beats.length && !state.notes.length;
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
    const laneRect = els.laneCanvas.parentElement.getBoundingClientRect();
    els.laneCanvas.width = Math.max(1, Math.floor(laneRect.width * dpr));
    els.laneCanvas.height = Math.max(1, Math.floor(laneRect.height * dpr));
    laneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderTimeline();
    renderLaneEditor();
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

  function beatDuration() {
    return state.bpm > 0 ? 60 / state.bpm : .5;
  }

  function snapTime(time) {
    const division = Number(els.snapDivision.value);
    if (!division || !state.bpm) return Math.max(0, time);
    const unit = beatDuration() / division;
    return Math.max(0, state.beatOffset + Math.round((time - state.beatOffset) / unit) * unit);
  }

  function laneWindow(height) {
    const judgementY = height - 48;
    const secondsAhead = Math.max(3, beatDuration() * 8);
    const pixelsPerSecond = (judgementY - 28) / secondsAhead;
    return { judgementY, secondsAhead, pixelsPerSecond, now: els.audio.currentTime || 0 };
  }

  function laneTimeToY(time, height) {
    const view = laneWindow(height);
    return view.judgementY - (time - view.now) * view.pixelsPerSecond;
  }

  function laneYToTime(y, height) {
    const view = laneWindow(height);
    return view.now + (view.judgementY - y) / view.pixelsPerSecond;
  }

  function renderLaneKeys() {
    const keys = KEY_LAYOUTS[state.laneCount];
    els.laneKeys.style.setProperty('--lanes', state.laneCount);
    const layoutSignature = `${state.laneCount}:${keys.join(',')}`;
    if (els.laneKeys.dataset.layout !== layoutSignature) {
      els.laneKeys.innerHTML = '';
      keys.forEach((key, lane) => {
        const node = document.createElement('span');
        node.className = 'lane-key';
        node.textContent = key === 'Space' ? '空格' : key;
        node.title = `第 ${lane + 1} 轨：${node.textContent}`;
        els.laneKeys.append(node);
      });
      els.laneKeys.dataset.layout = layoutSignature;
      els.laneModeHelp.textContent = `当前键位：${keys.map(key => key === 'Space' ? '空格' : key).join(' ')}`;
    }
    [...els.laneKeys.children].forEach((node, lane) => node.classList.toggle('active', state.activeLanes.has(lane)));
  }

  function renderLaneEditor() {
    const rect = els.laneCanvas.parentElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;
    laneCtx.clearRect(0, 0, width, height);
    laneCtx.fillStyle = '#090e13';
    laneCtx.fillRect(0, 0, width, height);
    const laneWidth = width / state.laneCount;
    const view = laneWindow(height);

    for (let lane = 0; lane < state.laneCount; lane++) {
      laneCtx.fillStyle = lane % 2 ? 'rgba(255,255,255,.018)' : 'rgba(103,232,249,.018)';
      laneCtx.fillRect(lane * laneWidth, 0, laneWidth, height);
      laneCtx.strokeStyle = 'rgba(137,149,162,.25)';
      laneCtx.beginPath(); laneCtx.moveTo(lane * laneWidth + .5, 0); laneCtx.lineTo(lane * laneWidth + .5, height); laneCtx.stroke();
      if (state.activeLanes.has(lane)) {
        laneCtx.fillStyle = 'rgba(255,212,59,.08)';
        laneCtx.fillRect(lane * laneWidth, 0, laneWidth, height);
      }
    }
    laneCtx.strokeStyle = 'rgba(137,149,162,.25)';
    laneCtx.beginPath(); laneCtx.moveTo(width - .5, 0); laneCtx.lineTo(width - .5, height); laneCtx.stroke();

    if (state.bpm) {
      const division = Math.max(1, Number(els.snapDivision.value) || 1);
      const unit = beatDuration() / division;
      const topTime = view.now + view.secondsAhead;
      let time = state.beatOffset + Math.floor((view.now - state.beatOffset) / unit) * unit;
      for (; time <= topTime; time += unit) {
        const y = laneTimeToY(time, height);
        const beatIndex = Math.round((time - state.beatOffset) / beatDuration());
        const isMain = Math.abs((time - state.beatOffset) / beatDuration() - beatIndex) < .03;
        laneCtx.strokeStyle = isMain ? 'rgba(255,212,59,.19)' : 'rgba(137,149,162,.09)';
        laneCtx.lineWidth = isMain && beatIndex % 4 === 0 ? 1.5 : 1;
        laneCtx.beginPath(); laneCtx.moveTo(0, y); laneCtx.lineTo(width, y); laneCtx.stroke();
      }
    }

    laneCtx.strokeStyle = state.testMode ? '#67e8f9' : '#ffd43b';
    laneCtx.lineWidth = 2;
    laneCtx.beginPath(); laneCtx.moveTo(0, view.judgementY); laneCtx.lineTo(width, view.judgementY); laneCtx.stroke();
    laneCtx.fillStyle = state.testMode ? '#67e8f9' : '#ffd43b';
    laneCtx.font = '700 10px ui-monospace, monospace';
    laneCtx.fillText(state.testMode ? 'JUDGE' : 'NOW', 7, view.judgementY - 7);

    state.notes.forEach(note => {
      if (state.testMode && state.hitNotes.has(note.id)) return;
      const y = laneTimeToY(note.time, height);
      const endY = note.type === 'hold' ? laneTimeToY(note.endTime, height) : y;
      if (Math.max(y, endY) < -30 || Math.min(y, endY) > height + 30) return;
      const x = note.lane * laneWidth + 7;
      const w = Math.max(8, laneWidth - 14);
      const selected = note.id === state.selectedNoteId;
      if (note.type === 'hold') {
        laneCtx.fillStyle = selected ? 'rgba(255,100,116,.55)' : 'rgba(103,232,249,.34)';
        laneCtx.fillRect(x + w * .24, endY, w * .52, Math.max(8, y - endY));
      }
      laneCtx.fillStyle = selected ? '#ff6474' : note.type === 'hold' ? '#67e8f9' : '#ffd43b';
      laneCtx.shadowColor = laneCtx.fillStyle;
      laneCtx.shadowBlur = selected ? 13 : 5;
      laneCtx.fillRect(x, y - 6, w, 12);
      laneCtx.shadowBlur = 0;
    });
    renderLaneKeys();
  }

  function addLaneNote(lane, time, source = 'pointer') {
    if (!state.audioBuffer || lane < 0 || lane >= state.laneCount) return;
    const snapped = source === 'key' ? Math.max(0, time) : snapTime(time);
    if (state.notes.some(note => note.lane === lane && Math.abs(note.time - snapped) < .035)) return;
    snapshot();
    const type = els.noteType.value;
    const note = { id: makeId(), lane, time: Number(snapped.toFixed(3)), type };
    if (type === 'hold') note.endTime = Number(Math.min(els.audio.duration || Infinity, snapped + beatDuration() * Number(els.holdLength.value)).toFixed(3));
    state.notes.push(note);
    state.notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
    state.selectedNoteId = note.id;
    renderAll();
    markDirty();
  }

  function deleteLaneNote(id = state.selectedNoteId) {
    const index = state.notes.findIndex(note => note.id === id);
    if (index < 0) return;
    snapshot();
    state.notes.splice(index, 1);
    state.selectedNoteId = null;
    renderAll();
    markDirty();
  }

  function lanePointerInfo(event) {
    const rect = els.laneCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width - .01, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    return { x, y, width: rect.width, height: rect.height, lane: Math.floor(x / (rect.width / state.laneCount)), time: laneYToTime(y, rect.height) };
  }

  function nearestLaneNote(lane, time) {
    const tolerance = Math.max(.08, beatDuration() / 5);
    return state.notes
      .filter(note => note.lane === lane && Math.abs(note.time - time) <= tolerance)
      .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0] || null;
  }

  function handleLanePointer(event) {
    if (!state.audioBuffer || state.testMode) return;
    const point = lanePointerInfo(event);
    const existing = nearestLaneNote(point.lane, point.time);
    if (existing) {
      state.selectedNoteId = existing.id;
      if (event.button === 2) deleteLaneNote(existing.id);
      else { els.audio.currentTime = existing.time; renderAll(); }
      return;
    }
    if (event.button !== 2 && point.time >= 0 && point.time <= els.audio.duration) addLaneNote(point.lane, point.time);
  }

  function generateBaseChart() {
    if (!state.beats.length) return;
    if (state.notes.length && !confirm('重新生成会替换已有轨道音符，继续吗？')) return;
    snapshot();
    const lanes = state.laneCount;
    const pattern = [];
    for (let i = 0; i < Math.ceil(lanes / 2); i++) {
      if (i < lanes) pattern.push(i);
      const mirror = lanes - 1 - i;
      if (mirror !== i) pattern.push(mirror);
    }
    state.notes = [];
    state.beats.forEach((beat, index) => {
      const lane = pattern[index % pattern.length];
      state.notes.push({ id: makeId(), lane, time: beat.time, type: 'tap' });
      if (beat.type === 'accent' && beat.strength >= 88 && lanes >= 4) {
        const mirror = lanes - 1 - lane;
        if (mirror !== lane) state.notes.push({ id: makeId(), lane: mirror, time: beat.time, type: 'tap' });
      }
    });
    state.notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
    state.selectedNoteId = null;
    renderAll();
    markDirty();
    toast(`已生成 ${state.laneCount} 轨基础谱面，共 ${state.notes.length} 个音符`);
  }

  function setLaneActive(lane) {
    state.activeLanes.add(lane);
    renderLaneEditor();
    setTimeout(() => { state.activeLanes.delete(lane); renderLaneEditor(); }, 110);
  }

  function showJudgement(text, type = 'perfect') {
    els.judgementPop.textContent = text;
    els.judgementPop.style.color = type === 'perfect' ? '#ffd43b' : type === 'good' ? '#67e8f9' : '#ff6474';
    els.judgementPop.classList.add('hidden');
    void els.judgementPop.offsetWidth;
    els.judgementPop.classList.remove('hidden');
    setTimeout(() => els.judgementPop.classList.add('hidden'), 460);
  }

  function judgeLane(lane) {
    const now = els.audio.currentTime;
    const note = state.notes
      .filter(item => item.lane === lane && !state.hitNotes.has(item.id) && Math.abs(item.time - now) <= .18)
      .sort((a, b) => Math.abs(a.time - now) - Math.abs(b.time - now))[0];
    if (!note) { showJudgement('MISS', 'miss'); return; }
    const delta = Math.abs(note.time - now);
    state.hitNotes.add(note.id);
    showJudgement(delta <= .065 ? 'PERFECT' : 'GOOD', delta <= .065 ? 'perfect' : 'good');
    renderLaneEditor();
  }

  function toggleTestMode() {
    if (!state.notes.length || !state.audioBuffer) return;
    state.testMode = !state.testMode;
    state.hitNotes.clear();
    els.testModeBtn.textContent = state.testMode ? '■ 退出试玩' : '▷ 试玩模式';
    els.laneCanvas.style.cursor = state.testMode ? 'default' : 'crosshair';
    toast(state.testMode ? `试玩已开启，请使用 ${KEY_LAYOUTS[state.laneCount].map(k => k === 'Space' ? '空格' : k).join(' ')} 击打音符` : '已退出试玩模式');
    renderLaneEditor();
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
    renderLaneEditor();
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
      if ((state.beats.length || state.notes.length) && !confirm('打开工程会替换当前节拍和轨道音符，继续吗？')) return;
      snapshot();
      state.beats = data.beats.map(beat => ({
        id: makeId(), time: Number(beat.time) || 0,
        type: ['beat','accent','note'].includes(beat.type) ? beat.type : 'beat',
        strength: Math.max(10, Math.min(100, Number(beat.strength) || 80)), note: String(beat.note || '')
      })).sort((a, b) => a.time - b.time);
      state.bpm = Number(data.bpm) || 0;
      state.beatOffset = Number(data.beatOffset) || 0;
      state.laneCount = Math.max(2, Math.min(6, Number(data.laneCount) || 4));
      state.notes = Array.isArray(data.notes) ? data.notes.map(note => ({
        id: makeId(),
        time: Number(note.time) || 0,
        lane: Math.max(0, Math.min(state.laneCount - 1, Number(note.lane) || 0)),
        type: note.type === 'hold' ? 'hold' : 'tap',
        ...(note.type === 'hold' ? { endTime: Math.max(Number(note.time) || 0, Number(note.endTime) || Number(note.time) || 0) } : {})
      })).sort((a, b) => a.time - b.time || a.lane - b.lane) : [];
      els.laneCount.value = String(state.laneCount);
      if ([0,1,2,4].includes(Number(data.snapDivision))) els.snapDivision.value = String(data.snapDivision);
      els.projectName.value = data.name || file.name.replace(/\.rhythm\.json$|\.json$/i, '');
      els.bpmValue.textContent = state.bpm ? state.bpm.toFixed(1) : '—';
      els.analysisResult.classList.remove('hidden');
      state.selectedId = null;
      renderAll();
      markDirty();
      const audioHint = data.audio?.name ? ` 请再载入音乐“${data.audio.name}”。` : '';
      toast(`工程已打开：${state.beats.length} 个节拍、${state.notes.length} 个轨道音符。${audioHint}`);
    } catch (error) {
      toast('这个文件不是有效的节拍工程', 'error');
    }
  }

  function exportCsv() {
    const rows = [
      ['record_kind','index','time_seconds','time_display','lane','type','end_time','strength','note'],
      ...state.beats.map((beat, i) => ['beat', i + 1, beat.time.toFixed(3), formatTime(beat.time), '', beat.type, '', beat.strength, beat.note]),
      ...state.notes.map((note, i) => ['game_note', i + 1, note.time.toFixed(3), formatTime(note.time), note.lane, note.type, note.type === 'hold' ? note.endTime.toFixed(3) : '', '', ''])
    ];
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    downloadFile(`${els.projectName.value || '谱面'}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast('CSV 已导出');
  }

  function exportGameJson() {
    const data = projectData();
    data.beats = data.beats.map(({ index, time, type, strength, note }) => ({ t: Math.round(time * 1000), type, strength, ...(note ? { note } : {}) }));
    data.notes = data.notes.map(({ index, time, endTime, lane, type }) => ({ t: Math.round(time * 1000), lane, type, ...(type === 'hold' ? { end: Math.round(endTime * 1000) } : {}) }));
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
      }),
      register({
        name: 'add_lane_note',
        description: 'Add a tap or hold game note to an exact lane and time in the current 2-to-6 lane chart.',
        inputSchema: {
          type: 'object',
          properties: {
            lane: { type: 'integer', minimum: 0, maximum: 5, description: 'Zero-based lane index.' },
            time: { type: 'number', minimum: 0, description: 'Note time in seconds.' },
            type: { type: 'string', enum: ['tap', 'hold'] }
          },
          required: ['lane', 'time']
        },
        annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: false },
        execute: async ({ lane, time, type }) => {
          if (!state.audioBuffer) return 'Load an audio file before adding game notes.';
          if (lane < 0 || lane >= state.laneCount) return `Lane must be between 0 and ${state.laneCount - 1}.`;
          const previous = els.noteType.value;
          els.noteType.value = type === 'hold' ? 'hold' : 'tap';
          addLaneNote(Number(lane), Number(time));
          els.noteType.value = previous;
          return `Added a ${type || 'tap'} note to lane ${lane} at ${Number(time).toFixed(3)} seconds.`;
        }
      }),
      register({
        name: 'generate_base_chart',
        description: 'Generate a playable base lane chart from the currently detected beat markers.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: false, consequentialHint: false, untrustedContentHint: false },
        execute: async () => {
          if (!state.audioBuffer || !state.beats.length) return 'Analyze an audio file before generating a lane chart.';
          if (state.notes.length) return 'The chart already has game notes. Clear them before generating a replacement.';
          generateBaseChart();
          return `Generated ${state.notes.length} notes across ${state.laneCount} lanes.`;
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
  els.audio.addEventListener('play', () => {
    if (state.testMode && els.audio.currentTime < .05) state.hitNotes.clear();
    els.playIcon.textContent = 'Ⅱ';
    cancelAnimationFrame(animationFrame);
    animationLoop();
  });
  els.audio.addEventListener('pause', () => { els.playIcon.textContent = '▶'; cancelAnimationFrame(animationFrame); renderTimeline(); renderLaneEditor(); });
  els.audio.addEventListener('ended', () => {
    els.playIcon.textContent = '▶';
    state.lastMetronomeBeat = null;
    state.hitNotes.clear();
    renderLaneEditor();
  });
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
  els.laneCount.addEventListener('change', () => {
    const next = Number(els.laneCount.value);
    const outOfRange = state.notes.filter(note => note.lane >= next).length;
    if (outOfRange && !confirm(`切换到 ${next} 轨会把 ${outOfRange} 个超出范围的音符移动到最后一轨，继续吗？`)) {
      els.laneCount.value = String(state.laneCount);
      return;
    }
    snapshot();
    state.laneCount = next;
    state.notes.forEach(note => { note.lane = Math.min(note.lane, next - 1); });
    renderAll();
    markDirty();
  });
  els.snapDivision.addEventListener('change', () => { renderLaneEditor(); markDirty(); });
  els.noteType.addEventListener('change', () => els.holdLengthWrap.classList.toggle('hidden', els.noteType.value !== 'hold'));
  els.generateChartBtn.addEventListener('click', generateBaseChart);
  els.clearNotesBtn.addEventListener('click', () => {
    if (!state.notes.length || !confirm(`确定清空全部 ${state.notes.length} 个轨道音符吗？节拍分析结果会保留。`)) return;
    snapshot(); state.notes = []; state.selectedNoteId = null; renderAll(); markDirty();
  });
  els.testModeBtn.addEventListener('click', toggleTestMode);
  els.laneCanvas.addEventListener('pointerdown', handleLanePointer);
  els.laneCanvas.addEventListener('contextmenu', event => { event.preventDefault(); handleLanePointer(event); });

  document.addEventListener('keydown', event => {
    if (event.target.matches('input,select,textarea')) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
    if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); return; }
    const laneKeys = KEY_LAYOUTS[state.laneCount];
    const pressed = event.code === 'Space' ? 'Space' : event.key.toUpperCase();
    const lane = laneKeys.indexOf(pressed);
    if (lane >= 0 && state.audioBuffer && !els.audio.paused) {
      event.preventDefault();
      setLaneActive(lane);
      if (state.testMode) judgeLane(lane); else addLaneNote(lane, els.audio.currentTime, 'key');
      return;
    }
    if (event.key.toLowerCase() === 't' && state.audioBuffer) { event.preventDefault(); addBeat(els.audio.currentTime, 'tap'); clickSound(900); return; }
    if (event.code === 'Space' && state.audioBuffer) { event.preventDefault(); togglePlay(); return; }
    if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedNoteId) { event.preventDefault(); deleteLaneNote(); return; }
    if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId) { event.preventDefault(); deleteBeat(); return; }
    if (state.selectedId && ['ArrowLeft','ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const beat = state.beats.find(item => item.id === state.selectedId);
      const amount = event.shiftKey ? .001 : .01;
      updateSelected({ time: beat.time + (event.key === 'ArrowRight' ? amount : -amount) });
    }
  });

  window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(resizeCanvas); });
  window.addEventListener('beforeunload', event => { if (state.dirty && (state.beats.length || state.notes.length)) { event.preventDefault(); event.returnValue = ''; } });

  try {
    const saved = JSON.parse(localStorage.getItem('rhythm-studio-autosave') || 'null');
    if (saved && (saved.beats?.length || saved.notes?.length)) {
      els.projectName.value = saved.name || '未命名谱面';
      state.beats = saved.beats.map(beat => ({ ...beat, id: makeId() }));
      state.bpm = Number(saved.bpm) || 0;
      state.beatOffset = Number(saved.beatOffset) || 0;
      state.laneCount = Math.max(2, Math.min(6, Number(saved.laneCount) || 4));
      state.notes = Array.isArray(saved.notes) ? saved.notes.map(note => ({ ...note, id: makeId() })) : [];
      els.laneCount.value = String(state.laneCount);
      if ([0,1,2,4].includes(Number(saved.snapDivision))) els.snapDivision.value = String(saved.snapDivision);
      els.bpmValue.textContent = state.bpm ? state.bpm.toFixed(1) : '—';
      els.analysisResult.classList.remove('hidden');
      toast(`已恢复上次未导出的 ${state.beats.length} 个节拍和 ${state.notes.length} 个音符，请重新载入音乐`);
    }
  } catch (_) { /* ignore corrupt autosave */ }

  resizeCanvas();
  renderAll();
  registerWebMcpTools();
})();
