using UnityEngine;

namespace RhythmCurveDemo
{
    [CreateAssetMenu(menuName = "Rhythm Game/Difficulty Profile", fileName = "DifficultyProfile")]
    public class DifficultyProfile : ScriptableObject
    {
        [Tooltip("对应 game.json 中 charts 下的键名：standard / hard / hell")]
        public string chartKey = "standard";
        public string displayName = "标准";
        [TextArea] public string description = "读取 JSON 中对应难度的谱面";
        public Color accentColor = new Color(1f, .82f, .2f);
        [Min(.1f)] public float scoreMultiplier = 1f;

        [Header("横轴均为歌曲进度 0 → 1")]
        [Tooltip("音符提前多少秒进入画面。越小表示视觉下落越快。")]
        public AnimationCurve approachTimeCurve = AnimationCurve.Linear(0, 3f, 1, 3f);

        [Tooltip("允许击中的最大时间误差，单位秒。越小越严格。")]
        public AnimationCurve hitWindowCurve = AnimationCurve.Linear(0, .18f, 1, .16f);

        public float EvaluateApproachTime(float progress) => Mathf.Max(.55f, approachTimeCurve.Evaluate(progress));
        public float EvaluateHitWindow(float progress) => Mathf.Clamp(hitWindowCurve.Evaluate(progress), .035f, .3f);
    }
}
