# 入口与调用链

## 1. 命令

| 命令 | 结果 |
|------|------|
| `npm run dev` | http://127.0.0.1:5190/ |
| `npm run build` | `tsc` 检查 + `dist/`（相对路径） |
| `npm run cap:sync` | build + cap sync ios |
| `npm run ios:bootstrap` | add ios + 拷插件 + 改 storyboard **和 SceneDelegate** + pbx + sync |
| `npm run ios` | sync + open Xcode |

## 2. Web 启动链

```
index.html
  → style.css
  → main.ts
       → applyNativeClass / safeArea
       → createRenderer(#stage)
       → mountPlay（拖螺丝扣，拖螺丝穿过银卡扣，见 SCREWS.md）
       → mountPlaySession
       → mountDevicePreview → computeStageLayout → applyStageTransform
       → watchStageLayout
       → haptics + HUD buttons
```

## 3. DOM

```
#shell
  #viewport
    #app
      #stage
        canvas
        #ui-root
          header.hud       关卡、分数、齿轮
          #result          过关结算，默认 hidden
          #haptic-panel    齿轮打开。震动测试和四档手感
#device-switcher / #device-label   (web only)
```

## 4. iOS

震动插件 **不会**随 `cap:sync` 自动注册。第一次 / 改插件必须 `ios:bootstrap`。步骤见 [HAPTICS.md §0](./HAPTICS.md)。

```
ios:bootstrap
  → 拷 plugins/native-haptics → ios/App/App
  → Main.storyboard customClass = BridgeViewController
  → SceneDelegate.rootViewController = BridgeViewController()   ← Capacitor 8 必改
Xcode Run 真机
  → SceneDelegate 创建 BridgeViewController
  → capacitorDidLoad → registerPluginInstance(AdvancedHapticsPlugin)
  → 推迟四边系统手势，并锁死 WebView 回弹（见 ENGINEERING §5b）
  → load App/public (= dist)
  → 同上 Web 链
  → HUD「点我震动」→ haptics.impact('medium')
```

HUD 状态行有 `plugin: true/false`。`false` = 仍在默认 `CAPBridgeViewController`，插件未进 JS `PluginHeaders`。

## 5. 改配置找谁

| 要改 | 文件 |
|------|------|
| base / 端口 | `vite.config.ts` |
| appId | `capacitor.config.ts` |
| 设计分辨率 | `design.ts` + `style.css` |
| 震动原生 | `plugins/native-haptics/*.swift` + bootstrap |
| 系统手势 | 网页：`style.css`、`main.ts`。原生回弹和四边推迟：`BridgeViewController.swift`。规范见 [ENGINEERING.md](./ENGINEERING.md) §5b |
| 启动 HUD | `index.html` + `main.ts` |
| 关卡 | `public/levels/`，读档 `src/game/levelio.ts` |
| 手机设置 | `src/game/phoneSettings.ts`。齿轮里是震动测试和四档手感。试玩只发按下、撞上、解开 |
| 过关结算 | 松手时盘上没有螺丝和扣，`play.ts` 调 `onCleared`，`result.ts` 弹出 `#result`。重玩再开当前关，下一关向后，最后一关回到第 1 关 |
| 试玩镜头 | `camera.ts` 视口高 10。`play.ts` 把螺丝外框放进顶栏和底栏之间，四周留 24 设计像素。适配只用这块区域的 `FIT_FILL`（0.9），这就是正常大小 |
| 音效（规划） | [AUDIO.md](./AUDIO.md) |
| 震动接线 | [HAPTICS.md](./HAPTICS.md) |
