(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = Object.fromEntries([
    'audio','audioFile','projectFile','dropZone','fileCard','fileName','fileMeta','replaceAudioBtn','analyzeBtn','analysisDensity','sensitivity','sensitivityValue','analysisResult','bpmValue','beatCount','countPill','timingCalibration','bpmInput','halfBpmBtn','doubleBpmBtn','offsetInput','offsetMinusBtn','offsetPlusBtn','setOffsetBtn','previewOffsetBtn','applyTimingBtn','playBtn','playIcon','stopBtn','backBtn','forwardBtn','currentTime','durationTime','playbackRate','metronome','waveform','canvasShell','emptyWave','timelineHint','zoom','fitBtn','addBeatBtn','undoBtn','redoBtn','beatTableBody','tableEmpty','selectedLabel','inspectorFields','beatTimeInput','beatType','beatStrength','strengthValue','beatNote','deleteBeatBtn','projectName','saveProjectBtn','openProjectBtn','helpBtn','helpModal','helpCloseBtn','helpDoneBtn','exportGameCsvBtn','exportGameJsonBtn','exportBeatCsvBtn','exportBeatJsonBtn','toastRegion','progressModal','progressBar','progressText','dragHelp','chartDifficulty','difficultyHelp','laneCount','snapDivision','noteType','holdLengthWrap','holdLength','laneCanvas','laneEmpty','laneKeys','noteCount','clearNotesBtn','testModeBtn','generateChartBtn','laneModeHelp','judgementPop'
  ].map(id => [id, $(id)]));

  const state = {
    audioBuffer: null,
    onsetEnvelope: null,
    onsetFrameRate: 0,
    audioFile: null,
    audioUrl: null,
    projectDuration: 0,
    pendingAudioReference: null,
    waveform: [],
    beats: [],
    notes: [],
    chartDifficulty: 'standard',
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
    scrubbingTimeline: false,
    draggingId: null,
    dragMoved: false,
    draggingNoteId: null,
    noteDragStartX: 0,
    noteDragStartY: 0,
    noteDragSnapshotTaken: false,
    scrubbingLaneTimeline: false,
    history: [],
    future: [],
    lastMetronomeBeat: null,
    audioContext: null,
    dirty: false
  };

  let animationFrame = 0;
  let resizeFrame = 0;
  let helpReturnFocus = null;
  const canvasCtx = els.waveform.getContext('2d');
  const laneCtx = els.laneCanvas.getContext('2d');
  const RULER_HEIGHT = 30;
  const LANE_RULER_HEIGHT = 30;
  const LANE_LABEL_WIDTH = 62;
  const KEY_LAYOUTS = {
    2: ['D', 'K'],
    3: ['F', 'J', 'K'],
    4: ['D', 'F', 'J', 'K'],
    5: ['D', 'F', 'J', 'K', 'L'],
    6: ['S', 'D', 'F', 'J', 'K', 'L']
  };
  const DIFFICULTY_PRESETS = {
    standard: { label: '标准', grid: 0, approachBeats: 8, minSeconds: 3, help: '主要节拍 · 正常下落速度' },
    hard: { label: '困难', grid: 1, approachBeats: 6, minSeconds: 2.35, help: '每一拍 · 较快下落速度' },
    hell: { label: '地狱', grid: 2, approachBeats: 4, minSeconds: 1.6, help: '包含半拍 · 最快下落速度' }
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
      bpm: state.bpm,
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
    state.bpm = Number(normalized.bpm) || state.bpm || 0;
    state.beatOffset = Number(normalized.beatOffset) || 0;
    els.laneCount.value = String(state.laneCount);
    syncTimingControls();
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
    const duration = els.audio.duration || state.audioBuffer?.duration || state.projectDuration || 0;
    const audioReference = state.audioFile ? {
      sourceKind: 'local-file',
      reference: state.audioFile.webkitRelativePath || state.audioFile.name,
      name: state.audioFile.name,
      type: state.audioFile.type || '',
      size: state.audioFile.size,
      lastModified: state.audioFile.lastModified || 0,
      duration: Number(duration.toFixed(3))
    } : state.pendingAudioReference;
    return {
      ...(includeVersion ? { format: 'rhythm-chart-studio', version: 3 } : {}),
      name: els.projectName.value.trim() || '未命名谱面',
      audio: audioReference || null,
      bpm: Number(state.bpm.toFixed(2)),
      beatOffset: Number(state.beatOffset.toFixed(3)),
      laneCount: state.laneCount,
      snapDivision: Number(els.snapDivision.value),
      duration: Number(duration.toFixed(3)),
      settings: {
        analysisDensity: els.analysisDensity.value,
        sensitivity: Number(els.sensitivity.value),
        playbackRate: Number(els.playbackRate.value),
        metronome: els.metronome.checked,
        zoom: state.zoom,
        snapDivision: Number(els.snapDivision.value),
        noteType: els.noteType.value,
        holdLength: Number(els.holdLength.value),
        chartDifficulty: state.chartDifficulty
      },
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

  function audioReferenceMatches(reference, file, duration = 0) {
    if (!reference || !file) return false;
    const sameName = !reference.name || reference.name === file.name;
    const sameSize = !reference.size || Number(reference.size) === file.size;
    const sameModified = !reference.lastModified || Number(reference.lastModified) === Number(file.lastModified || 0);
    const sameDuration = !reference.duration || !duration || Math.abs(Number(reference.duration) - duration) < .25;
    return sameName && sameSize && sameModified && sameDuration;
  }

  function detachAudioForProject(reference) {
    els.audio.pause();
    els.audio.removeAttribute('src');
    els.audio.load();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = null;
    state.audioFile = null;
    state.audioBuffer = null;
    state.onsetEnvelope = null;
    state.onsetFrameRate = 0;
    state.waveform = [];
    state.pendingAudioReference = reference || null;
    els.audioFile.value = '';
    els.fileCard.classList.add('hidden');
    els.dropZone.classList.remove('hidden');
    els.emptyWave.classList.toggle('hidden', state.beats.length > 0);
    els.timelineHint.textContent = reference?.name ? `请重新关联音乐“${reference.name}”` : '请重新关联工程使用的音乐';
    els.durationTime.textContent = formatTime(state.projectDuration);
    enableAudioControls(false);
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
    [els.setOffsetBtn, els.previewOffsetBtn, els.applyTimingBtn].forEach(el => el.disabled = !enabled || !state.bpm);
    els.generateChartBtn.disabled = !enabled || !state.beats.length;
    els.testModeBtn.disabled = !enabled || !state.notes.length;
  }

  async function loadAudioFile(file) {
    if (!file || (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.name))) {
      toast('请选择 MP3、WAV、OGG、M4A 等音乐文件', 'error');
      return;
    }
    const relinkingProject = Boolean(state.pendingAudioReference);
    if (!relinkingProject && (state.beats.length || state.notes.length) && !confirm('更换音乐会清空当前节拍和轨道音符，继续吗？')) {
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
      const referenceMatched = !relinkingProject || audioReferenceMatches(state.pendingAudioReference, file, state.audioBuffer.duration);
      state.projectDuration = state.audioBuffer.duration;
      if (!relinkingProject) {
        state.beats = [];
        state.notes = [];
        state.selectedId = null;
        state.selectedNoteId = null;
        state.history = [];
        state.future = [];
        state.bpm = 0;
        state.beatOffset = 0;
        state.onsetEnvelope = null;
        state.onsetFrameRate = 0;
        state.zoom = 1;
        state.viewStart = 0;
        els.zoom.value = '1';
      }
      state.pendingAudioReference = null;
      els.fileName.textContent = file.name;
      els.fileMeta.textContent = `${fileSize(file.size)} · ${formatTime(state.audioBuffer.duration)}`;
      els.dropZone.classList.add('hidden');
      els.fileCard.classList.remove('hidden');
      els.emptyWave.classList.add('hidden');
      els.timelineHint.textContent = '上方时间尺拖动播放位置，下方波形编辑节拍';
      els.durationTime.textContent = formatTime(state.audioBuffer.duration);
      els.analysisResult.classList.add('hidden');
      els.timingCalibration.classList.toggle('hidden', !state.bpm);
      enableAudioControls(true);
      renderAll();
      markDirty();
      showProgress('音乐准备好了', 100);
      setTimeout(hideProgress, 220);
      if (relinkingProject && !referenceMatched) toast('音乐已关联，但文件指纹与工程记录不同，请试听检查是否选错音乐', 'error');
      else if (relinkingProject) toast('已重新关联原音乐，节拍和轨道谱面已保留');
      else toast('音乐已载入，可以自动分析或直接播放打拍子');
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
      state.onsetEnvelope = envelope;
      state.onsetFrameRate = frameRate;
      showProgress('正在寻找稳定的重复间隔…', 38);
      await new Promise(resolve => setTimeout(resolve, 30));
      const tempo = estimateTempo(envelope, frameRate);
      const bpm = tempo.bpm;
      const interval = 60 / bpm;
      const phase = findBeatPhase(envelope, frameRate, interval);
      const offset = findFirstBeatOffset(envelope, frameRate, phase, interval, state.audioBuffer.duration);
      showProgress('正在把候选声音对齐到节拍网格…', 66);
      await new Promise(resolve => setTimeout(resolve, 30));
      const density = els.analysisDensity.value;
      const detected = buildBeatGrid(envelope, frameRate, bpm, offset, state.audioBuffer.duration, density, Number(els.sensitivity.value));
      snapshot();
      state.beatOffset = offset;
      state.beats = dedupeBeats(detected);
      state.bpm = bpm;
      state.selectedId = null;
      els.bpmValue.textContent = bpm ? bpm.toFixed(1) : '—';
      els.analysisResult.classList.remove('hidden');
      syncTimingControls();
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

  function findFirstBeatOffset(envelope, frameRate, phase, interval, duration) {
    const grid = [];
    for (let time = phase; time < duration; time += interval) {
      const onset = envelopeAt(envelope, frameRate, time);
      grid.push({ gridTime: time, refinedTime: onset.frame / frameRate, strength: onset.value });
    }
    if (!grid.length) return phase;
    const positive = grid.map(item => item.strength).filter(value => value > 0).sort((a, b) => a - b);
    const threshold = Math.max(.08, positive[Math.floor(positive.length * .48)] || 0);
    for (let i = 0; i < grid.length; i++) {
      const window = grid.slice(i, i + 8);
      const reliable = window.filter(item => item.strength >= threshold);
      if (grid[i].strength >= threshold && reliable.length >= Math.min(3, window.length)) {
        return Math.abs(grid[i].refinedTime - grid[i].gridTime) <= .07 ? grid[i].refinedTime : grid[i].gridTime;
      }
    }
    return phase;
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
      // Keep a predictable one-marker-per-two-beats grid anchored to Offset.
      // Choosing the louder odd/even group could hide the very first beat.
      selected = candidates.filter((_, i) => i % 2 === 0);
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

  function syncTimingControls() {
    const hasTiming = state.bpm > 0;
    els.timingCalibration.classList.toggle('hidden', !hasTiming);
    if (!hasTiming) return;
    els.bpmValue.textContent = state.bpm.toFixed(1);
    els.bpmInput.value = state.bpm.toFixed(2);
    els.offsetInput.value = state.beatOffset.toFixed(3);
    const hasAudio = Boolean(state.audioBuffer);
    els.setOffsetBtn.disabled = !hasAudio;
    els.previewOffsetBtn.disabled = !hasAudio || !state.beats.length;
    els.applyTimingBtn.disabled = !hasAudio;
  }

  function timingInputValues() {
    const duration = state.audioBuffer?.duration || state.projectDuration || Infinity;
    const bpm = Math.max(30, Math.min(300, Number(els.bpmInput.value) || state.bpm || 120));
    const offset = Math.max(0, Math.min(duration, Number(els.offsetInput.value) || 0));
    els.bpmInput.value = bpm.toFixed(2);
    els.offsetInput.value = offset.toFixed(3);
    return { bpm, offset };
  }

  function ensureOnsetAnalysis() {
    if (state.onsetEnvelope && state.onsetFrameRate) return;
    if (!state.audioBuffer) return;
    const hop = 512;
    state.onsetEnvelope = buildOnsetEnvelope(state.audioBuffer, hop);
    state.onsetFrameRate = state.audioBuffer.sampleRate / hop;
  }

  function applyTimingCalibration() {
    if (!state.audioBuffer) return toast('请先关联音乐，再应用节奏校准', 'error');
    const { bpm, offset } = timingInputValues();
    if (state.notes.length && !confirm('应用新的 BPM / Offset 会重新排列节拍，但已有轨道音符会保留在原时间。应用后建议试听，必要时清空并重新生成基础谱面。继续吗？')) return;
    ensureOnsetAnalysis();
    snapshot();
    state.bpm = bpm;
    state.beatOffset = offset;
    state.beats = dedupeBeats(buildBeatGrid(
      state.onsetEnvelope,
      state.onsetFrameRate,
      bpm,
      offset,
      state.audioBuffer.duration,
      els.analysisDensity.value,
      Number(els.sensitivity.value)
    ));
    state.selectedId = null;
    els.bpmValue.textContent = bpm.toFixed(1);
    syncTimingControls();
    renderAll();
    markDirty();
    toast(`已从 ${formatTime(offset)} 重新排列 ${state.beats.length} 个节拍；已有轨道音符未移动`);
  }

  function adjustTimingInput(input, amount, digits) {
    input.value = Math.max(0, (Number(input.value) || 0) + amount).toFixed(digits);
  }

  function previewFromOffset() {
    if (!state.audioBuffer || !state.beats.length) return;
    const { bpm, offset } = timingInputValues();
    if (Math.abs(bpm - state.bpm) > .001 || Math.abs(offset - state.beatOffset) > .001) {
      toast('数值已经修改，请先点“应用并重排节拍”再试听', 'error');
      return;
    }
    els.audio.currentTime = Math.max(0, offset - .2);
    els.metronome.checked = true;
    state.lastMetronomeBeat = null;
    els.audio.play().catch(() => toast('浏览器阻止了播放，请再点一次试听', 'error'));
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
    beat.time = Math.max(0, Math.min(Number(beat.time) || 0, els.audio.duration || state.projectDuration || Infinity));
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
    syncTimingControls();
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
    els.exportGameCsvBtn.disabled = !state.notes.length;
    els.exportGameJsonBtn.disabled = !state.notes.length;
    els.exportBeatCsvBtn.disabled = !state.beats.length;
    els.exportBeatJsonBtn.disabled = !state.beats.length;
  }

  function viewDuration() {
    const duration = els.audio.duration || state.audioBuffer?.duration || state.projectDuration || 1;
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
    const rulerHeight = RULER_HEIGHT;

    canvasCtx.fillStyle = 'rgba(19,26,33,.96)';
    canvasCtx.fillRect(0, 0, width, rulerHeight);
    canvasCtx.strokeStyle = 'rgba(255,255,255,.12)';
    canvasCtx.beginPath(); canvasCtx.moveTo(0, rulerHeight - .5); canvasCtx.lineTo(width, rulerHeight - .5); canvasCtx.stroke();

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
    const preset = DIFFICULTY_PRESETS[state.chartDifficulty];
    const secondsAhead = Math.max(preset.minSeconds, beatDuration() * preset.approachBeats);
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

  function laneTimelineX(time, width) {
    const contentWidth = Math.max(1, width - LANE_LABEL_WIDTH);
    return LANE_LABEL_WIDTH + ((time - state.viewStart) / viewDuration()) * contentWidth;
  }

  function laneTimelineTime(x, width) {
    const contentWidth = Math.max(1, width - LANE_LABEL_WIDTH);
    return state.viewStart + ((x - LANE_LABEL_WIDTH) / contentWidth) * viewDuration();
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
      els.laneModeHelp.textContent = `当前键位：${keys.join(' ')}`;
    }
    [...els.laneKeys.children].forEach((node, lane) => node.classList.toggle('active', state.activeLanes.has(lane)));
  }

  function renderLaneEditor() {
    const rect = els.laneCanvas.parentElement.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;
    laneCtx.clearRect(0, 0, width, height);
    if (!state.testMode) {
      renderLaneTimeline(width, height);
      renderLaneKeys();
      return;
    }
    renderLanePlayfield(width, height);
    renderLaneKeys();
  }

  function renderLanePlayfield(width, height) {
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
  }

  function renderLaneTimeline(width, height) {
    const contentWidth = Math.max(1, width - LANE_LABEL_WIDTH);
    const laneHeight = Math.max(24, (height - LANE_RULER_HEIGHT) / state.laneCount);
    const duration = viewDuration();

    laneCtx.fillStyle = '#090e13';
    laneCtx.fillRect(0, 0, width, height);
    laneCtx.fillStyle = 'rgba(19,26,33,.98)';
    laneCtx.fillRect(0, 0, width, LANE_RULER_HEIGHT);
    laneCtx.fillStyle = '#0d1319';
    laneCtx.fillRect(0, LANE_RULER_HEIGHT, LANE_LABEL_WIDTH, height - LANE_RULER_HEIGHT);

    const targetSteps = contentWidth < 600 ? 5 : 10;
    const rawStep = duration / targetSteps;
    const options = [.1,.25,.5,1,2,5,10,15,30,60,120,300];
    const step = options.find(value => value >= rawStep) || 600;
    const firstTick = Math.ceil(state.viewStart / step) * step;
    laneCtx.font = '11px ui-monospace, monospace';
    laneCtx.fillStyle = '#7e8a96';
    laneCtx.strokeStyle = 'rgba(137,149,162,.18)';
    laneCtx.lineWidth = 1;
    for (let time = firstTick; time <= state.viewStart + duration + .0001; time += step) {
      const x = laneTimelineX(time, width);
      laneCtx.beginPath(); laneCtx.moveTo(x, 0); laneCtx.lineTo(x, height); laneCtx.stroke();
      laneCtx.fillText(formatTime(time).slice(0, 5), x + 4, 19);
    }

    if (state.bpm) {
      const division = Math.max(1, Number(els.snapDivision.value) || 1);
      const unit = beatDuration() / division;
      let time = state.beatOffset + Math.ceil((state.viewStart - state.beatOffset) / unit) * unit;
      for (; time <= state.viewStart + duration + .0001; time += unit) {
        const x = laneTimelineX(time, width);
        const beatNumber = (time - state.beatOffset) / beatDuration();
        const wholeBeat = Math.abs(beatNumber - Math.round(beatNumber)) < .03;
        const barStart = wholeBeat && Math.round(beatNumber) % 4 === 0;
        laneCtx.strokeStyle = barStart ? 'rgba(255,212,59,.28)' : wholeBeat ? 'rgba(255,212,59,.16)' : 'rgba(137,149,162,.08)';
        laneCtx.lineWidth = barStart ? 1.5 : 1;
        laneCtx.beginPath(); laneCtx.moveTo(x, LANE_RULER_HEIGHT); laneCtx.lineTo(x, height); laneCtx.stroke();
      }
    }

    const keys = KEY_LAYOUTS[state.laneCount];
    for (let lane = 0; lane < state.laneCount; lane++) {
      const y = LANE_RULER_HEIGHT + lane * laneHeight;
      laneCtx.fillStyle = state.activeLanes.has(lane)
        ? 'rgba(255,212,59,.09)'
        : lane % 2 ? 'rgba(255,255,255,.018)' : 'rgba(103,232,249,.018)';
      laneCtx.fillRect(LANE_LABEL_WIDTH, y, contentWidth, laneHeight);
      laneCtx.strokeStyle = 'rgba(137,149,162,.24)';
      laneCtx.lineWidth = 1;
      laneCtx.beginPath(); laneCtx.moveTo(0, y + .5); laneCtx.lineTo(width, y + .5); laneCtx.stroke();
      laneCtx.fillStyle = '#aeb8c2';
      laneCtx.font = '700 11px ui-monospace, monospace';
      laneCtx.textAlign = 'center';
      laneCtx.textBaseline = 'middle';
      laneCtx.fillText(`${lane + 1}  ${keys[lane]}`, LANE_LABEL_WIDTH / 2, y + laneHeight / 2);
    }
    laneCtx.textAlign = 'start';
    laneCtx.textBaseline = 'alphabetic';
    laneCtx.strokeStyle = 'rgba(137,149,162,.35)';
    laneCtx.beginPath(); laneCtx.moveTo(LANE_LABEL_WIDTH + .5, 0); laneCtx.lineTo(LANE_LABEL_WIDTH + .5, height); laneCtx.stroke();
    laneCtx.beginPath(); laneCtx.moveTo(0, height - .5); laneCtx.lineTo(width, height - .5); laneCtx.stroke();

    state.notes.forEach(note => {
      const x = laneTimelineX(note.time, width);
      const endX = note.type === 'hold' ? laneTimelineX(note.endTime, width) : x;
      if (Math.max(x, endX) < LANE_LABEL_WIDTH - 20 || Math.min(x, endX) > width + 20) return;
      const centerY = LANE_RULER_HEIGHT + note.lane * laneHeight + laneHeight / 2;
      const selected = note.id === state.selectedNoteId;
      if (note.type === 'hold') {
        laneCtx.fillStyle = selected ? 'rgba(255,100,116,.45)' : 'rgba(103,232,249,.3)';
        laneCtx.fillRect(x, centerY - 5, Math.max(5, endX - x), 10);
      }
      laneCtx.fillStyle = selected ? '#ff6474' : note.type === 'hold' ? '#67e8f9' : '#ffd43b';
      laneCtx.shadowColor = laneCtx.fillStyle;
      laneCtx.shadowBlur = selected ? 14 : 6;
      laneCtx.beginPath();
      laneCtx.roundRect(x - 7, centerY - Math.min(12, laneHeight * .28), 14, Math.min(24, laneHeight * .56), 4);
      laneCtx.fill();
      laneCtx.shadowBlur = 0;
      if (selected) {
        laneCtx.strokeStyle = '#fff';
        laneCtx.lineWidth = 1;
        laneCtx.stroke();
      }
    });

    if (state.audioBuffer) {
      const playX = laneTimelineX(els.audio.currentTime, width);
      if (playX >= LANE_LABEL_WIDTH && playX <= width) {
        laneCtx.strokeStyle = '#fff';
        laneCtx.lineWidth = 1;
        laneCtx.beginPath(); laneCtx.moveTo(playX, 0); laneCtx.lineTo(playX, height); laneCtx.stroke();
        laneCtx.fillStyle = '#fff';
        laneCtx.beginPath(); laneCtx.arc(playX, 9, 3, 0, Math.PI * 2); laneCtx.fill();
      }
    }
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
    if (!state.testMode) {
      const laneHeight = (rect.height - LANE_RULER_HEIGHT) / state.laneCount;
      const lane = Math.floor((y - LANE_RULER_HEIGHT) / laneHeight);
      return { x, y, width: rect.width, height: rect.height, lane, time: laneTimelineTime(x, rect.width), onRuler: y <= LANE_RULER_HEIGHT };
    }
    return { x, y, width: rect.width, height: rect.height, lane: Math.floor(x / (rect.width / state.laneCount)), time: laneYToTime(y, rect.height), onRuler: false };
  }

  function nearestLaneNote(lane, time) {
    const tolerance = Math.max(.08, beatDuration() / 5);
    return state.notes
      .filter(note => note.lane === lane && Math.abs(note.time - time) <= tolerance)
      .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))[0] || null;
  }

  function laneNoteAtPoint(point) {
    if (state.testMode) return nearestLaneNote(point.lane, point.time);
    if (point.lane < 0 || point.lane >= state.laneCount || point.x < LANE_LABEL_WIDTH) return null;
    return state.notes
      .filter(note => {
        if (note.lane !== point.lane) return false;
        const startX = laneTimelineX(note.time, point.width);
        const endX = note.type === 'hold' ? laneTimelineX(note.endTime, point.width) : startX;
        return point.x >= Math.min(startX, endX) - 12 && point.x <= Math.max(startX, endX) + 12;
      })
      .sort((a, b) => Math.abs(laneTimelineX(a.time, point.width) - point.x) - Math.abs(laneTimelineX(b.time, point.width) - point.x))[0] || null;
  }

  function handleLanePointer(event) {
    if (!state.audioBuffer || state.testMode) return;
    const point = lanePointerInfo(event);
    if (point.onRuler && event.button !== 2) {
      state.scrubbingLaneTimeline = true;
      els.laneCanvas.setPointerCapture(event.pointerId);
      seekFromLaneTimeline(point);
      return;
    }
    const existing = laneNoteAtPoint(point);
    if (existing) {
      state.selectedNoteId = existing.id;
      if (event.button === 2) deleteLaneNote(existing.id);
      else {
        state.draggingNoteId = existing.id;
        state.noteDragStartX = point.x;
        state.noteDragStartY = point.y;
        state.noteDragSnapshotTaken = false;
        els.laneCanvas.setPointerCapture(event.pointerId);
        renderLaneEditor();
      }
      return;
    }
    if (event.button !== 2 && point.lane >= 0 && point.lane < state.laneCount && point.time >= 0 && point.time <= els.audio.duration) addLaneNote(point.lane, point.time);
  }

  function seekFromLaneTimeline(point) {
    els.audio.currentTime = Math.max(0, Math.min(point.time, els.audio.duration));
    els.currentTime.textContent = formatTime(els.audio.currentTime);
    renderTimeline();
    renderLaneEditor();
  }

  function moveLanePointer(event) {
    if (!state.audioBuffer || state.testMode) return;
    const point = lanePointerInfo(event);
    if (state.scrubbingLaneTimeline) {
      seekFromLaneTimeline(point);
      return;
    }
    if (!state.draggingNoteId) {
      els.laneCanvas.style.cursor = point.onRuler ? 'ew-resize' : laneNoteAtPoint(point) ? 'grab' : 'crosshair';
      return;
    }
    const note = state.notes.find(item => item.id === state.draggingNoteId);
    if (!note) return;
    if (!state.noteDragSnapshotTaken) {
      const distance = Math.hypot(point.x - state.noteDragStartX, point.y - state.noteDragStartY);
      if (distance < 3) return;
      snapshot();
      state.noteDragSnapshotTaken = true;
    }
    const oldTime = note.time;
    const oldLane = note.lane;
    const holdDuration = note.type === 'hold' ? note.endTime - note.time : 0;
    const targetLane = Math.max(0, Math.min(state.laneCount - 1, point.lane));
    const targetTime = Number(Math.max(0, Math.min(snapTime(point.time), els.audio.duration)).toFixed(3));
    const occupied = state.notes.some(item => item.id !== note.id && item.lane === targetLane && Math.abs(item.time - targetTime) < .035);
    if (!occupied) {
      note.lane = targetLane;
      note.time = targetTime;
    } else {
      note.lane = oldLane;
      note.time = oldTime;
    }
    if (note.type === 'hold') note.endTime = Number(Math.min(els.audio.duration, note.time + holdDuration).toFixed(3));
    if (oldTime !== note.time) els.audio.currentTime = note.time;
    els.laneCanvas.style.cursor = 'grabbing';
    renderTimeline();
    renderLaneEditor();
  }

  function endLanePointer() {
    if (state.scrubbingLaneTimeline) {
      state.scrubbingLaneTimeline = false;
      return;
    }
    if (!state.draggingNoteId) return;
    const note = state.notes.find(item => item.id === state.draggingNoteId);
    if (!state.noteDragSnapshotTaken && note) {
      els.audio.currentTime = note.time;
      els.currentTime.textContent = formatTime(note.time);
    }
    state.notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
    state.draggingNoteId = null;
    els.laneCanvas.style.cursor = 'crosshair';
    renderAll();
    if (state.noteDragSnapshotTaken) markDirty();
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
    const preset = DIFFICULTY_PRESETS[state.chartDifficulty];
    let chartBeats = state.beats;
    if (preset.grid) {
      const unit = beatDuration() / preset.grid;
      const firstTime = state.beats[0]?.time ?? state.beatOffset;
      const lastTime = Math.min(els.audio.duration || state.audioBuffer?.duration || state.beats.at(-1).time, state.beats.at(-1).time + beatDuration());
      chartBeats = [];
      for (let time = firstTime, index = 0; time <= lastTime + .001; time += unit, index++) {
        const wholeBeat = index % preset.grid === 0;
        const barStart = wholeBeat && Math.floor(index / preset.grid) % 4 === 0;
        chartBeats.push({ time: Number(time.toFixed(3)), type: barStart ? 'accent' : 'beat', strength: barStart ? 95 : wholeBeat ? 82 : 68 });
      }
    }
    state.notes = [];
    chartBeats.forEach((beat, index) => {
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
    toast(`已生成${preset.label}谱面：${state.laneCount} 轨，共 ${state.notes.length} 个音符`);
  }

  function setChartDifficulty(value, shouldSave = true) {
    state.chartDifficulty = DIFFICULTY_PRESETS[value] ? value : 'standard';
    els.chartDifficulty.value = state.chartDifficulty;
    const preset = DIFFICULTY_PRESETS[state.chartDifficulty];
    els.generateChartBtn.textContent = `✦ 生成${preset.label}谱面`;
    els.difficultyHelp.textContent = `${preset.label}：${preset.help}`;
    renderLaneEditor();
    if (shouldSave) markDirty();
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
    els.laneCanvas.parentElement.classList.toggle('test-mode', state.testMode);
    toast(state.testMode ? `试玩已开启，请使用 ${KEY_LAYOUTS[state.laneCount].join(' ')} 击打音符，空格键暂停/继续` : '已退出试玩模式');
    resizeCanvas();
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
    if (selectedRow) {
      const scrollBox = selectedRow.closest('.table-wrap');
      if (scrollBox) {
        const rowTop = selectedRow.offsetTop;
        const rowBottom = rowTop + selectedRow.offsetHeight;
        if (rowTop < scrollBox.scrollTop) scrollBox.scrollTop = rowTop;
        else if (rowBottom > scrollBox.scrollTop + scrollBox.clientHeight) scrollBox.scrollTop = rowBottom - scrollBox.clientHeight;
      }
    }
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
    return {
      x: Math.max(0, Math.min(event.clientX - rect.left, rect.width)),
      y: Math.max(0, Math.min(event.clientY - rect.top, rect.height)),
      width: rect.width,
      height: rect.height
    };
  }

  function seekFromTimeline(x, width) {
    els.audio.currentTime = Math.max(0, Math.min(xToTime(x, width), els.audio.duration));
    els.currentTime.textContent = formatTime(els.audio.currentTime);
    renderTimeline();
    renderLaneEditor();
  }

  function startDrag(event) {
    if (!state.audioBuffer) return;
    const { x, y, width } = canvasPointer(event);
    if (y <= RULER_HEIGHT) {
      state.scrubbingTimeline = true;
      els.waveform.setPointerCapture(event.pointerId);
      els.dragHelp.textContent = '拖动以定位播放位置';
      els.dragHelp.classList.remove('hidden');
      seekFromTimeline(x, width);
      return;
    }
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
    const { x, y, width } = canvasPointer(event);
    if (state.scrubbingTimeline) {
      seekFromTimeline(x, width);
      return;
    }
    if (!state.draggingId) {
      els.waveform.style.cursor = y <= RULER_HEIGHT ? 'ew-resize' : nearestBeatAt(x, width, 11) ? 'col-resize' : 'crosshair';
      return;
    }
    const beat = state.beats.find(item => item.id === state.draggingId);
    if (!beat) return;
    beat.time = Number(Math.max(0, Math.min(xToTime(x, width), els.audio.duration)).toFixed(3));
    state.dragMoved = true;
    els.dragHelp.textContent = formatTime(beat.time);
    renderTimeline();
    renderInspector();
  }

  function endDrag() {
    if (state.scrubbingTimeline) {
      state.scrubbingTimeline = false;
      els.dragHelp.classList.add('hidden');
      els.dragHelp.textContent = '拖动以调整时间';
      return;
    }
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
    toast('完整工程已保存：包含音乐引用、编辑设置、节拍和轨道谱面');
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
      state.projectDuration = Number(data.duration || data.audio?.duration) || 0;
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
      const settings = data.settings || {};
      setChartDifficulty(settings.chartDifficulty, false);
      if (['concise','standard','detailed'].includes(settings.analysisDensity)) els.analysisDensity.value = settings.analysisDensity;
      if (Number.isFinite(Number(settings.sensitivity))) els.sensitivity.value = String(Math.max(0, Math.min(100, Number(settings.sensitivity))));
      els.sensitivityValue.textContent = `${els.sensitivity.value}%`;
      if ([.5,.75,1,1.25].includes(Number(settings.playbackRate))) els.playbackRate.value = String(settings.playbackRate);
      els.audio.playbackRate = Number(els.playbackRate.value);
      els.metronome.checked = Boolean(settings.metronome);
      if ([0,1,2,4].includes(Number(settings.snapDivision))) els.snapDivision.value = String(settings.snapDivision);
      if (['tap','hold'].includes(settings.noteType)) els.noteType.value = settings.noteType;
      if ([1,2,4].includes(Number(settings.holdLength))) els.holdLength.value = String(settings.holdLength);
      els.holdLengthWrap.classList.toggle('hidden', els.noteType.value !== 'hold');
      state.zoom = Math.max(1, Math.min(12, Number(settings.zoom) || 1));
      els.zoom.value = String(state.zoom);
      els.projectName.value = data.name || file.name.replace(/\.rhythm\.json$|\.json$/i, '');
      els.bpmValue.textContent = state.bpm ? state.bpm.toFixed(1) : '—';
      els.analysisResult.classList.remove('hidden');
      state.selectedId = null;
      state.selectedNoteId = null;
      const currentAudioMatches = audioReferenceMatches(data.audio, state.audioFile, state.audioBuffer?.duration || 0);
      if (!currentAudioMatches) detachAudioForProject(data.audio || null);
      else state.pendingAudioReference = null;
      renderAll();
      markDirty();
      const audioHint = currentAudioMatches ? '音乐已自动匹配。' : data.audio?.name ? `请重新关联音乐“${data.audio.name}”。` : '该工程没有音乐引用。';
      toast(`工程已打开：${state.beats.length} 个节拍、${state.notes.length} 个轨道音符。${audioHint}`);
    } catch (error) {
      toast('这个文件不是有效的节拍工程', 'error');
    }
  }

  function csvText(rows) {
    return '\ufeff' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  }

  const GAME_COLUMNS = ['index','time_ms','time_display','lane','type','end_time_ms','duration_ms'];
  const BEAT_COLUMNS = ['index','time_ms','time_seconds','time_display','type','strength','note'];

  function gameExportRows() {
    return state.notes.map((note, index) => ({
      index: index + 1,
      time_ms: Math.round(note.time * 1000),
      time_display: formatTime(note.time),
      lane: note.lane + 1,
      type: note.type,
      end_time_ms: note.type === 'hold' ? Math.round(note.endTime * 1000) : null,
      duration_ms: note.type === 'hold' ? Math.round((note.endTime - note.time) * 1000) : null
    }));
  }

  function beatExportRows() {
    return state.beats.map((beat, index) => ({
      index: index + 1,
      time_ms: Math.round(beat.time * 1000),
      time_seconds: Number(beat.time.toFixed(3)),
      time_display: formatTime(beat.time),
      type: beat.type,
      strength: beat.strength,
      note: beat.note || ''
    }));
  }

  function objectsToCsv(columns, records) {
    return csvText([columns, ...records.map(record => columns.map(column => record[column]))]);
  }

  function exportGameCsv() {
    downloadFile(`${els.projectName.value || '谱面'}.game.csv`, objectsToCsv(GAME_COLUMNS, gameExportRows()), 'text/csv;charset=utf-8');
    toast('游戏谱面 CSV 已导出');
  }

  function exportGameJson() {
    const project = projectData();
    const data = {
      format: 'rhythm-game-chart', version: 3, name: project.name,
      audio: project.audio ? { file: project.audio.reference || project.audio.name, duration_ms: Math.round(project.duration * 1000) } : null,
      lane_count: project.laneCount, bpm: project.bpm, beat_offset_ms: Math.round(project.beatOffset * 1000),
      time_unit: 'milliseconds', columns: GAME_COLUMNS, notes: gameExportRows()
    };
    downloadFile(`${els.projectName.value || '谱面'}.game.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('游戏 JSON 已导出：时间为毫秒，轨道从 1 开始');
  }

  function exportBeatCsv() {
    downloadFile(`${els.projectName.value || '节拍'}.beats.csv`, objectsToCsv(BEAT_COLUMNS, beatExportRows()), 'text/csv;charset=utf-8');
    toast('节拍列表 CSV 已导出');
  }

  function exportBeatJson() {
    const project = projectData();
    const data = {
      format: 'rhythm-beat-list', version: 2, name: project.name,
      audio: project.audio ? { file: project.audio.reference || project.audio.name, duration_ms: Math.round(project.duration * 1000) } : null,
      bpm: project.bpm, beat_offset_ms: Math.round(project.beatOffset * 1000), time_unit: 'milliseconds',
      columns: BEAT_COLUMNS, beats: beatExportRows()
    };
    downloadFile(`${els.projectName.value || '节拍'}.beats.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('节拍列表 JSON 已导出');
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
  els.halfBpmBtn.addEventListener('click', () => {
    els.bpmInput.value = Math.max(30, (Number(els.bpmInput.value) || state.bpm) / 2).toFixed(2);
  });
  els.doubleBpmBtn.addEventListener('click', () => {
    els.bpmInput.value = Math.min(300, (Number(els.bpmInput.value) || state.bpm) * 2).toFixed(2);
  });
  els.offsetMinusBtn.addEventListener('click', () => adjustTimingInput(els.offsetInput, -.01, 3));
  els.offsetPlusBtn.addEventListener('click', () => adjustTimingInput(els.offsetInput, .01, 3));
  els.setOffsetBtn.addEventListener('click', () => {
    els.offsetInput.value = Math.max(0, els.audio.currentTime || 0).toFixed(3);
    toast(`第一拍位置已填入 ${formatTime(els.audio.currentTime)}，点击“应用并重排节拍”后生效`);
  });
  els.previewOffsetBtn.addEventListener('click', previewFromOffset);
  els.applyTimingBtn.addEventListener('click', applyTimingCalibration);
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
  els.zoom.addEventListener('input', () => { state.zoom = Number(els.zoom.value); state.viewStart = Math.max(0, Math.min(els.audio.currentTime - viewDuration() / 2, els.audio.duration - viewDuration())); renderTimeline(); renderLaneEditor(); });
  els.fitBtn.addEventListener('click', () => { state.zoom = 1; state.viewStart = 0; els.zoom.value = '1'; renderTimeline(); renderLaneEditor(); });
  els.addBeatBtn.addEventListener('click', () => addBeat());
  els.undoBtn.addEventListener('click', undo);
  els.redoBtn.addEventListener('click', redo);
  els.waveform.addEventListener('pointerdown', startDrag);
  els.waveform.addEventListener('pointermove', moveDrag);
  els.waveform.addEventListener('pointerup', endDrag);
  els.waveform.addEventListener('pointercancel', endDrag);
  els.waveform.addEventListener('dblclick', event => {
    const p = canvasPointer(event);
    if (p.y > RULER_HEIGHT && !nearestBeatAt(p.x, p.width)) addBeat(xToTime(p.x, p.width));
  });
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
    renderLaneEditor();
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
  function openHelp() {
    helpReturnFocus = document.activeElement;
    els.helpModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    els.helpCloseBtn.focus();
  }

  function closeHelp() {
    if (els.helpModal.classList.contains('hidden')) return;
    els.helpModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    if (helpReturnFocus instanceof HTMLElement) helpReturnFocus.focus();
  }

  els.helpBtn.addEventListener('click', openHelp);
  els.helpCloseBtn.addEventListener('click', closeHelp);
  els.helpDoneBtn.addEventListener('click', closeHelp);
  els.helpModal.addEventListener('pointerdown', event => {
    if (event.target === els.helpModal) closeHelp();
  });
  els.saveProjectBtn.addEventListener('click', saveProject);
  els.openProjectBtn.addEventListener('click', () => els.projectFile.click());
  els.projectFile.addEventListener('change', event => openProject(event.target.files[0]));
  els.exportGameCsvBtn.addEventListener('click', exportGameCsv);
  els.exportGameJsonBtn.addEventListener('click', exportGameJson);
  els.exportBeatCsvBtn.addEventListener('click', exportBeatCsv);
  els.exportBeatJsonBtn.addEventListener('click', exportBeatJson);
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
  els.chartDifficulty.addEventListener('change', () => setChartDifficulty(els.chartDifficulty.value));
  els.noteType.addEventListener('change', () => els.holdLengthWrap.classList.toggle('hidden', els.noteType.value !== 'hold'));
  els.generateChartBtn.addEventListener('click', generateBaseChart);
  els.clearNotesBtn.addEventListener('click', () => {
    if (!state.notes.length || !confirm(`确定清空全部 ${state.notes.length} 个轨道音符吗？节拍分析结果会保留。`)) return;
    snapshot(); state.notes = []; state.selectedNoteId = null; renderAll(); markDirty();
  });
  els.testModeBtn.addEventListener('click', toggleTestMode);
  els.laneCanvas.addEventListener('pointerdown', handleLanePointer);
  els.laneCanvas.addEventListener('pointermove', moveLanePointer);
  els.laneCanvas.addEventListener('pointerup', endLanePointer);
  els.laneCanvas.addEventListener('pointercancel', endLanePointer);
  els.laneCanvas.addEventListener('contextmenu', event => { event.preventDefault(); handleLanePointer(event); });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !els.helpModal.classList.contains('hidden')) {
      event.preventDefault();
      closeHelp();
      return;
    }
    if (event.key === 'Tab' && !els.helpModal.classList.contains('hidden')) {
      const focusable = [...els.helpModal.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.disabled && element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
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
      state.projectDuration = Number(saved.duration || saved.audio?.duration) || 0;
      state.pendingAudioReference = saved.audio || null;
      state.laneCount = Math.max(2, Math.min(6, Number(saved.laneCount) || 4));
      state.notes = Array.isArray(saved.notes) ? saved.notes.map(note => ({ ...note, id: makeId() })) : [];
      els.laneCount.value = String(state.laneCount);
      if ([0,1,2,4].includes(Number(saved.snapDivision))) els.snapDivision.value = String(saved.snapDivision);
      const settings = saved.settings || {};
      setChartDifficulty(settings.chartDifficulty, false);
      if (['concise','standard','detailed'].includes(settings.analysisDensity)) els.analysisDensity.value = settings.analysisDensity;
      if (Number.isFinite(Number(settings.sensitivity))) els.sensitivity.value = String(Math.max(0, Math.min(100, Number(settings.sensitivity))));
      els.sensitivityValue.textContent = `${els.sensitivity.value}%`;
      if ([.5,.75,1,1.25].includes(Number(settings.playbackRate))) els.playbackRate.value = String(settings.playbackRate);
      els.metronome.checked = Boolean(settings.metronome);
      if (['tap','hold'].includes(settings.noteType)) els.noteType.value = settings.noteType;
      if ([1,2,4].includes(Number(settings.holdLength))) els.holdLength.value = String(settings.holdLength);
      els.holdLengthWrap.classList.toggle('hidden', els.noteType.value !== 'hold');
      els.bpmValue.textContent = state.bpm ? state.bpm.toFixed(1) : '—';
      els.analysisResult.classList.remove('hidden');
      if (saved.audio?.name) els.timelineHint.textContent = `请重新关联音乐“${saved.audio.name}”`;
      toast(`已恢复上次未导出的 ${state.beats.length} 个节拍和 ${state.notes.length} 个音符，请重新关联音乐`);
    }
  } catch (_) { /* ignore corrupt autosave */ }

  resizeCanvas();
  renderAll();
  registerWebMcpTools();
})();
