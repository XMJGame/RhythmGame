using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace RhythmCurveDemo.Editor
{
    public static class ProjectBuilder
    {
        private const string DifficultyFolder = "Assets/Difficulties";

        [MenuItem("Rhythm Game/Rebuild Demo Scene")]
        public static void Build()
        {
            Directory.CreateDirectory(DifficultyFolder);
            AssetDatabase.Refresh();

            DifficultyProfile standard = CreateProfile(
                "Standard", "标准", "保持 JSON 原谱，适合第一次试玩",
                new Color(1f, .82f, .2f), 1f,
                Curve(0, 0, 1, 0), Curve(0, 0, 1, 0),
                Curve(0, 3.2f, 1, 2.8f), Curve(0, .18f, 1, .15f));

            DifficultyProfile hard = CreateProfile(
                "Hard", "困难", "中后段逐渐增加半拍音符并加快下落",
                new Color(.25f, .9f, 1f), 1.35f,
                Curve(0, .2f, .55f, .48f, 1, .72f), Curve(0, 0, 1, .18f),
                Curve(0, 2.65f, 1, 1.95f), Curve(0, .145f, 1, .105f));

            DifficultyProfile hell = CreateProfile(
                "Hell", "地狱", "半拍与双押逐段增多，速度越来越快",
                new Color(1f, .23f, .38f), 1.75f,
                Curve(0, .72f, .5f, .9f, 1, 1f), Curve(0, .08f, .55f, .22f, 1, .42f),
                Curve(0, 2.05f, .5f, 1.55f, 1, 1.05f), Curve(0, .115f, 1, .075f));

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "Main";
            GameObject root = new GameObject("RhythmGame");
            RhythmGameController controller = root.AddComponent<RhythmGameController>();
            controller.chartJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Charts/game.json");
            controller.music = AssetDatabase.LoadAssetAtPath<AudioClip>("Assets/Audio/节拍测试曲-120BPM-第一拍2秒.wav");
            controller.difficulties = new[] { standard, hard, hell };
            controller.runtimeMaterialTemplate = CreateRuntimeMaterial();

            Directory.CreateDirectory("Assets/Scenes");
            EditorSceneManager.SaveScene(scene, "Assets/Scenes/Main.unity");
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/Main.unity", true) };

            PlayerSettings.productName = "Rhythm Curve Demo";
            PlayerSettings.companyName = "Rhythm Chart Studio";
            PlayerSettings.defaultScreenWidth = 1100;
            PlayerSettings.defaultScreenHeight = 700;
            PlayerSettings.resizableWindow = true;
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("Rhythm Curve Demo scene and difficulty curve assets are ready.");
        }

        [MenuItem("Rhythm Game/Open Demo And Play")]
        public static void OpenAndPlay()
        {
            EditorSceneManager.OpenScene("Assets/Scenes/Main.unity");
            EditorApplication.delayCall += () => EditorApplication.isPlaying = true;
        }

        private static DifficultyProfile CreateProfile(string fileName, string displayName, string description, Color color,
            float multiplier, AnimationCurve extra, AnimationCurve chord, AnimationCurve approach, AnimationCurve hitWindow)
        {
            string path = $"{DifficultyFolder}/{fileName}.asset";
            DifficultyProfile profile = AssetDatabase.LoadAssetAtPath<DifficultyProfile>(path);
            if (profile == null)
            {
                profile = ScriptableObject.CreateInstance<DifficultyProfile>();
                AssetDatabase.CreateAsset(profile, path);
            }
            profile.displayName = displayName;
            profile.description = description;
            profile.accentColor = color;
            profile.scoreMultiplier = multiplier;
            profile.extraNoteChanceCurve = extra;
            profile.chordChanceCurve = chord;
            profile.approachTimeCurve = approach;
            profile.hitWindowCurve = hitWindow;
            EditorUtility.SetDirty(profile);
            return profile;
        }

        private static Material CreateRuntimeMaterial()
        {
            Directory.CreateDirectory("Assets/Materials");
            const string path = "Assets/Materials/RuntimeBase.mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(Shader.Find("Standard"));
                material.name = "Runtime Base";
                AssetDatabase.CreateAsset(material, path);
            }
            material.color = Color.white;
            EditorUtility.SetDirty(material);
            return material;
        }

        private static AnimationCurve Curve(params float[] values)
        {
            int count = values.Length / 2;
            Keyframe[] keys = new Keyframe[count];
            for (int i = 0; i < count; i++) keys[i] = new Keyframe(values[i * 2], values[i * 2 + 1]);
            AnimationCurve curve = new AnimationCurve(keys);
            for (int i = 0; i < count; i++)
                AnimationUtility.SetKeyLeftTangentMode(curve, i, AnimationUtility.TangentMode.ClampedAuto);
            for (int i = 0; i < count; i++)
                AnimationUtility.SetKeyRightTangentMode(curve, i, AnimationUtility.TangentMode.ClampedAuto);
            return curve;
        }
    }
}
