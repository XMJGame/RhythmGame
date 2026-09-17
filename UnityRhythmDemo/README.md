# Rhythm Curve Demo（Unity 2021.3.40f1）

这是一个读取网页节拍工坊 `game.json` 的双轨 3D 下落式音游 Demo。

## 打开与运行

1. 用 Unity Hub 打开本目录，编辑器版本选择 `2021.3.40f1`。
2. 打开 `Assets/Scenes/Main.unity`。
3. 点击 Play。
4. 菜单中选择“标准 / 困难 / 地狱”，再开始游戏。

## 操作

- 左轨：`D`
- 右轨：`K`
- `Space`：暂停 / 继续
- `R`：重新开始
- `Esc`：返回难度菜单

## 数据来源

- 谱面：`Assets/Charts/game.json`
- 音乐：`Assets/Audio/节拍测试曲-120BPM-第一拍2秒.wav`

JSON 中的 `lane` 从 1 开始，运行时会转换为 Unity 内部从 0 开始的索引。

## 曲线难度配置

三个配置位于 `Assets/Difficulties/`，选中后可在 Inspector 直接编辑：

- `Extra Note Chance`：在相邻 JSON 音符之间插入额外音符的概率曲线。
- `Chord Chance`：原音符生成双押的概率曲线。
- `Approach Time`：音符提前多少秒进入轨道；数值越小，看起来越快。
- `Hit Window`：判定窗口秒数；数值越小越严格。

曲线横轴统一是歌曲进度 `0 → 1`。标准模式保持 JSON 原谱；困难和地狱通过曲线逐段增加密度、速度和判定压力。

## 工程结构

- 相机、AudioListener、灯光、轨道、判定线、生成点和判定点都直接保存在 `Main.unity`，可以在 Scene 视图调整。
- `Assets/Prefabs/Note.prefab` 是唯一的音符 Prefab。
- 游戏开始时预热 32 个音符对象；游玩过程中从对象池取出和归还，不重复 Instantiate/Destroy。
- 音乐由 `AudioSettings.dspTime` 和 `AudioSource.PlayScheduled` 统一计时，音符生成、位置、按键判定和 MISS 使用同一个 DSP 歌曲时间。
- `RhythmGameController.inputOffsetMs` 用于以后校准键盘、音频设备造成的输入延迟。

如果替换 `game.json` 或音乐，保持文件名不变后回到 Unity 等待重新导入即可。若要改名，请同时在场景中的 `RhythmGameController` 重新关联资源。
