# 节拍工坊 / RhythmGame

这个仓库包含一个纯静态网页制谱工具，以及一个读取网页导出谱面的 Unity 音游 Demo。网页用于分析音乐、编辑节拍和三档轨道谱面；Unity Demo 用于本地试玩导出的谱面。

## 目录

- `dist/`：网页版节拍工坊的当前文件。部署静态网页时使用这里的 `index.html`、`app.js`、`styles.css`。
- `UnityRhythmDemo/`：Unity 2021.3.40f1 工程；更详细的操作见 [UnityRhythmDemo/README.md](UnityRhythmDemo/README.md)。
- `test-audio/`：120 BPM、第一拍约在 2 秒处的测试音乐及生成脚本。
- `game.json`：早期 v3 单难度导出示例，**不是**当前 Unity Demo 读取的文件。
- `dist.rar`：早期网页打包快照，可能落后于 `dist/`，不要用它覆盖当前部署。

## 使用网页制谱

用静态 HTTP 服务打开 `dist/index.html`。每次打开页面都是空工程，不会从浏览器自动恢复上次内容。

1. 选择本地音乐，或点击“打开工程文件”导入之前保存的 `.rhythm.json`。
2. 如果导入了工程，再选择原来的音乐文件进行关联；工程文件只记录音乐名称等引用信息，不包含音乐本身或电脑绝对路径。
3. 点击“分析音乐并生成节拍”，试听后调整 BPM、第一拍位置、节拍线。
4. 点击“生成三档谱面”，在标准、困难、地狱页签分别编辑轨道音符；也可以手动添加、拖动、删除。
5. 制作过程中经常点击“保存完整工程”。完成后按用途导出“游戏谱面 JSON/CSV”或“节拍列表 JSON/CSV”。

网页**不自动保存工程**。关闭或刷新前，请先下载完整工程文件。游戏谱面 JSON 是 v4 格式，音符位于 `charts.standard`、`charts.hard`、`charts.hell`，`lane` 从 1 开始。CSV 用 `difficulty` 列区分难度。

## Unity Demo

用 Unity Hub 以 **Unity 2021.3.40f1** 打开 `UnityRhythmDemo/`，打开 `Assets/Scenes/Main.unity` 并运行。Demo 读取 `UnityRhythmDemo/Assets/Charts/game.json` 中的三档音符；某档没有音符时，选择菜单会隐藏该档。难度曲线只调整下落提前时间与判定窗口，不会在运行时擅自增加音符。

当前 Unity 场景是**双轨、点击音符** Demo，操作键为 `D`、`K`，空格暂停/继续。网页支持 2–6 轨与长按编辑，但要在 Unity 中试玩这些谱面，还需要扩展 Unity 场景和判定逻辑。替换 Unity 谱面时，请把网页导出的 v4 游戏谱面 JSON 放到 `UnityRhythmDemo/Assets/Charts/game.json`，并确认场景关联的音乐与谱面一致。

## 部署到 Windows IIS

把 `dist/` **里面的文件**复制到 IIS 网站实际指向的物理目录，让 `index.html` 位于网站根目录；不要额外嵌套一层 `dist`。更新后在浏览器按 `Ctrl+F5` 强制刷新一次。网页引用的脚本和样式带有版本参数，用于减少旧缓存造成的界面不一致。

此仓库不包含 Unity 自动生成的 `Library/`、`Temp/`、`Builds/`、`Logs/` 等目录；这些目录由 Unity 在本地重新生成。
