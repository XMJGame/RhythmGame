using UnityEngine;

namespace RhythmCurveDemo
{
    [CreateAssetMenu(menuName = "Rhythm Game/Difficulty Profile", fileName = "DifficultyProfile")]
    public class DifficultyProfile : ScriptableObject
    {
        public string displayName = "标准";
        [TextArea] public string description = "使用 JSON 原谱";
        public Color accentColor = new Color(1f, .82f, .2f);
        [Min(.1f)] public float scoreMultiplier = 1f;

        [Header("横轴均为歌曲进度 0 → 1")]
        [Tooltip("在两个 JSON 音符中间插入额外音符的概率。标准建议保持 0。")]
        public AnimationCurve extraNoteChanceCurve = AnimationCurve.Linear(0, 0, 1, 0);

        [Tooltip("把原音符扩展为双押的概率。")]
        public AnimationCurve chordChanceCurve = AnimationCurve.Linear(0, 0, 1, 0);

        [Tooltip("音符提前多少秒进入画面。越小表示视觉下落越快。")]
        public AnimationCurve approachTimeCurve = AnimationCurve.Linear(0, 3f, 1, 3f);

        [Tooltip("允许击中的最大时间误差，单位秒。越小越严格。")]
        public AnimationCurve hitWindowCurve = AnimationCurve.Linear(0, .18f, 1, .16f);

        public float EvaluateExtraChance(float progress) => Mathf.Clamp01(extraNoteChanceCurve.Evaluate(progress));
        public float EvaluateChordChance(float progress) => Mathf.Clamp01(chordChanceCurve.Evaluate(progress));
        public float EvaluateApproachTime(float progress) => Mathf.Max(.55f, approachTimeCurve.Evaluate(progress));
        public float EvaluateHitWindow(float progress) => Mathf.Clamp(hitWindowCurve.Evaluate(progress), .035f, .3f);
    }
}
