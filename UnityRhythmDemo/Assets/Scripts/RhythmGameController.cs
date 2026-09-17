using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace RhythmCurveDemo
{
    public class RhythmGameController : MonoBehaviour
    {
        [Header("Data")]
        public TextAsset chartJson;
        public AudioClip music;
        public DifficultyProfile[] difficulties;

        [Header("Scene References")]
        public AudioSource audioSource;
        public NoteView notePrefab;
        public Transform noteContainer;
        public Transform[] laneSpawnPoints;
        public Transform[] laneHitPoints;

        [Header("DSP Timing")]
        [Tooltip("正值表示把玩家输入按更晚的音乐时间判定，用于设备延迟校准。")]
        public float inputOffsetMs;
        [Range(.05f, .5f)] public float scheduleLeadSeconds = .15f;

        [Header("Pool")]
        [Min(8)] public int initialPoolSize = 32;

        private readonly List<RuntimeNote> runtimeNotes = new List<RuntimeNote>();
        private readonly List<AvailableDifficulty> availableDifficulties = new List<AvailableDifficulty>();
        private readonly Queue<NoteView> notePool = new Queue<NoteView>();
        private RhythmChart chart;
        private int difficultyIndex;
        private int nextSpawnIndex;
        private int score;
        private int combo;
        private int maxCombo;
        private int perfects;
        private int goods;
        private int misses;
        private int createdNoteViews;
        private bool playing;
        private bool paused;
        private double songStartDspTime;
        private double pauseStartedDspTime;
        private double accumulatedPauseTime;
        private string judgement = "";
        private float judgementUntil;
        private GUIStyle titleStyle;
        private GUIStyle labelStyle;
        private GUIStyle centerStyle;
        private GUIStyle judgementStyle;
        private GUIStyle buttonStyle;

        private class RuntimeNote
        {
            public float time;
            public int lane;
            public bool spawned;
            public bool resolved;
            public NoteView view;
        }

        private class AvailableDifficulty
        {
            public DifficultyProfile profile;
            public ChartDifficulty chart;
        }

        private void Awake()
        {
            Application.targetFrameRate = 120;
            ValidateSceneReferences();
            audioSource.playOnAwake = false;
            audioSource.clip = music;
            ParseChart();
            WarmPool();
        }

        private void Start()
        {
            difficultyIndex = 0;
            if (Environment.GetCommandLineArgs().Contains("-smokeTest"))
            {
                difficultyIndex = Mathf.Max(0, availableDifficulties.Count - 1);
                BeginGame();
                StartCoroutine(RunSmokeTest());
            }
        }

        private void ValidateSceneReferences()
        {
            if (audioSource == null || notePrefab == null || noteContainer == null ||
                laneSpawnPoints == null || laneHitPoints == null || laneSpawnPoints.Length < 2 || laneHitPoints.Length < 2)
                throw new InvalidOperationException("Main scene references are incomplete. Run Rhythm Game > Rebuild Demo Scene.");
        }

        private IEnumerator RunSmokeTest()
        {
            yield return new WaitForSecondsRealtime(4f);
            AvailableDifficulty selected = GetSelectedDifficulty();
            int sourceNoteCount = selected?.chart?.notes?.Length ?? 0;
            bool emptyDifficultyFilterPassed = VerifyEmptyDifficultyFiltering();
            bool passed = chart != null && availableDifficulties.Count > 0 && sourceNoteCount > 0 &&
                          runtimeNotes.Count == sourceNoteCount && audioSource.clip != null &&
                          createdNoteViews == initialPoolSize && emptyDifficultyFilterPassed;
            string message = $"RHYTHM_SMOKE_{(passed ? "PASS" : "FAIL")} " +
                             $"availableDifficulties={availableDifficulties.Count} sourceNotes={sourceNoteCount} runtimeNotes={runtimeNotes.Count} " +
                             $"difficulty={selected?.profile?.displayName ?? "none"} emptyDifficultyFilter={emptyDifficultyFilterPassed} " +
                             $"dspSongTime={GetSongTime():0.000} pooledViews={createdNoteViews}";
            if (passed) Debug.Log(message); else Debug.LogError(message);
            Application.Quit(passed ? 0 : 1);
        }

        private void ParseChart()
        {
            if (chartJson == null)
            {
                Debug.LogError("Chart JSON is missing.");
                return;
            }

            string safeJson = chartJson.text
                .Replace("\"end_time_ms\": null", "\"end_time_ms\": 0")
                .Replace("\"duration_ms\": null", "\"duration_ms\": 0");
            chart = JsonUtility.FromJson<RhythmChart>(safeJson);
            if (chart == null || chart.charts == null)
            {
                Debug.LogError("Could not parse rhythm chart.");
                return;
            }

            availableDifficulties.Clear();
            availableDifficulties.AddRange(FindAvailableDifficulties(chart));

            if (availableDifficulties.Count == 0)
                Debug.LogError("No playable difficulty was found in game.json. Empty difficulties are hidden.");
        }

        private List<AvailableDifficulty> FindAvailableDifficulties(RhythmChart source)
        {
            List<AvailableDifficulty> result = new List<AvailableDifficulty>();
            foreach (DifficultyProfile profile in difficulties ?? Array.Empty<DifficultyProfile>())
            {
                if (profile == null || string.IsNullOrWhiteSpace(profile.chartKey)) continue;
                ChartDifficulty difficultyChart = source?.GetChart(profile.chartKey);
                if (difficultyChart?.notes == null || difficultyChart.notes.Length == 0) continue;
                result.Add(new AvailableDifficulty { profile = profile, chart = difficultyChart });
            }
            return result;
        }

        private bool VerifyEmptyDifficultyFiltering()
        {
            RhythmChart testChart = new RhythmChart
            {
                charts = new ChartCollection
                {
                    standard = new ChartDifficulty { notes = Array.Empty<ChartNote>() },
                    hard = new ChartDifficulty { notes = new[] { new ChartNote { lane = 1 } } }
                }
            };
            List<AvailableDifficulty> filtered = FindAvailableDifficulties(testChart);
            return filtered.Count == 1 && filtered[0].profile.chartKey == "hard";
        }

        private void WarmPool()
        {
            for (int i = 0; i < initialPoolSize; i++) notePool.Enqueue(CreatePooledNote());
        }

        private NoteView CreatePooledNote()
        {
            NoteView view = Instantiate(notePrefab, noteContainer);
            view.name = $"Pooled Note {++createdNoteViews:00}";
            view.Hide();
            return view;
        }

        private NoteView AcquireNote()
        {
            return notePool.Count > 0 ? notePool.Dequeue() : CreatePooledNote();
        }

        private void ReleaseNote(NoteView view)
        {
            if (view == null || !view.gameObject.activeSelf) return;
            view.Hide();
            view.transform.SetParent(noteContainer, false);
            notePool.Enqueue(view);
        }

        private void BuildDifficultyChart()
        {
            runtimeNotes.Clear();
            AvailableDifficulty selected = GetSelectedDifficulty();
            if (selected == null) return;
            ChartNote[] source = selected.chart.notes.OrderBy(note => note.time_ms).ToArray();
            int laneCount = Mathf.Min(laneSpawnPoints.Length, laneHitPoints.Length);

            foreach (ChartNote chartNote in source)
            {
                float time = chartNote.time_ms / 1000f;
                int lane = Mathf.Clamp(chartNote.lane - 1, 0, laneCount - 1);
                runtimeNotes.Add(new RuntimeNote { time = time, lane = lane });
            }

            runtimeNotes.Sort((a, b) => a.time != b.time ? a.time.CompareTo(b.time) : a.lane.CompareTo(b.lane));
        }

        private AvailableDifficulty GetSelectedDifficulty()
        {
            if (availableDifficulties.Count == 0) return null;
            difficultyIndex = Mathf.Clamp(difficultyIndex, 0, availableDifficulties.Count - 1);
            return availableDifficulties[difficultyIndex];
        }

        private void BeginGame()
        {
            if (chart == null || music == null || availableDifficulties.Count == 0) return;
            ClearNotes();
            BuildDifficultyChart();
            nextSpawnIndex = 0;
            score = combo = maxCombo = perfects = goods = misses = 0;
            judgement = "READY";
            judgementUntil = Time.unscaledTime + .8f;
            paused = false;
            playing = true;
            accumulatedPauseTime = 0;
            pauseStartedDspTime = 0;
            audioSource.Stop();
            audioSource.clip = music;
            audioSource.timeSamples = 0;
            songStartDspTime = AudioSettings.dspTime + scheduleLeadSeconds;
            audioSource.PlayScheduled(songStartDspTime);
        }

        private double GetSongTime()
        {
            if (!playing) return 0;
            double clock = paused ? pauseStartedDspTime : AudioSettings.dspTime;
            return Math.Max(0, clock - songStartDspTime - accumulatedPauseTime);
        }

        private void TogglePause()
        {
            if (!paused)
            {
                pauseStartedDspTime = AudioSettings.dspTime;
                paused = true;
                audioSource.Pause();
            }
            else
            {
                accumulatedPauseTime += AudioSettings.dspTime - pauseStartedDspTime;
                paused = false;
                audioSource.UnPause();
            }
        }

        private void ClearNotes()
        {
            foreach (RuntimeNote note in runtimeNotes)
            {
                ReleaseNote(note.view);
                note.view = null;
            }
            runtimeNotes.Clear();
        }

        private void Update()
        {
            if (Input.GetKeyDown(KeyCode.Escape))
            {
                audioSource.Stop();
                playing = false;
                paused = false;
                ClearNotes();
                return;
            }
            if (!playing)
            {
                if (Input.GetKeyDown(KeyCode.Alpha1) && availableDifficulties.Count > 0) difficultyIndex = 0;
                if (Input.GetKeyDown(KeyCode.Alpha2) && availableDifficulties.Count > 1) difficultyIndex = 1;
                if (Input.GetKeyDown(KeyCode.Alpha3) && availableDifficulties.Count > 2) difficultyIndex = 2;
                if (Input.GetKeyDown(KeyCode.Return)) BeginGame();
                return;
            }
            if (Input.GetKeyDown(KeyCode.R)) { BeginGame(); return; }
            if (Input.GetKeyDown(KeyCode.Space)) TogglePause();
            if (paused) return;

            float songTime = (float)GetSongTime();
            float progress = music.length > 0 ? songTime / music.length : 0;
            DifficultyProfile profile = GetSelectedDifficulty().profile;
            float approach = profile.EvaluateApproachTime(progress);
            float hitWindow = profile.EvaluateHitWindow(progress);

            while (nextSpawnIndex < runtimeNotes.Count && runtimeNotes[nextSpawnIndex].time - songTime <= approach)
            {
                Spawn(runtimeNotes[nextSpawnIndex], profile.accentColor);
                nextSpawnIndex++;
            }

            foreach (RuntimeNote note in runtimeNotes)
            {
                if (!note.spawned || note.resolved || note.view == null) continue;
                float remaining = note.time - songTime;
                float t = Mathf.Clamp01(remaining / approach);
                note.view.transform.position = Vector3.Lerp(laneHitPoints[note.lane].position, laneSpawnPoints[note.lane].position, t);
                if (songTime > note.time + hitWindow) ResolveMiss(note);
            }

            float judgementTime = songTime + inputOffsetMs / 1000f;
            if (Input.GetKeyDown(KeyCode.D)) Judge(0, judgementTime, hitWindow);
            if (Input.GetKeyDown(KeyCode.K)) Judge(1, judgementTime, hitWindow);

            if (songTime >= music.length)
            {
                audioSource.Stop();
                playing = false;
                judgement = "FINISH";
                judgementUntil = Time.unscaledTime + 99f;
            }
        }

        private void Spawn(RuntimeNote note, Color color)
        {
            note.spawned = true;
            note.view = AcquireNote();
            note.view.Show(color, noteContainer, laneSpawnPoints[note.lane].position);
        }

        private void Judge(int lane, float songTime, float hitWindow)
        {
            RuntimeNote candidate = runtimeNotes
                .Where(note => note.lane == lane && !note.resolved && note.spawned)
                .OrderBy(note => Mathf.Abs(note.time - songTime))
                .FirstOrDefault();
            if (candidate == null || Mathf.Abs(candidate.time - songTime) > hitWindow)
            {
                combo = 0;
                ShowJudgement("MISS");
                return;
            }

            float error = Mathf.Abs(candidate.time - songTime);
            float perfectWindow = hitWindow * .42f;
            candidate.resolved = true;
            ReleaseNote(candidate.view);
            candidate.view = null;
            combo++;
            maxCombo = Mathf.Max(maxCombo, combo);
            if (error <= perfectWindow)
            {
                perfects++;
                score += Mathf.RoundToInt(1000 * GetSelectedDifficulty().profile.scoreMultiplier);
                ShowJudgement("PERFECT");
            }
            else
            {
                goods++;
                score += Mathf.RoundToInt(500 * GetSelectedDifficulty().profile.scoreMultiplier);
                ShowJudgement("GOOD");
            }
        }

        private void ResolveMiss(RuntimeNote note)
        {
            note.resolved = true;
            ReleaseNote(note.view);
            note.view = null;
            combo = 0;
            misses++;
            ShowJudgement("MISS");
        }

        private void ShowJudgement(string text)
        {
            judgement = text;
            judgementUntil = Time.unscaledTime + .45f;
        }

        private void InitStyles()
        {
            if (titleStyle != null) return;
            titleStyle = new GUIStyle(GUI.skin.label) { fontSize = 30, fontStyle = FontStyle.Bold, normal = { textColor = Color.white } };
            labelStyle = new GUIStyle(GUI.skin.label) { fontSize = 18, normal = { textColor = new Color(.82f, .88f, .95f) } };
            centerStyle = new GUIStyle(labelStyle) { alignment = TextAnchor.MiddleCenter };
            judgementStyle = new GUIStyle(centerStyle) { fontSize = 38, fontStyle = FontStyle.Bold, normal = { textColor = new Color(1f, .82f, .2f) } };
            buttonStyle = new GUIStyle(GUI.skin.button) { fontSize = 20, fontStyle = FontStyle.Bold };
        }

        private void OnGUI()
        {
            InitStyles();
            DrawTopBar();
            if (!playing) DrawMenu(); else DrawPlayingHud();
        }

        private void DrawTopBar()
        {
            GUI.Box(new Rect(0, 0, Screen.width, 78), GUIContent.none);
            GUI.Label(new Rect(24, 12, 520, 42), "RHYTHM CURVE DEMO", titleStyle);
            if (chart != null)
                GUI.Label(new Rect(25, 48, 600, 24), $"{chart.name}  ·  {chart.bpm:0.#} BPM  ·  {chart.lane_count} lanes", labelStyle);
        }

        private void DrawMenu()
        {
            float width = Mathf.Min(680, Screen.width - 40);
            float x = (Screen.width - width) * .5f;
            float y = 112;
            GUI.Box(new Rect(x, y, width, 410), GUIContent.none);
            GUI.Label(new Rect(x + 20, y + 22, width - 40, 40), "选择难度 / SELECT DIFFICULTY", centerStyle);

            if (availableDifficulties.Count == 0)
            {
                GUI.Label(new Rect(x + 45, y + 105, width - 90, 100), "game.json 中没有包含音符的可用难度。\n请回到节拍工坊生成或编辑谱面后重新导出。", centerStyle);
                return;
            }

            float buttonsWidth = width - 110;
            float gap = 10f;
            float buttonWidth = (buttonsWidth - gap * (availableDifficulties.Count - 1)) / availableDifficulties.Count;
            for (int i = 0; i < availableDifficulties.Count; i++)
            {
                AvailableDifficulty available = availableDifficulties[i];
                DifficultyProfile profile = available.profile;
                GUI.color = i == difficultyIndex ? profile.accentColor : Color.white;
                if (GUI.Button(new Rect(x + 55 + i * (buttonWidth + gap), y + 82, buttonWidth, 64), $"{i + 1}  {profile.displayName}\n{available.chart.notes.Length} NOTES", buttonStyle))
                    difficultyIndex = i;
                GUI.color = Color.white;
            }

            AvailableDifficulty selectedDifficulty = GetSelectedDifficulty();
            DifficultyProfile selected = selectedDifficulty.profile;
            float midProgress = .5f;
            GUI.Label(new Rect(x + 45, y + 170, width - 90, 32), selected.description, centerStyle);
            GUI.Label(new Rect(x + 70, y + 215, width - 140, 80),
                $"谱面音符：{selectedDifficulty.chart.notes.Length}    JSON：charts.{selected.chartKey}\n" +
                $"提前出现：{selected.EvaluateApproachTime(midProgress):0.00}s    判定窗口：±{selected.EvaluateHitWindow(midProgress) * 1000:0}ms",
                centerStyle);
            GUI.color = selected.accentColor;
            if (GUI.Button(new Rect(x + width * .25f, y + 305, width * .5f, 64), "开始游戏  ENTER", buttonStyle)) BeginGame();
            GUI.color = Color.white;
            GUI.Label(new Rect(x + 20, y + 375, width - 40, 24), "D：左轨   K：右轨   Space：暂停   R：重开   Esc：菜单", centerStyle);
        }

        private void DrawPlayingHud()
        {
            AvailableDifficulty selected = GetSelectedDifficulty();
            if (selected == null) return;
            DifficultyProfile profile = selected.profile;
            GUI.Label(new Rect(Screen.width - 260, 12, 235, 30), profile.displayName, new GUIStyle(labelStyle) { alignment = TextAnchor.MiddleRight, normal = { textColor = profile.accentColor } });
            GUI.Label(new Rect(24, 92, 320, 32), $"SCORE  {score:0000000}", labelStyle);
            GUI.Label(new Rect(24, 124, 320, 32), $"COMBO  {combo}", labelStyle);
            GUI.Label(new Rect(Screen.width - 310, 92, 285, 28), $"PERFECT {perfects}   GOOD {goods}   MISS {misses}", new GUIStyle(labelStyle) { alignment = TextAnchor.MiddleRight, fontSize = 15 });
            GUI.Label(new Rect(Screen.width * .5f - 120, Screen.height - 92, 100, 42), "D", judgementStyle);
            GUI.Label(new Rect(Screen.width * .5f + 20, Screen.height - 92, 100, 42), "K", judgementStyle);
            if (Time.unscaledTime < judgementUntil)
                GUI.Label(new Rect(Screen.width * .5f - 200, Screen.height * .42f, 400, 60), judgement, judgementStyle);
            if (paused)
                GUI.Label(new Rect(Screen.width * .5f - 180, Screen.height * .5f, 360, 50), "PAUSED", judgementStyle);
        }
    }
}
