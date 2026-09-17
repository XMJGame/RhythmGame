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
        private const float HitZ = -2.2f;
        private const float SpawnZ = 13f;
        private const float LaneSpacing = 2.7f;

        [MenuItem("Rhythm Game/Rebuild Demo Scene")]
        public static void Build()
        {
            Directory.CreateDirectory(DifficultyFolder);
            Directory.CreateDirectory("Assets/Materials");
            Directory.CreateDirectory("Assets/Prefabs");
            Directory.CreateDirectory("Assets/Scenes");
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

            Material trackMaterial = CreateMaterial("TrackBase", new Color(.045f, .065f, .1f));
            Material leftLaneMaterial = CreateMaterial("LaneLeft", new Color(.06f, .2f, .28f));
            Material rightLaneMaterial = CreateMaterial("LaneRight", new Color(.2f, .08f, .27f));
            Material dividerMaterial = CreateMaterial("LaneDivider", new Color(.35f, .48f, .62f));
            Material hitLineMaterial = CreateMaterial("HitLine", new Color(1f, .76f, .12f), true);
            Material noteMaterial = CreateMaterial("NoteBase", Color.white, true);
            NoteView notePrefab = CreateNotePrefab(noteMaterial);

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "Main";

            Camera camera = CreateCamera();
            CreateLight();

            GameObject trackRoot = new GameObject("TrackRoot");
            CreateSceneBlock("Track Base", trackRoot.transform, new Vector3(0, -.35f, 5.3f), new Vector3(6.4f, .3f, 16.7f), trackMaterial);
            CreateSceneBlock("Lane 1", trackRoot.transform, new Vector3(LaneX(0), 0, 5.3f), new Vector3(2.45f, .12f, 16.4f), leftLaneMaterial);
            CreateSceneBlock("Lane 2", trackRoot.transform, new Vector3(LaneX(1), 0, 5.3f), new Vector3(2.45f, .12f, 16.4f), rightLaneMaterial);
            CreateSceneBlock("Lane Divider", trackRoot.transform, new Vector3(0, .08f, 5.3f), new Vector3(.08f, .08f, 16.4f), dividerMaterial);
            CreateSceneBlock("Hit Line", trackRoot.transform, new Vector3(0, .3f, HitZ), new Vector3(5.9f, .2f, .22f), hitLineMaterial);

            Transform anchorRoot = new GameObject("Lane Anchors").transform;
            anchorRoot.SetParent(trackRoot.transform, false);
            Transform[] spawnPoints = new Transform[2];
            Transform[] hitPoints = new Transform[2];
            for (int lane = 0; lane < 2; lane++)
            {
                spawnPoints[lane] = CreateAnchor($"Lane {lane + 1} Spawn", anchorRoot, new Vector3(LaneX(lane), .42f, SpawnZ));
                hitPoints[lane] = CreateAnchor($"Lane {lane + 1} Hit", anchorRoot, new Vector3(LaneX(lane), .42f, HitZ));
            }
            Transform noteContainer = new GameObject("Note Pool").transform;
            noteContainer.SetParent(trackRoot.transform, false);

            GameObject root = new GameObject("RhythmGame");
            AudioSource audioSource = root.AddComponent<AudioSource>();
            audioSource.playOnAwake = false;
            audioSource.spatialBlend = 0;
            RhythmGameController controller = root.AddComponent<RhythmGameController>();
            controller.chartJson = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/Charts/game.json");
            controller.music = AssetDatabase.LoadAssetAtPath<AudioClip>("Assets/Audio/节拍测试曲-120BPM-第一拍2秒.wav");
            controller.difficulties = new[] { standard, hard, hell };
            controller.audioSource = audioSource;
            controller.notePrefab = notePrefab;
            controller.noteContainer = noteContainer;
            controller.laneSpawnPoints = spawnPoints;
            controller.laneHitPoints = hitPoints;

            EditorSceneManager.SaveScene(scene, "Assets/Scenes/Main.unity");
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/Main.unity", true) };

            PlayerSettings.productName = "Rhythm Curve Demo";
            PlayerSettings.companyName = "Rhythm Chart Studio";
            PlayerSettings.defaultScreenWidth = 1100;
            PlayerSettings.defaultScreenHeight = 700;
            PlayerSettings.resizableWindow = true;
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Selection.activeObject = camera.gameObject;
            Debug.Log("Rhythm Curve Demo scene, note prefab, pool references, and DSP clock are ready.");
        }

        [MenuItem("Rhythm Game/Open Demo And Play")]
        public static void OpenAndPlay()
        {
            EditorSceneManager.OpenScene("Assets/Scenes/Main.unity");
            EditorApplication.delayCall += () => EditorApplication.isPlaying = true;
        }

        private static Camera CreateCamera()
        {
            GameObject cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            Camera camera = cameraObject.AddComponent<Camera>();
            cameraObject.AddComponent<AudioListener>();
            camera.transform.position = new Vector3(0, 8.2f, -10.8f);
            camera.transform.rotation = Quaternion.Euler(27f, 0, 0);
            camera.fieldOfView = 54f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.025f, .035f, .06f);
            return camera;
        }

        private static void CreateLight()
        {
            GameObject lightObject = new GameObject("Key Light");
            Light light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.15f;
            light.color = new Color(.78f, .88f, 1f);
            lightObject.transform.rotation = Quaternion.Euler(48f, -24f, 0);
        }

        private static GameObject CreateSceneBlock(string name, Transform parent, Vector3 position, Vector3 scale, Material material)
        {
            GameObject block = GameObject.CreatePrimitive(PrimitiveType.Cube);
            block.name = name;
            block.transform.SetParent(parent, false);
            block.transform.position = position;
            block.transform.localScale = scale;
            block.GetComponent<Renderer>().sharedMaterial = material;
            Object.DestroyImmediate(block.GetComponent<Collider>());
            return block;
        }

        private static Transform CreateAnchor(string name, Transform parent, Vector3 position)
        {
            Transform anchor = new GameObject(name).transform;
            anchor.SetParent(parent, false);
            anchor.position = position;
            return anchor;
        }

        private static float LaneX(int lane) => (lane - .5f) * LaneSpacing;

        private static NoteView CreateNotePrefab(Material material)
        {
            GameObject temporary = GameObject.CreatePrimitive(PrimitiveType.Cube);
            temporary.name = "Note";
            temporary.transform.localScale = new Vector3(1.75f, .45f, .55f);
            Object.DestroyImmediate(temporary.GetComponent<Collider>());
            Renderer renderer = temporary.GetComponent<Renderer>();
            renderer.sharedMaterial = material;
            NoteView view = temporary.AddComponent<NoteView>();
            view.visualRenderer = renderer;
            const string path = "Assets/Prefabs/Note.prefab";
            GameObject prefab = PrefabUtility.SaveAsPrefabAsset(temporary, path);
            Object.DestroyImmediate(temporary);
            return prefab.GetComponent<NoteView>();
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

        private static Material CreateMaterial(string fileName, Color color, bool emission = false)
        {
            string path = $"Assets/Materials/{fileName}.mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(Shader.Find("Standard"));
                AssetDatabase.CreateAsset(material, path);
            }
            material.name = fileName;
            material.color = color;
            if (emission)
            {
                material.EnableKeyword("_EMISSION");
                material.SetColor("_EmissionColor", color * .28f);
            }
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
