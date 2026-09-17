using System;

namespace RhythmCurveDemo
{
    [Serializable]
    public class RhythmChart
    {
        public string format;
        public int version;
        public string name;
        public ChartAudio audio;
        public int lane_count;
        public float bpm;
        public int beat_offset_ms;
        public string time_unit;
        public ChartCollection charts;

        public ChartDifficulty GetChart(string key)
        {
            if (charts == null) return null;
            switch (key)
            {
                case "standard": return charts.standard;
                case "hard": return charts.hard;
                case "hell": return charts.hell;
                default: return null;
            }
        }
    }

    [Serializable]
    public class ChartCollection
    {
        public ChartDifficulty standard;
        public ChartDifficulty hard;
        public ChartDifficulty hell;
    }

    [Serializable]
    public class ChartDifficulty
    {
        public string difficulty;
        public int note_count;
        public ChartNote[] notes;
    }

    [Serializable]
    public class ChartAudio
    {
        public string file;
        public int duration_ms;
    }

    [Serializable]
    public class ChartNote
    {
        public string difficulty;
        public int index;
        public int time_ms;
        public string time_display;
        public int lane;
        public string type;
        public int end_time_ms;
        public int duration_ms;
    }
}
